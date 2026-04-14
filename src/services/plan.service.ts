import { query } from '../db/postgres';
import { pool } from '../db/postgres';
import { Plan, UserPlan } from '../types/billing.types';
import { invalidateCreditBalanceCache } from '../config/redis.config';
import { logInfo, logError } from '../utils/logger';

/**
 * Service para gerenciamento de planos e atribuição a usuários
 */
export class PlanService {

  async listPlans(activeOnly: boolean = false): Promise<Plan[]> {
    const sql = activeOnly
      ? `SELECT * FROM plans WHERE is_active = true ORDER BY sort_order ASC`
      : `SELECT * FROM plans ORDER BY sort_order ASC`;
    const result = await query(sql);
    return result.rows.map(this.mapPlanRow);
  }

  async getPlanById(id: string): Promise<Plan | null> {
    const result = await query(`SELECT * FROM plans WHERE id = $1`, [id]);
    return result.rows.length > 0 ? this.mapPlanRow(result.rows[0]) : null;
  }

  async createPlan(data: {
    name: string;
    displayName: string;
    monthlyCredits: number;
    priceBrl?: number;
    features?: string[];
    hardLimit?: boolean;
    sortOrder?: number;
  }): Promise<Plan> {
    const result = await query(
      `INSERT INTO plans (name, display_name, monthly_credits, price_brl, features, hard_limit, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        data.name,
        data.displayName,
        data.monthlyCredits,
        data.priceBrl || 0,
        JSON.stringify(data.features || []),
        data.hardLimit ?? true,
        data.sortOrder || 0,
      ]
    );
    logInfo('Plan created', { name: data.name });
    return this.mapPlanRow(result.rows[0]);
  }

  async updatePlan(id: string, data: Partial<{
    name: string;
    displayName: string;
    monthlyCredits: number;
    priceBrl: number;
    features: string[];
    hardLimit: boolean;
    isActive: boolean;
    sortOrder: number;
  }>): Promise<Plan | null> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
    if (data.displayName !== undefined) { sets.push(`display_name = $${idx++}`); values.push(data.displayName); }
    if (data.monthlyCredits !== undefined) { sets.push(`monthly_credits = $${idx++}`); values.push(data.monthlyCredits); }
    if (data.priceBrl !== undefined) { sets.push(`price_brl = $${idx++}`); values.push(data.priceBrl); }
    if (data.features !== undefined) { sets.push(`features = $${idx++}`); values.push(JSON.stringify(data.features)); }
    if (data.hardLimit !== undefined) { sets.push(`hard_limit = $${idx++}`); values.push(data.hardLimit); }
    if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); values.push(data.isActive); }
    if (data.sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); values.push(data.sortOrder); }

    if (sets.length === 0) return this.getPlanById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query(
      `UPDATE plans SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return result.rows.length > 0 ? this.mapPlanRow(result.rows[0]) : null;
  }

  async deletePlan(id: string): Promise<boolean> {
    const result = await query(
      `UPDATE plans SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Atribui um plano a um usuário.
   * Se o usuário já tem plano, substitui e reseta o ciclo.
   */
  async assignPlanToUser(userId: string, planId: string, adminId?: string): Promise<UserPlan> {
    const plan = await this.getPlanById(planId);
    if (!plan) throw new Error('Plano não encontrado');

    const now = new Date();
    const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');

      const result = await conn.query(
        `INSERT INTO user_plans (user_id, plan_id, credits_balance, cycle_start, cycle_end, assigned_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id)
         DO UPDATE SET plan_id = $2, credits_balance = $3, cycle_start = $4, cycle_end = $5, assigned_by = $6, updated_at = NOW()
         RETURNING *`,
        [userId, planId, plan.monthlyCredits, now.toISOString().split('T')[0], cycleEnd.toISOString().split('T')[0], adminId || null]
      );

      // Registrar no ledger
      await conn.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, user_plan_id, description, created_by)
         VALUES ($1, 'plan_allocation', $2, $2, $3, $4, $5)`,
        [userId, plan.monthlyCredits, result.rows[0].id, `Plano ${plan.displayName} atribuído`, adminId || null]
      );

      await conn.query('COMMIT');
      await invalidateCreditBalanceCache(userId);

      logInfo('Plan assigned to user', { userId, planId, planName: plan.name });
      return this.mapUserPlanRow(result.rows[0], plan);
    } catch (error) {
      await conn.query('ROLLBACK');
      throw error;
    } finally {
      conn.release();
    }
  }

  async getUserPlan(userId: string): Promise<UserPlan | null> {
    const result = await query(
      `SELECT up.*, p.name AS plan_name, p.display_name AS plan_display_name,
              p.monthly_credits, p.price_brl, p.features, p.hard_limit, p.is_active AS plan_is_active, p.sort_order
       FROM user_plans up
       JOIN plans p ON up.plan_id = p.id
       WHERE up.user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const plan: Plan = {
      id: row.plan_id,
      name: row.plan_name,
      displayName: row.plan_display_name,
      monthlyCredits: row.monthly_credits,
      priceBrl: parseFloat(row.price_brl),
      features: row.features || [],
      hardLimit: row.hard_limit,
      isActive: row.plan_is_active,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    return this.mapUserPlanRow(row, plan);
  }

  private mapPlanRow(row: any): Plan {
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      monthlyCredits: row.monthly_credits,
      priceBrl: parseFloat(row.price_brl),
      features: row.features || [],
      hardLimit: row.hard_limit,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapUserPlanRow(row: any, plan?: Plan): UserPlan {
    return {
      id: row.id,
      userId: row.user_id,
      planId: row.plan_id,
      creditsBalance: row.credits_balance,
      cycleStart: row.cycle_start,
      cycleEnd: row.cycle_end,
      assignedBy: row.assigned_by || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      plan,
    };
  }
}

export const planService = new PlanService();
