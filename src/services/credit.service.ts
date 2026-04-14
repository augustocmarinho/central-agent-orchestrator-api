import { query } from '../db/postgres';
import { pool } from '../db/postgres';
import {
  UserBalance,
  DeductionResult,
  CreditTransaction,
  UsageSummary,
} from '../types/billing.types';
import {
  getCreditBalanceCache,
  setCreditBalanceCache,
  invalidateCreditBalanceCache,
} from '../config/redis.config';
import { logInfo, logError, logWarn } from '../utils/logger';

/**
 * Service central do sistema de créditos.
 * Gerencia saldo, dedução atômica, alocação e agregação de uso.
 */
export class CreditService {

  // ─── Saldo ───────────────────────────────────────────────────────────

  /**
   * Busca saldo total do usuário (plano + pacotes adicionais).
   * Utiliza cache Redis com TTL de 60s.
   */
  async getUserBalance(userId: string): Promise<UserBalance> {
    // Tentar cache
    const cached = await getCreditBalanceCache(userId);
    if (cached) return cached;

    // Buscar plano
    const planResult = await query(
      `SELECT up.credits_balance, up.cycle_end, up.plan_id,
              p.name, p.display_name, p.monthly_credits, p.price_brl, p.features, p.hard_limit, p.is_active, p.sort_order
       FROM user_plans up
       JOIN plans p ON up.plan_id = p.id
       WHERE up.user_id = $1`,
      [userId]
    );

    let planBalance = 0;
    let plan = undefined;
    let cycleEnd = undefined;
    let hardLimit = true;

    if (planResult.rows.length > 0) {
      const row = planResult.rows[0];
      planBalance = row.credits_balance;
      cycleEnd = row.cycle_end;
      hardLimit = row.hard_limit;
      plan = {
        id: row.plan_id,
        name: row.name,
        displayName: row.display_name,
        monthlyCredits: row.monthly_credits,
        priceBrl: parseFloat(row.price_brl),
        features: row.features || [],
        hardLimit: row.hard_limit,
        isActive: row.is_active,
        sortOrder: row.sort_order,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    // Buscar pacotes adicionais ativos
    const packagesResult = await query(
      `SELECT COALESCE(SUM(credits_remaining), 0) AS total
       FROM user_additional_packages
       WHERE user_id = $1 AND is_exhausted = false AND expires_at > NOW()`,
      [userId]
    );
    const additionalBalance = parseInt(packagesResult.rows[0]?.total || '0');

    const balance: UserBalance = {
      planBalance,
      additionalBalance,
      totalBalance: planBalance + additionalBalance,
      plan,
      cycleEnd,
      hardLimit,
    };

    await setCreditBalanceCache(userId, balance);
    return balance;
  }

  // ─── Dedução de créditos ─────────────────────────────────────────────

  /**
   * Deduz créditos por uma interação com IA.
   * Atômico: usa transaction PG + idempotency_key para evitar duplicatas.
   * Ordem: plano primeiro, depois pacotes adicionais (mais próximo de expirar).
   */
  async deductCredits(params: {
    userId: string;
    agentId: string;
    messageId: string;
    tokensUsed: number;
    model: string;
  }): Promise<DeductionResult> {
    const { userId, agentId, messageId, tokensUsed, model } = params;

    if (!tokensUsed || tokensUsed <= 0) {
      return { success: true, creditsDeducted: 0, fromPlan: 0, fromPackages: 0, newPlanBalance: 0 };
    }

    // Buscar multiplicador do modelo (match exato ou por prefixo, ex: gpt-3.5-turbo-0125 → gpt-3.5-turbo)
    const modelResult = await query(
      `SELECT credit_multiplier FROM ai_models
       WHERE is_active = true AND ($1 = name OR $1 LIKE name || '%')
       ORDER BY LENGTH(name) DESC LIMIT 1`,
      [model]
    );

    let creditMultiplier = 1.0;
    if (modelResult.rows.length > 0) {
      creditMultiplier = parseFloat(modelResult.rows[0].credit_multiplier);
    }

    // Calcular créditos: cada 1000 tokens = 1 crédito base × multiplicador
    const creditsToDeduct = Math.ceil((tokensUsed / 1000) * creditMultiplier);

    if (creditsToDeduct <= 0) {
      return { success: true, creditsDeducted: 0, fromPlan: 0, fromPackages: 0, newPlanBalance: 0 };
    }

    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');

      // Verificar idempotência
      const existing = await conn.query(
        `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
        [messageId]
      );
      if (existing.rows.length > 0) {
        await conn.query('ROLLBACK');
        logInfo('Credit deduction skipped (idempotent)', { messageId });
        return { success: true, creditsDeducted: 0, fromPlan: 0, fromPackages: 0, newPlanBalance: 0 };
      }

      // Lock e buscar plano do usuário
      const userPlanResult = await conn.query(
        `SELECT id, credits_balance FROM user_plans WHERE user_id = $1 FOR UPDATE`,
        [userId]
      );

      let remainingToDeduct = creditsToDeduct;
      let fromPlan = 0;
      let fromPackages = 0;
      let newPlanBalance = 0;
      const userPlanId = userPlanResult.rows[0]?.id || null;

      // 1. Deduzir do plano
      if (userPlanResult.rows.length > 0) {
        const planBalance = userPlanResult.rows[0].credits_balance;
        const deductFromPlan = Math.min(remainingToDeduct, Math.max(planBalance, 0));

        if (deductFromPlan > 0) {
          await conn.query(
            `UPDATE user_plans SET credits_balance = credits_balance - $1, updated_at = NOW() WHERE user_id = $2`,
            [deductFromPlan, userId]
          );
          fromPlan = deductFromPlan;
          remainingToDeduct -= deductFromPlan;
        }

        newPlanBalance = planBalance - deductFromPlan;

        // Registrar transação do plano
        await conn.query(
          `INSERT INTO credit_transactions
           (user_id, type, amount, balance_after, agent_id, message_id, user_plan_id, ai_model, tokens_used, credit_multiplier, idempotency_key, description)
           VALUES ($1, 'consumption', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [userId, -deductFromPlan, newPlanBalance, agentId, messageId, userPlanId, model, tokensUsed, creditMultiplier, messageId, `Consumo: ${tokensUsed} tokens (${model}, ${creditMultiplier}x)`]
        );
      }

      // 2. Se ainda falta, deduzir de pacotes adicionais (mais próximo de expirar primeiro)
      if (remainingToDeduct > 0) {
        const packages = await conn.query(
          `SELECT id, credits_remaining FROM user_additional_packages
           WHERE user_id = $1 AND is_exhausted = false AND expires_at > NOW()
           ORDER BY expires_at ASC
           FOR UPDATE`,
          [userId]
        );

        for (const pkg of packages.rows) {
          if (remainingToDeduct <= 0) break;

          const deductFromPkg = Math.min(remainingToDeduct, pkg.credits_remaining);
          const newPkgBalance = pkg.credits_remaining - deductFromPkg;

          await conn.query(
            `UPDATE user_additional_packages
             SET credits_remaining = $1, is_exhausted = $2, assigned_at = assigned_at
             WHERE id = $3`,
            [newPkgBalance, newPkgBalance <= 0, pkg.id]
          );

          // Registrar transação do pacote
          await conn.query(
            `INSERT INTO credit_transactions
             (user_id, type, amount, balance_after, agent_id, message_id, user_package_id, ai_model, tokens_used, credit_multiplier, description)
             VALUES ($1, 'package_consumption', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [userId, -deductFromPkg, newPkgBalance, agentId, messageId, pkg.id, model, tokensUsed, creditMultiplier, `Consumo de pacote adicional`]
          );

          fromPackages += deductFromPkg;
          remainingToDeduct -= deductFromPkg;
        }
      }

      await conn.query('COMMIT');
      await invalidateCreditBalanceCache(userId);

      logInfo('Credits deducted', {
        userId,
        agentId,
        messageId,
        tokensUsed,
        model,
        creditsDeducted: creditsToDeduct,
        fromPlan,
        fromPackages,
        newPlanBalance,
      });

      return {
        success: true,
        creditsDeducted: fromPlan + fromPackages,
        fromPlan,
        fromPackages,
        newPlanBalance,
      };
    } catch (error: any) {
      await conn.query('ROLLBACK');
      logError('Error deducting credits', error, { userId, messageId });
      throw error;
    } finally {
      conn.release();
    }
  }

  // ─── Alocação e pacotes ──────────────────────────────────────────────

  /**
   * Reseta o ciclo mensal de créditos para um usuário.
   */
  async resetMonthlyCycle(userId: string): Promise<void> {
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');

      const userPlan = await conn.query(
        `SELECT up.id, up.plan_id, up.credits_balance, p.monthly_credits
         FROM user_plans up JOIN plans p ON up.plan_id = p.id
         WHERE up.user_id = $1 FOR UPDATE`,
        [userId]
      );

      if (userPlan.rows.length === 0) {
        await conn.query('ROLLBACK');
        return;
      }

      const row = userPlan.rows[0];
      const now = new Date();
      const newCycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

      await conn.query(
        `UPDATE user_plans SET credits_balance = $1, cycle_start = $2, cycle_end = $3, updated_at = NOW()
         WHERE user_id = $4`,
        [row.monthly_credits, now.toISOString().split('T')[0], newCycleEnd.toISOString().split('T')[0], userId]
      );

      await conn.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, user_plan_id, description)
         VALUES ($1, 'plan_allocation', $2, $2, $3, 'Reset mensal de créditos')`,
        [userId, row.monthly_credits, row.id]
      );

      await conn.query('COMMIT');
      await invalidateCreditBalanceCache(userId);
      logInfo('Monthly cycle reset', { userId, newBalance: row.monthly_credits });
    } catch (error) {
      await conn.query('ROLLBACK');
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Atribui pacote adicional a um usuário.
   */
  async assignPackage(userId: string, packageId: string, adminId: string): Promise<any> {
    const pkgResult = await query(`SELECT * FROM additional_packages WHERE id = $1 AND is_active = true`, [packageId]);
    if (pkgResult.rows.length === 0) throw new Error('Pacote não encontrado');

    const pkg = pkgResult.rows[0];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + pkg.validity_days);

    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');

      const result = await conn.query(
        `INSERT INTO user_additional_packages (user_id, package_id, credits_remaining, expires_at, assigned_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [userId, packageId, pkg.credits, expiresAt.toISOString(), adminId]
      );

      await conn.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, user_package_id, description, created_by)
         VALUES ($1, 'package_allocation', $2, $2, $3, $4, $5)`,
        [userId, pkg.credits, result.rows[0].id, `Pacote "${pkg.name}" atribuído`, adminId]
      );

      await conn.query('COMMIT');
      await invalidateCreditBalanceCache(userId);
      logInfo('Package assigned', { userId, packageId, credits: pkg.credits });
      return result.rows[0];
    } catch (error) {
      await conn.query('ROLLBACK');
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Ajuste manual de créditos pelo admin.
   */
  async adminAdjust(userId: string, amount: number, description: string, adminId: string): Promise<CreditTransaction> {
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');

      // Atualizar saldo do plano
      const planResult = await conn.query(
        `UPDATE user_plans SET credits_balance = credits_balance + $1, updated_at = NOW()
         WHERE user_id = $2 RETURNING id, credits_balance`,
        [amount, userId]
      );

      const newBalance = planResult.rows[0]?.credits_balance || 0;
      const userPlanId = planResult.rows[0]?.id || null;

      const txResult = await conn.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, user_plan_id, description, created_by)
         VALUES ($1, 'admin_adjustment', $2, $3, $4, $5, $6) RETURNING *`,
        [userId, amount, newBalance, userPlanId, description, adminId]
      );

      await conn.query('COMMIT');
      await invalidateCreditBalanceCache(userId);
      logInfo('Admin credit adjustment', { userId, amount, description, adminId });
      return txResult.rows[0];
    } catch (error) {
      await conn.query('ROLLBACK');
      throw error;
    } finally {
      conn.release();
    }
  }

  // ─── Agregação / Relatórios ──────────────────────────────────────────

  /**
   * Resumo de uso de um usuário em um período.
   */
  async getUserUsageSummary(userId: string, startDate: Date, endDate: Date): Promise<UsageSummary> {
    // Total de créditos e tokens
    const totalResult = await query(
      `SELECT COALESCE(SUM(ABS(amount)), 0) AS total_credits,
              COALESCE(SUM(tokens_used), 0) AS total_tokens
       FROM credit_transactions
       WHERE user_id = $1 AND type IN ('consumption', 'package_consumption')
         AND created_at >= $2 AND created_at < $3`,
      [userId, startDate.toISOString(), endDate.toISOString()]
    );

    // Por agente
    const byAgentResult = await query(
      `SELECT ct.agent_id, a.name AS agent_name,
              SUM(ABS(ct.amount)) AS credits_used,
              SUM(ct.tokens_used) AS tokens_used,
              COUNT(*)::int AS message_count
       FROM credit_transactions ct
       LEFT JOIN agents a ON ct.agent_id = a.id
       WHERE ct.user_id = $1 AND ct.type IN ('consumption', 'package_consumption')
         AND ct.created_at >= $2 AND ct.created_at < $3 AND ct.agent_id IS NOT NULL
       GROUP BY ct.agent_id, a.name
       ORDER BY credits_used DESC`,
      [userId, startDate.toISOString(), endDate.toISOString()]
    );

    // Por modelo
    const byModelResult = await query(
      `SELECT ai_model AS model,
              SUM(ABS(amount)) AS credits_used,
              SUM(tokens_used) AS tokens_used,
              COUNT(*)::int AS message_count
       FROM credit_transactions
       WHERE user_id = $1 AND type IN ('consumption', 'package_consumption')
         AND created_at >= $2 AND created_at < $3 AND ai_model IS NOT NULL
       GROUP BY ai_model
       ORDER BY credits_used DESC`,
      [userId, startDate.toISOString(), endDate.toISOString()]
    );

    // Histórico diário
    const dailyResult = await query(
      `SELECT DATE(created_at) AS date,
              SUM(ABS(amount)) AS credits_used,
              SUM(tokens_used) AS tokens_used,
              COUNT(*)::int AS message_count
       FROM credit_transactions
       WHERE user_id = $1 AND type IN ('consumption', 'package_consumption')
         AND created_at >= $2 AND created_at < $3
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [userId, startDate.toISOString(), endDate.toISOString()]
    );

    return {
      totalCreditsUsed: parseInt(totalResult.rows[0]?.total_credits || '0'),
      totalTokensUsed: parseInt(totalResult.rows[0]?.total_tokens || '0'),
      byAgent: byAgentResult.rows.map(r => ({
        agentId: r.agent_id,
        agentName: r.agent_name || 'Agente removido',
        creditsUsed: parseInt(r.credits_used),
        tokensUsed: parseInt(r.tokens_used),
        messageCount: r.message_count,
      })),
      byModel: byModelResult.rows.map(r => ({
        model: r.model,
        creditsUsed: parseInt(r.credits_used),
        tokensUsed: parseInt(r.tokens_used),
        messageCount: r.message_count,
      })),
      dailyHistory: dailyResult.rows.map(r => ({
        date: r.date.toISOString().split('T')[0],
        creditsUsed: parseInt(r.credits_used),
        tokensUsed: parseInt(r.tokens_used),
        messageCount: r.message_count,
      })),
    };
  }

  /**
   * Histórico de transações paginado.
   */
  async getTransactionHistory(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ transactions: any[]; total: number }> {
    const offset = (page - 1) * limit;

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM credit_transactions WHERE user_id = $1`,
      [userId]
    );

    const result = await query(
      `SELECT ct.*, a.name AS agent_name
       FROM credit_transactions ct
       LEFT JOIN agents a ON ct.agent_id = a.id
       WHERE ct.user_id = $1
       ORDER BY ct.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return {
      transactions: result.rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        type: r.type,
        amount: r.amount,
        balanceAfter: r.balance_after,
        agentId: r.agent_id,
        agentName: r.agent_name,
        messageId: r.message_id,
        aiModel: r.ai_model,
        tokensUsed: r.tokens_used,
        creditMultiplier: r.credit_multiplier ? parseFloat(r.credit_multiplier) : undefined,
        description: r.description,
        createdAt: r.created_at?.toISOString ? r.created_at.toISOString() : r.created_at,
      })),
      total: countResult.rows[0]?.total || 0,
    };
  }
}

export const creditService = new CreditService();
