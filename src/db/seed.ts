import { query } from './postgres';
import { hashPassword } from '../auth/password';
import { logInfo, logError, logWarn } from '../utils/logger';

const seedDatabase = async () => {
  logInfo('Starting database seed...');
  
  try {
    // Criar usuário padrão
    const email = 'admin@example.com';
    const password = 'admin123';
    const passwordHash = await hashPassword(password);
    
    const userResult = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, name, email, role`,
      ['Administrador', email, passwordHash, 'admin']
    );
    
    if (userResult.rows.length > 0) {
      logInfo('Default user created', {
        email,
        role: userResult.rows[0].role
      });
      console.log('✅ Usuário padrão criado:');
      console.log('   Email:', email);
      console.log('   Senha:', password);
      console.log('   Role:', userResult.rows[0].role);
      console.log('');
      logWarn('⚠️  REMEMBER TO CHANGE DEFAULT PASSWORD IN PRODUCTION!');
    } else {
      logInfo('Default user already exists');
    }

    // ─── Seed: Modelos de IA ───────────────────────────────────────────
    const defaultModels = [
      { name: 'gpt-4o-mini', provider: 'openai', displayName: 'GPT-4o Mini', multiplier: 1.00, tokensPerCredit: 1000, description: 'Modelo rápido e econômico' },
      { name: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o', multiplier: 3.00, tokensPerCredit: 1000, description: 'Modelo avançado com visão' },
      { name: 'gpt-4-turbo', provider: 'openai', displayName: 'GPT-4 Turbo', multiplier: 5.00, tokensPerCredit: 1000, description: 'Modelo mais potente da OpenAI' },
      { name: 'gpt-3.5-turbo', provider: 'openai', displayName: 'GPT-3.5 Turbo', multiplier: 0.50, tokensPerCredit: 1000, description: 'Modelo legado econômico' },
    ];

    for (const model of defaultModels) {
      await query(
        `INSERT INTO ai_models (name, provider, display_name, credit_multiplier, tokens_per_credit, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO NOTHING`,
        [model.name, model.provider, model.displayName, model.multiplier, model.tokensPerCredit, model.description]
      );
    }
    logInfo('AI models seeded', { count: defaultModels.length });

    // ─── Seed: Planos ──────────────────────────────────────────────────
    const defaultPlans = [
      { name: 'free', displayName: 'Gratuito', credits: 100, price: 0, sortOrder: 0, features: ['1 agente', '100 créditos/mês'] },
      { name: 'basic', displayName: 'Básico', credits: 5000, price: 49.90, sortOrder: 1, features: ['5 agentes', '5.000 créditos/mês', 'WhatsApp'] },
      { name: 'pro', displayName: 'Profissional', credits: 25000, price: 149.90, sortOrder: 2, features: ['Agentes ilimitados', '25.000 créditos/mês', 'WhatsApp', 'Telegram', 'Suporte prioritário'] },
      { name: 'enterprise', displayName: 'Empresarial', credits: 100000, price: 499.90, sortOrder: 3, features: ['Agentes ilimitados', '100.000 créditos/mês', 'Todos os canais', 'Suporte dedicado', 'SLA'] },
    ];

    for (const plan of defaultPlans) {
      await query(
        `INSERT INTO plans (name, display_name, monthly_credits, price_brl, sort_order, features)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO NOTHING`,
        [plan.name, plan.displayName, plan.credits, plan.price, plan.sortOrder, JSON.stringify(plan.features)]
      );
    }
    logInfo('Plans seeded', { count: defaultPlans.length });

    // ─── Seed: Pacotes adicionais ──────────────────────────────────────
    const defaultPackages = [
      { name: 'Pacote 500 créditos', credits: 500, validityDays: 30, price: 9.90 },
      { name: 'Pacote 2.000 créditos', credits: 2000, validityDays: 30, price: 29.90 },
      { name: 'Pacote 10.000 créditos', credits: 10000, validityDays: 30, price: 99.90 },
    ];

    for (const pkg of defaultPackages) {
      const existing = await query(`SELECT id FROM additional_packages WHERE name = $1`, [pkg.name]);
      if (existing.rows.length === 0) {
        await query(
          `INSERT INTO additional_packages (name, credits, validity_days, price_brl) VALUES ($1, $2, $3, $4)`,
          [pkg.name, pkg.credits, pkg.validityDays, pkg.price]
        );
      }
    }
    logInfo('Additional packages seeded', { count: defaultPackages.length });

    // ─── Seed: Vincular plano Free ao admin ────────────────────────────
    const adminUser = await query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (adminUser.rows.length > 0) {
      const adminId = adminUser.rows[0].id;
      const freePlan = await query(`SELECT id, monthly_credits FROM plans WHERE name = 'free'`);
      if (freePlan.rows.length > 0) {
        const now = new Date();
        const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
        await query(
          `INSERT INTO user_plans (user_id, plan_id, credits_balance, cycle_start, cycle_end)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id) DO NOTHING`,
          [adminId, freePlan.rows[0].id, freePlan.rows[0].monthly_credits, now.toISOString().split('T')[0], cycleEnd.toISOString().split('T')[0]]
        );
        logInfo('Admin user assigned to Free plan');
      }
    }

    logInfo('Database seed completed successfully');
  } catch (error) {
    logError('Error executing seed', error);
    throw error;
  }
};

// Executar se chamado diretamente
if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { seedDatabase };
