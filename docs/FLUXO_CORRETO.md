# ✅ Fluxo Correto - Sistema de Mensageria

## 🎯 Arquitetura Real Implementada

### Princípio Fundamental
**Redis é a única fonte de verdade para histórico de conversas**
- ❌ MongoDB NÃO é usado para conversas/mensagens no fluxo assíncrono
- ✅ Redis gerencia 100% do histórico (compatível com N8N)
- ✅ PostgreSQL apenas para agentes e configurações
- ✅ Workflow N8N gerencia leitura/escrita no Redis

---

## 📊 Fluxo Completo Passo a Passo

### 1. Cliente Envia Mensagem

```javascript
// Via REST API
POST /api/messages
{
  "agentId": "agent-uuid",
  "message": "Olá!",
  "conversationId": "conv-uuid-123" // Opcional, se não fornecido é gerado
}

// Via WebSocket
ws.send({
  type: 'message',
  data: {
    agentId: 'agent-uuid',
    content: 'Olá!'
  }
})
```

### 2. Node.js (chat.service.ts)

```typescript
async sendMessage(data) {
  // ✅ Valida se agente existe (PostgreSQL)
  const agent = await agentService.getAgentById(agentId, userId);
  
  // ✅ Gera conversationId se não fornecido
  const conversationId = data.conversationId || uuid();
  
  // ✅ Enfileira mensagem (NÃO usa MongoDB!)
  const result = await queueService.enqueueMessage({
    conversationId,  // Simples UUID, não precisa estar no Mongo
    agentId,
    userId,
    message: data.content,
    channel: 'web',
    channelMetadata: { websocketId: '...' }
  });
  
  // ✅ Retorna 202 Accepted imediatamente
  return {
    conversationId,
    messageId: result.messageId,
    status: 'processing'
  };
}
```

**IMPORTANTE:**
- ❌ NÃO cria/busca `Conversation` no MongoDB
- ❌ NÃO salva `Message` no MongoDB
- ✅ conversationId é apenas um UUID simples
- ✅ Histórico fica 100% no Redis

### 3. Redis (Bull Queue)

```
Job adicionado:
{
  id: "msg-uuid-123",
  conversationId: "conv-uuid-456",
  agentId: "agent-uuid",
  message: "Olá!",
  channel: "web",
  ...
}

Namespace: bull:ai-messages:*
```

### 4. Worker/Consumer (message.consumer.ts)

```typescript
async processMessage(job) {
  // ✅ 1. Busca agente (PostgreSQL)
  const agent = await agentService.getAgentByIdForSystem(agentId);
  
  // ✅ 2. Prepara payload para N8N
  const n8nPayload = {
    agent_id: agentId,
    message: message,
    conversation_id: conversationId
  };
  
  // ✅ 3. Chama N8N workflow
  // O N8N vai buscar o histórico do Redis automaticamente!
  const n8nResponse = await n8nService.callOpenAIChatWorkflow(n8nPayload);
  
  // ✅ 4. Publica resposta no PubSub
  await responsePublisher.publishResponse({
    messageId,
    conversationId,
    response: n8nResponse,
    channel: 'web',
    ...
  });
}
```

**IMPORTANTE:**
- ❌ Consumer NÃO busca histórico do Redis
- ❌ Consumer NÃO salva histórico no Redis
- ✅ N8N faz tudo isso automaticamente!

### 5. N8N Workflow (OpenAI Chat with Redis)

