import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { agentController } from '../controllers/agent.controller';
import { pluginController } from '../controllers/plugin.controller';
import { chatController } from '../controllers/chat.controller';
import { messageController } from '../controllers/message.controller';
import { conversationController } from '../controllers/conversation.controller';
import { systemTokenController } from '../controllers/systemToken.controller';
import { whatsappBaileysController } from '../controllers/whatsapp.controller';
import { authMiddleware } from '../middleware/auth';
import { systemAuthMiddleware, flexibleAuthMiddleware } from '../middleware/systemAuth';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Auth routes
router.post('/auth/login', authController.login.bind(authController));
router.post('/auth/register', authController.register.bind(authController));
router.get('/auth/me', authMiddleware, authController.me.bind(authController));

// Agent routes - accessible by users and system (N8N)
router.post('/agents', authMiddleware, agentController.create.bind(agentController));
router.get('/agents', authMiddleware, agentController.list.bind(agentController));
// Allow system access to get agent details (for N8N)
router.get('/agents/:id', flexibleAuthMiddleware, agentController.getOne.bind(agentController));
router.put('/agents/:id', authMiddleware, agentController.update.bind(agentController));
router.delete('/agents/:id', authMiddleware, agentController.delete.bind(agentController));

// Plugin routes
router.get('/plugins', authMiddleware, pluginController.list.bind(pluginController));
router.get('/plugins/:id', authMiddleware, pluginController.getOne.bind(pluginController));
router.get('/agents/:agentId/plugins', flexibleAuthMiddleware, pluginController.listAgentPlugins.bind(pluginController));
router.post('/agents/:agentId/plugins', authMiddleware, pluginController.install.bind(pluginController));
router.delete('/agents/:agentId/plugins/:pluginId', authMiddleware, pluginController.uninstall.bind(pluginController));

// Chat routes (legacy - mantido para compatibilidade)
router.post('/chat/message', authMiddleware, chatController.sendMessage.bind(chatController));
router.get('/chat/conversations/:id', flexibleAuthMiddleware, chatController.getConversation.bind(chatController));
router.get('/agents/:agentId/conversations', flexibleAuthMiddleware, chatController.listConversations.bind(chatController));
router.post('/agents/:agentId/conversations', authMiddleware, chatController.createConversation.bind(chatController));

// Message routes (novo sistema de filas assíncrono)
router.post('/messages', authMiddleware, messageController.sendMessage.bind(messageController));
router.get('/messages/:messageId/status', authMiddleware, messageController.getMessageStatus.bind(messageController));
router.get('/messages/queue/stats', authMiddleware, messageController.getQueueStats.bind(messageController));
router.get('/messages/queue/health', authMiddleware, messageController.queueHealthCheck.bind(messageController));

// Conversation routes (histórico de conversas e mensagens)
router.get('/conversations/:conversationId', flexibleAuthMiddleware, conversationController.getConversation.bind(conversationController));
router.get('/conversations/:conversationId/messages', flexibleAuthMiddleware, conversationController.getConversationMessages.bind(conversationController));
router.get('/conversations/:conversationId/full', flexibleAuthMiddleware, conversationController.getConversationFull.bind(conversationController));
router.patch('/conversations/:conversationId/status', authMiddleware, conversationController.updateConversationStatus.bind(conversationController));
router.post('/conversations/find-by-source', flexibleAuthMiddleware, conversationController.findConversationBySource.bind(conversationController));
router.get('/agents/:agentId/conversations', flexibleAuthMiddleware, conversationController.getAgentConversations.bind(conversationController));
router.get('/agents/:agentId/conversations/stats', flexibleAuthMiddleware, conversationController.getAgentConversationStats.bind(conversationController));
router.get('/users/:userId/conversations', authMiddleware, conversationController.getUserConversations.bind(conversationController));

// System Token routes - admin only
router.post('/system-tokens', authMiddleware, systemTokenController.create.bind(systemTokenController));
router.get('/system-tokens', authMiddleware, systemTokenController.list.bind(systemTokenController));
router.get('/system-tokens/:id', authMiddleware, systemTokenController.getById.bind(systemTokenController));
router.delete('/system-tokens/:id', authMiddleware, systemTokenController.revoke.bind(systemTokenController));
router.put('/system-tokens/:id/allowed-ips', authMiddleware, systemTokenController.updateAllowedIps.bind(systemTokenController));
router.get('/system-tokens/:id/logs', authMiddleware, systemTokenController.getLogs.bind(systemTokenController));

// WhatsApp Baileys routes (API não oficial)
// No futuro, teremos rotas separadas para WhatsApp Business API (oficial)
router.post('/whatsapp/baileys/start/:agentId', authMiddleware, whatsappBaileysController.startSession.bind(whatsappBaileysController));
router.get('/whatsapp/baileys/qrcode/:agentId', authMiddleware, whatsappBaileysController.getQRCode.bind(whatsappBaileysController));
router.get('/whatsapp/baileys/status/:agentId', authMiddleware, whatsappBaileysController.getStatus.bind(whatsappBaileysController));
router.delete('/whatsapp/baileys/disconnect/:agentId', authMiddleware, whatsappBaileysController.disconnectSession.bind(whatsappBaileysController));

export default router;
