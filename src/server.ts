import http from 'http';
import app from './app';
import { config } from './config';
import { pool, query } from './db/postgres';
import { connectMongoDB } from './db/mongodb';
import { ChatWebSocketServer } from './websocket/ChatWebSocket';
import { registerDefaultPlugins } from './plugins';
import { logInfo, logError, logWarn } from './utils/logger';
import { closeRedisConnections } from './config/redis.config';
import { messageConsumer } from './queues/consumers/message.consumer';
import { messageProducer } from './queues/producers/message.producer';
import { debounceConsumer } from './queues/consumers/debounce.consumer';
import { debounceProducer } from './queues/producers/debounce.producer';
import { responseSubscriber } from './queues/pubsub/subscriber';

const server = http.createServer(app);

// Inicializar WebSocket
new ChatWebSocketServer(server);

const startServer = async () => {
  try {
    logInfo('🚀 Iniciando servidor...');
    
    // Conectar ao MongoDB
    await connectMongoDB();
    logInfo('✅ MongoDB conectado com sucesso');
    
    // Testar conexão PostgreSQL
    await pool.query('SELECT NOW()');
    logInfo('✅ PostgreSQL conectado com sucesso');
    
    // Registrar plugins padrão
    await registerDefaultPlugins();
    logInfo('✅ Plugins padrão registrados');

    // Restaurar sessões WhatsApp Baileys para agentes que já possuem configuração
    try {
      const { whatsappSessionManager } = await import('./plugins/whatsapp_baileys/session-manager');

      const result = await query(
        `SELECT ap.agent_id, pc.config_value AS session_id
         FROM agent_plugins ap
         JOIN plugin_configs pc ON pc.agent_plugin_id = ap.id
         WHERE ap.plugin_id = 'plugin.whatsapp_baileys'
           AND ap.is_active = TRUE
           AND pc.config_key = 'session_id'`
      );

      if (result.rows.length === 0) {
        logInfo('No WhatsApp Baileys sessions to restore on startup');
      } else {
        logInfo('Restoring WhatsApp Baileys sessions on startup', {
          count: result.rows.length,
        });

        for (const row of result.rows) {
          try {
            const agentId: string = row.agent_id;
            const sessionId: string = JSON.parse(row.session_id);

            logInfo('Auto-starting WhatsApp Baileys session', { agentId, sessionId });
            // Isso irá reutilizar as credenciais existentes em disco, sem pedir novo QR
            whatsappSessionManager.startSession(agentId, sessionId);
          } catch (err: any) {
            logWarn('Failed to auto-start WhatsApp Baileys session', {
              agentId: row.agent_id,
              sessionId: row.session_id,
              error: err?.message || String(err),
            });
          }
        }
      }
    } catch (error: any) {
      logWarn('Failed to restore WhatsApp Baileys sessions on startup', {
        error: error?.message || String(error),
      });
    }
    
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
    logInfo('  - Debounce Producer: ✓');
    logInfo('  - Debounce Consumer: ✓');
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
    
    // 2. Fechar consumers (para de processar novos jobs)
    logInfo('🔄 Fechando Message Consumer...');
    await messageConsumer.close();

    logInfo('🔄 Fechando Debounce Consumer...');
    await debounceConsumer.close();

    // 3. Fechar producers
    logInfo('🔄 Fechando Message Producer...');
    await messageProducer.close();

    logInfo('🔄 Fechando Debounce Producer...');
    await debounceProducer.close();

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
  console.error('Full error:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  logError('Unhandled Rejection', reason);
  process.exit(1);
});

// Iniciar
startServer();