```
1. Webhook recebe:
   - agent_id
   - message
   - conversation_id

2. GET Agent (HTTP Request)
   → Busca agente no Node.js: GET /api/agents/{agent_id}
   → Usa System API Key para autenticar

3. Validate Input (Code)
   → Valida mensagem e conversationId
   → Extrai finalPrompt do agente

4. Get History from Redis (Redis Node)
   → Chave: chat:{conversation_id}
   → Busca histórico automático
   → Se não existir, retorna array vazio

5. Prepare Messages (Code)
   → Monta array de mensagens para OpenAI
   → System prompt + histórico + nova mensagem

6. Call OpenAI (HTTP Request)
   → Chama API OpenAI
   → Usa Responses API
   → Timeout: 90 segundos

7. Process Response (Code)
   → Extrai resposta da IA
   → Adiciona nova mensagem ao histórico
   → Adiciona resposta do assistente ao histórico

8. Save to Redis (Redis Node)
   → Chave: chat:{conversation_id}
   → Salva histórico atualizado
   → TTL: 7 dias (604800 segundos)

9. Send Response (Respond to Webhook)
   → Retorna JSON com resposta
```

**IMPORTANTE:**
- ✅ N8N busca agente do Node.js (não recebe tudo no payload)
- ✅ N8N gerencia 100% do Redis (leitura e escrita)
- ✅ N8N usa a mesma chave que o sistema legado (`chat:{conversationId}`)

### 6. Worker Publica Resposta (PubSub)

```
Redis PubSub:
  Canais:
    - pubsub:response:web
    - pubsub:conversation:{conversationId}

Payload:
{
  messageId: "msg-uuid-123",
  conversationId: "conv-uuid-456",
  response: {
    message: "Olá! Como posso ajudar?",
    tokensUsed: 120,
    model: "gpt-4o-mini",
    finishReason: "stop"
  },
  channel: "web",
  channelMetadata: { websocketId: "ws-123" },
  processingTime: 2500
}
```

### 7. Subscriber Roteia para Handler

```typescript
// subscriber.ts
async routeResponse(event) {
  switch (event.channel) {
    case 'web':
      await webHandler.deliver(event);
      break;
    case 'whatsapp':
      await whatsappHandler.deliver(event);
      break;
    case 'telegram':
      await telegramHandler.deliver(event);
      break;
  }
}
```

### 8. Web Handler Entrega via WebSocket

```typescript
// web.handler.ts
async deliver(event) {
  const socketId = event.channelMetadata.websocketId;
  const ws = WebHandler.getConnection(socketId);
  
  ws.send(JSON.stringify({
    type: 'message',
    data: {
      messageId: event.messageId,
      conversationId: event.conversationId,
      message: event.response.message,
      metadata: {
        model: event.response.model,
        tokensUsed: event.response.tokensUsed,
        processingTime: event.processingTime
      }
    }
  }));
}
```

### 9. Cliente Recebe Resposta

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'message') {
    console.log('Resposta:', data.data.message);
    // "Olá! Como posso ajudar?"
  }
};
```

---

## 🗄️ Onde Cada Dado Fica

### PostgreSQL
```
✅ users          - Usuários do sistema
✅ agents         - Agentes criados
✅ agent_prompts  - Prompts dos agentes
✅ plugins        - Plugins disponíveis
✅ agent_plugins  - Plugins instalados
```

### Redis
```
✅ chat:{conversationId}         - Histórico de mensagens (gerenciado pelo N8N)
✅ bull:ai-messages:*            - Filas Bull (jobs)
✅ pubsub:response:*             - Canais PubSub (efêmero)
✅ pubsub:conversation:*         - Canais por conversa (efêmero)
```

### MongoDB
```
❌ NÃO usado no fluxo assíncrono
✅ Pode ser usado futuramente para:
   - Analytics
   - Backup de histórico
   - Audit logs
   - Métricas agregadas
