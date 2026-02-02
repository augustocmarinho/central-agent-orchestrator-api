import fs from 'fs';
import path from 'path';
import { pool, query } from './postgres';

const runMigrations = async () => {
  console.log('🔄 Executando migrations...');
  
  try {
    const migrationsPath = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsPath).filter(f => f.endsWith('.sql')).sort();
    
    for (const file of files) {
      console.log(`  ⏳ Executando ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsPath, file), 'utf-8');
      await query(sql);
      console.log(`  ✅ ${file} executado com sucesso`);
    }
    
    console.log('✅ Todas as migrations foram executadas com sucesso');
  } catch (error) {
    console.error('❌ Erro ao executar migrations:', error);
    throw error;
  } finally {
    await pool.end();
  }
};

// Executar se chamado diretamente
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { runMigrations };
