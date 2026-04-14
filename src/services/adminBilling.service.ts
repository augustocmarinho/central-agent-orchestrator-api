import { query } from '../db/postgres';
import { hashPassword } from '../auth/password';
import { logInfo, logError } from '../utils/logger';

/**
 * Service para funcionalidades administrativas de billing e usuários
 */
export class AdminBillingService {

  /**
   * Estatísticas globais para dashboard admin.
   */
  async getGlobalStats(): Promise<{
    totalUsers: number;
    totalCreditsConsumedThisMonth: number;
    totalTokensUsedThisMonth: number;
    activeUsers: number;
    topAgents: Array<{ agentId: string; agentName: string; creditsUsed: number }>;
    creditsByPlan: Array<{ planName: string; creditsUsed: number; userCount: number }>;
  }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Total users
    const usersResult = await query(`SELECT COUNT(*)::int AS total FROM users`);

    // Créditos consumidos este mês
    const consumedResult = await query(
      `SELECT COALESCE(SUM(ABS(amount)), 0) AS credits,
              COALESCE(SUM(tokens_used), 0) AS tokens
       FROM credit_transactions
       WHERE type IN ('consumption', 'package_consumption')
         AND created_at >= $1`,
      [monthStart.toISOString()]
    );

    // Usuários ativos (com transação este mês)
    const activeResult = await query(
      `SELECT COUNT(DISTINCT user_id)::int AS active
       FROM credit_transactions
       WHERE type IN ('consumption', 'package_consumption')
         AND created_at >= $1`,
      [monthStart.toISOString()]
    );

    // Top agentes
    const topAgentsResult = await query(
      `SELECT ct.agent_id, a.name AS agent_name,
              SUM(ABS(ct.amount))::int AS credits_used
       FROM credit_transactions ct
       JOIN agents a ON ct.agent_id = a.id
       WHERE ct.type IN ('consumption', 'package_consumption')
         AND ct.created_at >= $1 AND ct.agent_id IS NOT NULL
       GROUP BY ct.agent_id, a.name
       ORDER BY credits_used DESC
       LIMIT 10`,
      [monthStart.toISOString()]
    );

    // Créditos por plano
    const byPlanResult = await query(
      `SELECT p.display_name AS plan_name,
              COALESCE(SUM(ABS(ct.amount)), 0)::int AS credits_used,
              COUNT(DISTINCT up.user_id)::int AS user_count
       FROM plans p
       LEFT JOIN user_plans up ON p.id = up.plan_id
       LEFT JOIN credit_transactions ct ON ct.user_id = up.user_id
         AND ct.type IN ('consumption', 'package_consumption')
         AND ct.created_at >= $1
       WHERE p.is_active = true
       GROUP BY p.display_name, p.sort_order
       ORDER BY p.sort_order`,
      [monthStart.toISOString()]
    );

    return {
      totalUsers: usersResult.rows[0]?.total || 0,
      totalCreditsConsumedThisMonth: parseInt(consumedResult.rows[0]?.credits || '0'),
      totalTokensUsedThisMonth: parseInt(consumedResult.rows[0]?.tokens || '0'),
      activeUsers: activeResult.rows[0]?.active || 0,
      topAgents: topAgentsResult.rows.map(r => ({
        agentId: r.agent_id,
        agentName: r.agent_name,
        creditsUsed: r.credits_used,
      })),
      creditsByPlan: byPlanResult.rows.map(r => ({
        planName: r.plan_name,
        creditsUsed: r.credits_used,
        userCount: r.user_count,
      })),
    };
  }

  /**
   * Lista usuários com dados de plano e saldo.
   */
  async listUsers(page: number = 1, limit: number = 20, search?: string): Promise<{ users: any[]; total: number }> {
    const offset = (page - 1) * limit;
    const searchFilter = search ? `AND (u.name ILIKE $1 OR u.email ILIKE $1)` : '';

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM users u WHERE 1=1 ${searchFilter}`,
      search ? [`%${search}%`] : []
    );

    const mainSearchFilter = search ? `AND (u.name ILIKE $3 OR u.email ILIKE $3)` : '';
    const mainParams: any[] = [limit, offset];
    if (search) mainParams.push(`%${search}%`);

    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.avatar, u.created_at,
              up.credits_balance, up.cycle_end,
              p.display_name AS plan_name, p.name AS plan_slug,
              (SELECT COUNT(*)::int FROM agents WHERE user_id = u.id AND deleted_at IS NULL) AS agent_count
       FROM users u
       LEFT JOIN user_plans up ON u.id = up.user_id
       LEFT JOIN plans p ON up.plan_id = p.id
       WHERE 1=1 ${mainSearchFilter}
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      mainParams
    );

    return {
      users: result.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        avatar: r.avatar,
        createdAt: r.created_at,
        planName: r.plan_name || 'Sem plano',
        planSlug: r.plan_slug,
        creditsBalance: r.credits_balance ?? 0,
        cycleEnd: r.cycle_end,
        agentCount: r.agent_count,
      })),
      total: countResult.rows[0]?.total || 0,
    };
  }

  /**
   * Detalhes de um usuário para o admin.
   */
  async getUserDetail(userId: string): Promise<any> {
    const userResult = await query(
      `SELECT u.*, up.credits_balance, up.cycle_start, up.cycle_end, up.plan_id,
              p.name AS plan_name, p.display_name AS plan_display_name, p.monthly_credits
       FROM users u
       LEFT JOIN user_plans up ON u.id = up.user_id
       LEFT JOIN plans p ON up.plan_id = p.id
       WHERE u.id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) return null;

    // Pacotes adicionais ativos
    const packagesResult = await query(
      `SELECT uap.*, ap.name AS package_name, ap.credits AS total_credits
       FROM user_additional_packages uap
       JOIN additional_packages ap ON uap.package_id = ap.id
       WHERE uap.user_id = $1 AND uap.is_exhausted = false AND uap.expires_at > NOW()
       ORDER BY uap.expires_at ASC`,
      [userId]
    );

    // Transações recentes
    const txResult = await query(
      `SELECT ct.*, a.name AS agent_name
       FROM credit_transactions ct
       LEFT JOIN agents a ON ct.agent_id = a.id
       WHERE ct.user_id = $1
       ORDER BY ct.created_at DESC LIMIT 20`,
      [userId]
    );

    const row = userResult.rows[0];
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      avatar: row.avatar,
      createdAt: row.created_at,
      plan: row.plan_id ? {
        id: row.plan_id,
        name: row.plan_name,
        displayName: row.plan_display_name,
        monthlyCredits: row.monthly_credits,
      } : null,
      creditsBalance: row.credits_balance ?? 0,
      cycleStart: row.cycle_start,
      cycleEnd: row.cycle_end,
      packages: packagesResult.rows,
      recentTransactions: txResult.rows,
    };
  }

  /**
   * Cria um novo usuário (admin).
   */
  async createUser(data: { name: string; email: string; password: string; role: string }): Promise<any> {
    const passwordHash = await hashPassword(data.password);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at`,
      [data.name, data.email, passwordHash, data.role || 'user']
    );

    logInfo('User created by admin', { email: data.email, role: data.role });
    return result.rows[0];
  }

  /**
   * Atualiza role de um usuário.
   */
  async updateUserRole(userId: string, role: string): Promise<void> {
    await query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`,
      [role, userId]
    );
    logInfo('User role updated', { userId, role });
  }
}

export const adminBillingService = new AdminBillingService();
