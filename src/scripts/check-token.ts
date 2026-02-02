#!/usr/bin/env ts-node
/**
 * Script para verificar se um token existe no banco
 */

import { query } from '../db/postgres';

async function checkToken() {
  const tokenToCheck = process.argv[2];
  
  if (!tokenToCheck) {
    console.error('❌ Uso: npm run check-token <token>');
    process.exit(1);
  }

  try {
    console.log(`🔍 Verificando token: ${tokenToCheck}\n`);

    const result = await query(
      `SELECT id, name, token, is_active, allowed_ips, expires_at, created_at
       FROM system_tokens 
       WHERE token = $1`,
      [tokenToCheck]
    );

    if (result.rows.length === 0) {
      console.log('❌ Token não encontrado no banco de dados!');
      console.log('\nPossíveis causas:');
      console.log('1. Token não foi criado');
      console.log('2. Migração não foi executada');
      console.log('3. Token foi revogado');
      console.log('\nSolução: Execute "npm run setup:n8n-token" para criar um novo token\n');
      process.exit(1);
    }

    const token = result.rows[0];
    
    console.log('✅ Token encontrado!\n');
    console.log('📋 Detalhes:');
    console.log(`   ID: ${token.id}`);
    console.log(`   Nome: ${token.name}`);
    console.log(`   Ativo: ${token.is_active ? '✅ Sim' : '❌ Não'}`);
    console.log(`   IPs Permitidos: ${token.allowed_ips ? token.allowed_ips.join(', ') : 'Todos'}`);
    console.log(`   Expira em: ${token.expires_at || 'Nunca'}`);
    console.log(`   Criado em: ${token.created_at}\n`);

    if (!token.is_active) {
      console.log('⚠️  ATENÇÃO: Token está INATIVO!');
      console.log('   Execute a requisição "Revoke System Token" no Postman para reativá-lo\n');
    }

    if (token.allowed_ips && token.allowed_ips.length > 0) {
      console.log('🔒 Restrição de IP configurada:');
      token.allowed_ips.forEach((ip: string) => {
        console.log(`   - ${ip}`);
      });
      console.log('\n⚠️  Certifique-se de que seu IP está na lista!\n');
    }

  } catch (error) {
    console.error('❌ Erro ao verificar token:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  checkToken()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { checkToken };
