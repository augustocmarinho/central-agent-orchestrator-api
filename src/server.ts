import http from 'http';
import app from './app';
import { config } from './config';
import { pool } from './db/postgres';
import { connectMongoDB } from './db/mongodb';
import { ChatWebSocketServer } from './websocket/ChatWebSocket';
import { registerDefaultPlugins } from './plugins';
import { logInfo, logError, logWarn } from './utils/logger';

const server = http.createServer(app);

// Inicializar WebSocket
new ChatWebSocketServer(server);

const startServer = async () => {
  try {
    logInfo('🚀 Iniciando servidor...');
    
    // Conectar ao MongoDB
    // await connectMongoDB();
    // logInfo('✅ MongoDB conectado com sucesso');
    
    // Testar conexão PostgreSQL
    await pool.query('SELECT NOW()');
    logInfo('✅ PostgreSQL conectado com sucesso');
    
    // Registrar plugins padrão
    await registerDefaultPlugins();
    logInfo('✅ Plugins padrão registrados');
    
    // Validar configurações de segurança
    if (config.systemApiKeys.length > 0) {
      logInfo(`✅ ${config.systemApiKeys.length} System API Key(s) configurada(s)`);
    } else {
      logWarn('⚠️  Nenhuma System API Key configurada - N8N não poderá acessar APIs');
    }
    
    // Iniciar servidor HTTP
    server.listen(config.port, () => {
      console.log('');
      console.log('╔════════════════════════════════════════════╗');
      console.log('║   🤖 AI Agents Backend                     ║');
      console.log('╚════════════════════════════════════════════╝');
      console.log('');
      console.log(`🌍 Servidor rodando em: http://localhost:${config.port}`);
      console.log(`🔌 WebSocket disponível em: ws://localhost:${config.port}/ws/chat`);
      console.log(`📊 Health check: http://localhost:${config.port}/api/health`);
      console.log(`🌐 Ambiente: ${config.nodeEnv}`);
      console.log(`📝 Log Level: ${config.logging.level}`);
      console.log('');
      console.log('Pressione Ctrl+C para parar o servidor');
      console.log('');
      
      logInfo('Servidor iniciado com sucesso', {
        port: config.port,
        environment: config.nodeEnv,
        logLevel: config.logging.level,
      });
    });
  } catch (error) {
    logError('❌ Erro ao iniciar servidor', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  logWarn('⚠️  SIGTERM recebido, encerrando servidor...');
  
  server.close(() => {
    logInfo('✅ Servidor HTTP encerrado');
  });
  
  await pool.end();
  logInfo('✅ Pool PostgreSQL encerrado');
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logWarn('\n⚠️  SIGINT recebido, encerrando servidor...');
  
  server.close(() => {
    logInfo('✅ Servidor HTTP encerrado');
  });
  
  await pool.end();
  logInfo('✅ Pool PostgreSQL encerrado');
  
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logError('Uncaught Exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  logError('Unhandled Rejection', reason);
  process.exit(1);
});

// Iniciar
startServer();
