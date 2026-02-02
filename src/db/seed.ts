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
