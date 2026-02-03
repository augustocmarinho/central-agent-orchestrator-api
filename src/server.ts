import http from 'http';
import app from './app';
import { config } from './config';
import { pool } from './db/postgres';
import { connectMongoDB } from './db/mongodb';
import { ChatWebSocketServer } from './websocket/ChatWebSocket';
import { registerDefaultPlugins } from './plugins';
import { logInfo, logError, logWarn } from './utils/logger';
import { closeRedisConnections } from './config/redis.config';
import { messageConsumer } from './queues/consumers/message.consumer';
import { messageProducer } from './queues/producers/message.producer';
import { responseSubscriber } from './queues/pubsub/subscriber';

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
    
    // Inicializar sistema de filas (Redis)
    logInfo('🔄 Inicializando sistema de mensageria...');
    
    // Os consumers e subscribers são inicializados automaticamente ao serem importados
    // Aguardar um pouco para garantir que Redis está pronto
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    logInfo('✅ Sistema de mensageria inicializado');
    logInfo('  - Message Producer: ✓');
    logInfo('  - Message Consumer: ✓');
    logInfo('  - Response Subscriber: ✓');
    
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
      console.log(`📥 Message Queue: Redis on ${config.redis.host}:${config.redis.port}`);
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
const gracefulShutdown = async (signal: string) => {
  logWarn(`\n⚠️  ${signal} recebido, encerrando servidor gracefully...`);
  
  try {
    // 1. Parar de aceitar novas conexões HTTP
    server.close(() => {
      logInfo('✅ Servidor HTTP encerrado');
    });
    
    // 2. Fechar consumer (para de processar novos jobs)
    logInfo('🔄 Fechando Message Consumer...');
    await messageConsumer.close();
    
    // 3. Fechar producer
    logInfo('🔄 Fechando Message Producer...');
    await messageProducer.close();
    
    // 4. Fechar subscriber
    logInfo('🔄 Fechando Response Subscriber...');
    await responseSubscriber.close();
    
    // 5. Fechar conexões Redis
    logInfo('🔄 Fechando conexões Redis...');
    await closeRedisConnections();
    
    // 6. Fechar pool PostgreSQL
    logInfo('🔄 Fechando Pool PostgreSQL...');
    await pool.end();
    logInfo('✅ Pool PostgreSQL encerrado');
    
    logInfo('✅ Shutdown completo com sucesso');
    process.exit(0);
  } catch (error) {
    logError('Erro durante shutdown', error as Error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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
