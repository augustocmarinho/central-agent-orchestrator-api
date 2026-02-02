#!/usr/bin/env ts-node
/**
 * Script para criar o token de sistema para o N8N
 * 
 * Uso:
 * npm run setup:n8n-token
 * 
 * Opções (variáveis de ambiente):
 * - N8N_TOKEN_NAME: Nome do token (padrão: "N8N Production")
 * - N8N_TOKEN_DESCRIPTION: Descrição do token
 * - N8N_ALLOWED_IPS: IPs permitidos separados por vírgula (ex: "192.168.1.1,10.0.0.0/8")
 * - ADMIN_EMAIL: Email do usuário admin que criará o token (padrão: primeiro admin encontrado)
 */

import { query } from '../db/postgres';
import { systemTokenService } from '../services/systemToken.service';
import { logInfo, logError } from '../utils/logger';

async function setupN8nToken() {
  try {
    console.log('🔧 Configurando token de sistema para N8N...\n');

    // 1. Buscar ou criar usuário admin
    let adminResult = await query(
      `SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`
    );

    let adminUserId: string;

    if (adminResult.rows.length === 0) {
      console.log('⚠️  Nenhum usuário admin encontrado. Criando usuário admin padrão...');
      
      const { hashPassword } = await import('../auth/password');
      const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123!@#';
      const passwordHash = await hashPassword(defaultAdminPassword);
      
      const newAdminResult = await query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email`,
        ['Administrador', 'admin@aiagent.local', passwordHash, 'admin']
      );
      
      adminUserId = newAdminResult.rows[0].id;
      console.log(`✅ Usuário admin criado: ${newAdminResult.rows[0].email}`);
      console.log(`   Senha: ${defaultAdminPassword}`);
      console.log(`   ⚠️  IMPORTANTE: Altere esta senha após o primeiro login!\n`);
    } else {
      adminUserId = adminResult.rows[0].id;
      console.log(`✅ Usando usuário admin: ${adminResult.rows[0].email}\n`);
    }

    // 2. Verificar se já existe um token ativo para N8N
    const existingTokenResult = await query(
      `SELECT id, name, token FROM system_tokens 
       WHERE name LIKE '%N8N%' AND is_active = true
       ORDER BY created_at DESC LIMIT 1`
    );

    if (existingTokenResult.rows.length > 0) {
      console.log('⚠️  Já existe um token ativo para N8N:');
      console.log(`   ID: ${existingTokenResult.rows[0].id}`);
      console.log(`   Nome: ${existingTokenResult.rows[0].name}`);
      console.log(`   Token: ${existingTokenResult.rows[0].token}\n`);
      
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>((resolve) => {
        readline.question('Deseja criar um novo token mesmo assim? (s/N): ', resolve);
      });
      
      readline.close();

      if (answer.toLowerCase() !== 's') {
        console.log('❌ Operação cancelada.');
        process.exit(0);
      }
      console.log();
    }

    // 3. Criar novo token
    const tokenName = process.env.N8N_TOKEN_NAME || 'N8N Production';
    const tokenDescription = process.env.N8N_TOKEN_DESCRIPTION || 
      'Token de sistema para integração com N8N. Este token não expira e possui acesso completo à API.';
    
    const allowedIpsEnv = process.env.N8N_ALLOWED_IPS;
    const allowedIps = allowedIpsEnv ? allowedIpsEnv.split(',').map(ip => ip.trim()) : undefined;

    console.log('📝 Configurações do token:');
    console.log(`   Nome: ${tokenName}`);
    console.log(`   Descrição: ${tokenDescription}`);
    console.log(`   IPs Permitidos: ${allowedIps ? allowedIps.join(', ') : 'Todos (sem restrição)'}`);
    console.log(`   Expira: Nunca\n`);

    const token = await systemTokenService.createToken({
      name: tokenName,
      description: tokenDescription,
      allowed_ips: allowedIps,
      created_by: adminUserId
    });

    console.log('✅ Token de sistema criado com sucesso!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔑 TOKEN (guarde em local seguro):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n${token.token}\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('📋 Informações do Token:');
    console.log(`   ID: ${token.id}`);
    console.log(`   Nome: ${token.name}`);
    console.log(`   Criado em: ${token.created_at}\n`);
    
    console.log('🔧 Como usar no N8N:');
    console.log('   1. No N8N, adicione este header em suas requisições HTTP:');
    console.log(`      X-System-API-Key: ${token.token}`);
    console.log('   2. Configure a URL base da API:');
    console.log(`      ${process.env.API_URL || 'http://localhost:3000'}/api`);
    console.log('\n⚠️  IMPORTANTE: Este token não será exibido novamente!');
    console.log('   Guarde-o em um local seguro (ex: variável de ambiente do N8N)\n');

    logInfo('N8N system token created via setup script', {
      tokenId: token.id,
      createdBy: adminUserId
    });

  } catch (error) {
    console.error('\n❌ Erro ao criar token:', error);
    logError('Error in N8N token setup script', error);
    process.exit(1);
  }
}

// Executar o script
if (require.main === module) {
  setupN8nToken()
    .then(() => {
      console.log('✅ Setup concluído!\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Erro fatal:', error);
      process.exit(1);
    });
}

export { setupN8nToken };
