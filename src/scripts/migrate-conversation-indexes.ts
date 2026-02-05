/**
 * Script de migração para criar/atualizar índices das coleções de conversas
 * 
 * Execute com:
 * npx tsx src/scripts/migrate-conversation-indexes.ts
 */

import { Conversation } from '../models/mongodb/Conversation';
import { Message } from '../models/mongodb/Message';
import { connectMongoDB } from '../db/mongodb';

async function migrateIndexes() {
  console.log('🔄 Iniciando migração de índices...\n');

  try {
    // Conectar ao MongoDB
    await connectMongoDB();
    console.log('✅ Conectado ao MongoDB\n');

    // Criar índices para Conversation
    console.log('📊 Criando índices para Conversation...');
    await Conversation.collection.createIndex({ conversationId: 1 }, { unique: true });
    await Conversation.collection.createIndex({ agentId: 1, status: 1, startedAt: -1 });
    await Conversation.collection.createIndex({ userId: 1, startedAt: -1 });
    await Conversation.collection.createIndex({ 'source.phoneNumber': 1 });
    await Conversation.collection.createIndex({ 'source.telegramChatId': 1 });
    await Conversation.collection.createIndex({ 'source.socketId': 1 });
    await Conversation.collection.createIndex({ channel: 1, status: 1 });
    await Conversation.collection.createIndex({ lastMessageAt: -1 });
    console.log('✅ Índices de Conversation criados\n');

    // Criar índices para Message
    console.log('📊 Criando índices para Message...');
    await Message.collection.createIndex({ messageId: 1 }, { unique: true });
    await Message.collection.createIndex({ conversationId: 1, createdAt: 1 });
    await Message.collection.createIndex({ agentId: 1, createdAt: -1 });
    await Message.collection.createIndex({ userId: 1, createdAt: -1 });
    await Message.collection.createIndex({ type: 1, status: 1, createdAt: -1 });
    await Message.collection.createIndex({ status: 1, createdAt: -1 });
    await Message.collection.createIndex({ replyToMessageId: 1 });
    await Message.collection.createIndex({ jobId: 1 });
    console.log('✅ Índices de Message criados\n');

    // Listar todos os índices criados
    console.log('📋 Índices de Conversation:');
    const convIndexes = await Conversation.collection.indexes();
    convIndexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    console.log('\n📋 Índices de Message:');
    const msgIndexes = await Message.collection.indexes();
    msgIndexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    console.log('\n✅ Migração concluída com sucesso!');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Erro durante a migração:', error.message);
    process.exit(1);
  }
}

// Executar migração
migrateIndexes();
