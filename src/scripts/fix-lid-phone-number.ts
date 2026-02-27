/**
 * Script de migração para corrigir phoneNumber em conversas WhatsApp.
 *
 * Casos tratados:
 * 1. whatsappChatId é @s.whatsapp.net mas phoneNumber está errado (ex: LID) → extrair número do JID
 * 2. whatsappChatId é @lid e phoneNumber é o LID → limpar e definir name como 'Número oculto'
 *
 * Execute com:
 * npx tsx src/scripts/fix-lid-phone-number.ts
 */

import { Conversation } from '../models/mongodb/Conversation';
import { connectMongoDB } from '../db/mongodb';

function extractJidUser(jid: string): string {
  if (!jid || typeof jid !== 'string') return '';
  return jid.split('@')[0].trim();
}

function extractNormalizedPhone(jid: string): string {
  const user = extractJidUser(jid);
  const withoutDevice = user.split(':')[0];
  return withoutDevice.replace(/\D/g, '');
}

function isLidJid(jid: string): boolean {
  return typeof jid === 'string' && jid.endsWith('@lid');
}

function isPnJid(jid: string): boolean {
  return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
}

async function fixLidPhoneNumbers() {
  console.log('🔄 Corrigindo phoneNumber em conversas WhatsApp...\n');

  try {
    await connectMongoDB();
    console.log('✅ Conectado ao MongoDB\n');

    const conversations = await Conversation.find({
      channel: 'whatsapp',
      'source.whatsappChatId': { $exists: true, $ne: '' },
    }).lean();

    let updated = 0;
    for (const conv of conversations) {
      const whatsappChatId = conv.source?.whatsappChatId;
      const phoneNumber = conv.source?.phoneNumber;
      const name = conv.source?.name;

      if (!whatsappChatId) continue;

      const updates: Record<string, any> = {};

      if (isPnJid(whatsappChatId)) {
        // Caso 1: JID é PN - extrair número correto e corrigir se phoneNumber está errado
        const correctPhone = extractNormalizedPhone(whatsappChatId);
        if (correctPhone && phoneNumber !== correctPhone) {
          updates['source.phoneNumber'] = correctPhone;
        }
      } else if (isLidJid(whatsappChatId)) {
        // Caso 2: JID é LID - phoneNumber não deve ser o valor do LID
        const lidValue = extractJidUser(whatsappChatId);
        if (lidValue && phoneNumber === lidValue) {
          updates['source.phoneNumber'] = '';
        }
        if (name === lidValue) {
          updates['source.name'] = 'Número oculto';
        }
      }

      if (Object.keys(updates).length > 0) {
        await Conversation.updateOne(
          { conversationId: conv.conversationId },
          { $set: updates }
        );
        updated++;
        console.log(`  ✓ ${conv.conversationId}: ${JSON.stringify(updates)}`);
      }
    }

    console.log(`\n✅ Migração concluída. ${updated} conversa(s) atualizada(s)`);
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Erro durante a migração:', error.message);
    process.exit(1);
  }
}

fixLidPhoneNumbers();
