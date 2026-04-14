import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { agentController } from '../controllers/agent.controller';
import { pluginController } from '../controllers/plugin.controller';
import { chatController } from '../controllers/chat.controller';
import { messageController } from '../controllers/message.controller';
import { conversationController } from '../controllers/conversation.controller';
import { systemTokenController } from '../controllers/systemToken.controller';
import { toolController } from '../controllers/tool.controller';
import { whatsappBaileysController } from '../controllers/whatsapp.controller';
import { followUpController } from '../controllers/followup.controller';
import { adminController } from '../controllers/admin.controller';
import { planController } from '../controllers/plan.controller';
import { aiModelController } from '../controllers/aiModel.controller';
import { packageController } from '../controllers/package.controller';
import { usageController } from '../controllers/usage.controller';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/admin';
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
router.get('/agents/:id/context', flexibleAuthMiddleware, agentController.getContext.bind(agentController));
router.get('/agents/:agentId/tools', flexibleAuthMiddleware, toolController.getTools.bind(toolController));
router.post('/agents/:agentId/tools/execute', flexibleAuthMiddleware, toolController.executeTool.bind(toolController));
router.put('/agents/:id', authMiddleware, agentController.update.bind(agentController));
router.delete('/agents/:id', authMiddleware, agentController.delete.bind(agentController));

// Plugin routes
router.get('/plugins', authMiddleware, pluginController.list.bind(pluginController));
router.get('/plugins/:id', authMiddleware, pluginController.getOne.bind(pluginController));
router.get('/agents/:agentId/plugins', flexibleAuthMiddleware, pluginController.listAgentPlugins.bind(pluginController));
router.get('/agents/:agentId/plugins/:pluginId/config', flexibleAuthMiddleware, pluginController.getConfig.bind(pluginController));
router.put('/agents/:agentId/plugins/:pluginId/config', authMiddleware, pluginController.updateConfig.bind(pluginController));
router.post('/agents/:agentId/plugins', authMiddleware, pluginController.install.bind(pluginController));
router.delete('/agents/:agentId/plugins/:pluginId', authMiddleware, pluginController.uninstall.bind(pluginController));

// Follow-up routes (configuração de follow-up automático por agente)
router.get('/agents/:agentId/follow-up', authMiddleware, followUpController.getConfig.bind(followUpController));
router.put('/agents/:agentId/follow-up', authMiddleware, followUpController.updateConfig.bind(followUpController));

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

// AI Models (user-facing — modelos ativos)
router.get('/models', authMiddleware, aiModelController.listActive.bind(aiModelController));

// Usage routes (user-facing — saldo e consumo)
router.get('/usage/balance', authMiddleware, usageController.getBalance.bind(usageController));
router.get('/usage/summary', authMiddleware, usageController.getSummary.bind(usageController));
router.get('/usage/history', authMiddleware, usageController.getHistory.bind(usageController));

// Admin routes — Stats
router.get('/admin/stats', authMiddleware, adminMiddleware, adminController.getStats.bind(adminController));

// Admin routes — Users
router.get('/admin/users', authMiddleware, adminMiddleware, adminController.listUsers.bind(adminController));
router.get('/admin/users/:id', authMiddleware, adminMiddleware, adminController.getUserDetail.bind(adminController));
router.post('/admin/users', authMiddleware, adminMiddleware, adminController.createUser.bind(adminController));
router.put('/admin/users/:id/role', authMiddleware, adminMiddleware, adminController.updateUserRole.bind(adminController));
router.post('/admin/users/:id/plan', authMiddleware, adminMiddleware, adminController.assignPlanToUser.bind(adminController));
router.post('/admin/users/:id/packages', authMiddleware, adminMiddleware, adminController.assignPackageToUser.bind(adminController));
router.post('/admin/users/:id/credits/adjust', authMiddleware, adminMiddleware, adminController.adjustCredits.bind(adminController));
router.get('/admin/users/:id/usage', authMiddleware, adminMiddleware, adminController.getUserUsage.bind(adminController));

// Admin routes — Plans
router.get('/admin/plans', authMiddleware, adminMiddleware, planController.list.bind(planController));
router.post('/admin/plans', authMiddleware, adminMiddleware, planController.create.bind(planController));
router.put('/admin/plans/:id', authMiddleware, adminMiddleware, planController.update.bind(planController));
router.delete('/admin/plans/:id', authMiddleware, adminMiddleware, planController.delete.bind(planController));

// Admin routes — AI Models
router.get('/admin/models', authMiddleware, adminMiddleware, aiModelController.list.bind(aiModelController));
router.post('/admin/models', authMiddleware, adminMiddleware, aiModelController.create.bind(aiModelController));
router.put('/admin/models/:id', authMiddleware, adminMiddleware, aiModelController.update.bind(aiModelController));
router.delete('/admin/models/:id', authMiddleware, adminMiddleware, aiModelController.delete.bind(aiModelController));

// Admin routes — Packages
router.get('/admin/packages', authMiddleware, adminMiddleware, packageController.list.bind(packageController));
router.post('/admin/packages', authMiddleware, adminMiddleware, packageController.create.bind(packageController));
router.put('/admin/packages/:id', authMiddleware, adminMiddleware, packageController.update.bind(packageController));
router.delete('/admin/packages/:id', authMiddleware, adminMiddleware, packageController.delete.bind(packageController));

export default router;
