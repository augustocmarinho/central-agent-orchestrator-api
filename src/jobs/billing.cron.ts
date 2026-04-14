import cron from 'node-cron';
import { query } from '../db/postgres';
import { pool } from '../db/postgres';
import { invalidateCreditBalanceCache } from '../config/redis.config';
import { logInfo, logError, logWarn } from '../utils/logger';

let cronTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Job diário que:
 * 1. Reseta créditos mensais de usuários cujo ciclo expirou
 * 2. Expira pacotes adicionais vencidos
 *
 * Executa todo dia às 00:05 (evitar meia-noite exata)
 */
export function startBillingCron() {
  cronTask = cron.schedule('5 0 * * *', async () => {
    logInfo('🕐 Billing cron job started');

    try {
      await resetExpiredCycles();
      await expirePackages();
      logInfo('✅ Billing cron job completed');
    } catch (error: any) {
      logError('❌ Billing cron job failed', error);
    }
  }, {
    timezone: 'America/Sao_Paulo',
  });

  logInfo('✅ Billing cron job scheduled (daily at 00:05 BRT)');
}

/**
 * Reseta créditos de usuários cujo cycle_end <= hoje.
 */
async function resetExpiredCycles(): Promise<void> {
  const result = await query(
    `SELECT up.id, up.user_id, up.plan_id, up.credits_balance, p.monthly_credits
     FROM user_plans up
     JOIN plans p ON up.plan_id = p.id
     WHERE up.cycle_end <= CURRENT_DATE`
  );

  if (result.rows.length === 0) {
    logInfo('No expired billing cycles to reset');
    return;
  }

  logInfo(`Resetting ${result.rows.length} expired billing cycles`);

  for (const row of result.rows) {
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');

      const now = new Date();
      const newCycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

      await conn.query(
        `UPDATE user_plans SET credits_balance = $1, cycle_start = $2, cycle_end = $3, updated_at = NOW()
         WHERE id = $4`,
        [row.monthly_credits, now.toISOString().split('T')[0], newCycleEnd.toISOString().split('T')[0], row.id]
      );

      await conn.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, user_plan_id, description)
         VALUES ($1, 'plan_allocation', $2, $2, $3, 'Reset mensal automático de créditos')`,
        [row.user_id, row.monthly_credits, row.id]
      );

      await conn.query('COMMIT');
      await invalidateCreditBalanceCache(row.user_id);

      logInfo('Monthly cycle reset', { userId: row.user_id, newBalance: row.monthly_credits });
    } catch (error: any) {
      await conn.query('ROLLBACK');
      logError('Error resetting cycle for user', error, { userId: row.user_id });
    } finally {
      conn.release();
    }
  }
}

/**
 * Expira pacotes adicionais vencidos e registra no ledger.
 */
async function expirePackages(): Promise<void> {
  const result = await query(
    `SELECT id, user_id, credits_remaining
     FROM user_additional_packages
     WHERE is_exhausted = false AND expires_at <= NOW() AND credits_remaining > 0`
  );

  if (result.rows.length === 0) {
    logInfo('No expired packages to process');
    return;
  }

  logInfo(`Expiring ${result.rows.length} additional packages`);

  for (const row of result.rows) {
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');

      await conn.query(
        `UPDATE user_additional_packages SET is_exhausted = true WHERE id = $1`,
        [row.id]
      );

      await conn.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, user_package_id, description)
         VALUES ($1, 'expiration', $2, 0, $3, 'Pacote adicional expirado')`,
        [row.user_id, -row.credits_remaining, row.id]
      );

      await conn.query('COMMIT');
      await invalidateCreditBalanceCache(row.user_id);

      logInfo('Package expired', { userId: row.user_id, packageId: row.id, creditsLost: row.credits_remaining });
    } catch (error: any) {
      await conn.query('ROLLBACK');
      logError('Error expiring package', error, { packageId: row.id });
    } finally {
      conn.release();
    }
  }
}

/**
 * Para o cron job (graceful shutdown).
 */
export function stopBillingCron() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logInfo('✅ Billing cron job stopped');
  }
}