```

---

## 🔧 Correções Implementadas

### Problema 1: MongoDB sendo usado incorretamente
**Antes:**
```typescript
// ❌ ERRADO - Tentava criar conversação no MongoDB
const conversation = await Conversation.create({...});
```

**Depois:**
```typescript
// ✅ CORRETO - conversationId é apenas UUID
const conversationId = data.conversationId || uuidv4();
```

### Problema 2: Consumer não usava método correto
**Antes:**
```typescript
// ❌ ERRADO - Chamava axios diretamente
const response = await axios.post(`${config.n8n.baseUrl}/webhook/openai-chat`, ...);
```

**Depois:**
```typescript
// ✅ CORRETO - Usa serviço N8N
const response = await n8nService.callOpenAIChatWorkflow(payload);
```

### Problema 3: Consumer buscava histórico (duplicado)
**Antes:**
```typescript
// ❌ ERRADO - Consumer buscava histórico
const history = await getChatHistory(conversationId);
```

**Depois:**
```typescript
// ✅ CORRETO - N8N busca histórico automaticamente
// Consumer apenas prepara payload e chama N8N
```

---

## 📝 Validação do Fluxo

### Checklist de Funcionamento

- [ ] Cliente envia mensagem
- [ ] Recebe 202 Accepted imediatamente (< 50ms)
- [ ] Job é adicionado na fila Bull
- [ ] Worker processa job
- [ ] N8N busca agente via API do Node.js
- [ ] N8N busca histórico do Redis (chave: `chat:{conversationId}`)
- [ ] N8N chama OpenAI
- [ ] N8N salva resposta no Redis
- [ ] Worker recebe resposta do N8N
- [ ] Worker publica no PubSub
- [ ] Subscriber roteia para handler correto
- [ ] WebSocket entrega mensagem ao cliente
- [ ] Cliente recebe resposta

### Como Testar

1. **Verificar Redis está rodando:**
   ```bash
   docker ps | grep redis
   docker exec -it ai_agents_redis redis-cli ping
   # Deve retornar: PONG
   ```

2. **Verificar N8N está rodando:**
   ```bash
   curl http://localhost:5678/webhook/openai-chat -I
   # Deve retornar: 405 Method Not Allowed (está ativo)
   ```

3. **Enviar mensagem:**
   ```bash
   curl -X POST http://localhost:3000/api/messages \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "agentId": "agent-uuid",
       "message": "Olá!"
     }'
   ```

4. **Ver logs do Node.js:**
   ```
   ✅ Message added to queue
   ✅ Processing message
   ✅ Agent loaded
   ✅ Calling N8N workflow (OpenAI Chat with Redis)
   ✅ N8N response received
   ✅ Response published to channel
   ✅ Message delivered via WebSocket
   ```

5. **Verificar Redis:**
   ```bash
   docker exec -it ai_agents_redis redis-cli
   > KEYS chat:*
   > GET chat:conv-uuid-123
   # Deve mostrar o histórico em JSON
   ```

---

## 🚨 Troubleshooting

### Erro: MongoDB buffering timeout
**Causa:** chat.service tentando criar conversação no MongoDB

**Solução:** ✅ Já corrigido! Agora não usa MongoDB

### Erro: N8N retorna 404
**Causa:** Workflow não está ativo ou webhook path errado

**Solução:**
1. Abrir N8N: http://localhost:5678
2. Ativar workflow "OpenAI Chat with Redis"
3. Verificar path: `openai-chat`

### Erro: Histórico não persiste
**Causa:** N8N não está salvando no Redis

**Solução:**
1. Verificar node "Save to Redis" no workflow
2. Verificar credenciais Redis no N8N
3. Verificar TTL (604800 = 7 dias)

### Erro: WebSocket não recebe resposta
**Causa:** socketId não está sendo passado

**Solução:**
1. Verificar que `websocketId` está no channelMetadata
2. Verificar logs: `grep "WebSocket" logs/combined.log`

---

## 🎯 Vantagens desta Arquitetura

1. ✅ **Simples**: Redis como única fonte de verdade
2. ✅ **Compatível**: N8N gerencia Redis da mesma forma que antes
3. ✅ **Assíncrono**: Cliente não espera processamento
4. ✅ **Escalável**: Workers podem ser adicionados
5. ✅ **Resiliente**: Retry automático em falhas
6. ✅ **Multi-canal**: Web, WhatsApp, Telegram no mesmo fluxo

---

**Última atualização:** Fevereiro 2026  
**Status:** ✅ Funcionando corretamente
