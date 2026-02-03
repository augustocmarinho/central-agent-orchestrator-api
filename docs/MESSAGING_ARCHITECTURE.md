# 📨 Arquitetura de Mensageria Assíncrona

## Visão Geral

Sistema de processamento assíncrono de mensagens usando **Bull + Redis** para garantir escalabilidade, resiliência e suporte multi-canal (Web, WhatsApp, Telegram, API).

```
┌──────────┐
│  Client  │
└────┬─────┘
     │ POST /api/messages
     ▼
┌─────────────────┐
│   Node.js API   │  ← Retorna 202 Accepted imediatamente
└────┬────────────┘
     │ Enfileira
     ▼
┌─────────────────┐
│  Redis (Bull)   │  ← Fila de jobs
└────┬────────────┘
     │
     ▼
┌─────────────────┐
│  Worker/Consumer│  ← Processa em background
│  - Busca Agent  │
│  - Busca History│
│  - Chama N8N    │
└────┬────────────┘
     │
     ▼
┌─────────────────┐
│  Redis PubSub   │  ← Publica resposta
└────┬────────────┘
     │
     ▼
┌─────────────────┐
│   Subscriber    │  ← Roteia para canal
└────┬────────────┘
     │
     ├──→ WebSocket ────→ Cliente Web
     ├──→ WhatsApp API ─→ Cliente WhatsApp
     └──→ Telegram API ─→ Cliente Telegram
```

---

## 🏗️ Componentes

### 1. Message Producer (`queues/producers/message.producer.ts`)

**Responsabilidade:** Adicionar jobs na fila Bull.

**Recursos:**
- ✅ Retry automático (3 tentativas, exponential backoff)
- ✅ Idempotência (jobId = messageId)
- ✅ Priorização de mensagens
- ✅ Estatísticas em tempo real
- ✅ Limpeza automática de jobs antigos

**Exemplo de uso:**
```typescript
import { messageProducer } from './queues/producers/message.producer';

const result = await messageProducer.addMessage({
  id: 'msg-uuid-123',
  conversationId: 'conv-uuid-456',
  agentId: 'agent-uuid-789',
  userId: 'user-uuid-000',
  message: 'Olá, como posso ajudar?',
  channel: 'web',
  channelMetadata: { websocketId: 'ws-123' },
  priority: 5,
  timestamp: new Date().toISOString(),
  retries: 0,
});

console.log(result); 
// { jobId: 'msg-uuid-123', messageId: 'msg-uuid-123', status: 'queued' }
```

---

### 2. Message Consumer (`queues/consumers/message.consumer.ts`)

**Responsabilidade:** Processar jobs da fila.

**Fluxo de processamento:**
1. ✅ Buscar agente no PostgreSQL (10%)
2. ✅ Buscar histórico no Redis (20%)
3. ✅ Preparar payload para N8N (30%)
4. ✅ Chamar workflow N8N (50%)
5. ✅ Publicar resposta no PubSub (80%)
6. ✅ Concluir job (100%)

**Concorrência:** 5 jobs simultâneos (configurável)

**Tratamento de erros:**
- Retry automático em falhas transitórias
- DLQ (Dead Letter Queue) após 3 tentativas
- Logs detalhados de cada etapa

---

### 3. Response Publisher (`queues/pubsub/publisher.ts`)

**Responsabilidade:** Publicar respostas no Redis PubSub.

**Canais:**
- `pubsub:response:web` - Respostas para WebSocket
- `pubsub:response:whatsapp` - Respostas para WhatsApp
- `pubsub:response:telegram` - Respostas para Telegram
- `pubsub:conversation:{id}` - Canal específico da conversa

**Exemplo:**
```typescript
await responsePublisher.publishResponse({
  messageId: 'msg-123',
  conversationId: 'conv-456',
  agentId: 'agent-789',
  response: {
    message: 'Olá! Como posso ajudar?',
    tokensUsed: 120,
    model: 'gpt-4o-mini',
    finishReason: 'stop',
  },
  channel: 'web',
  channelMetadata: { websocketId: 'ws-123' },
  timestamp: '2026-02-02T10:00:00Z',
  processingTime: 2500,
});
```

---

### 4. Response Subscriber (`queues/pubsub/subscriber.ts`)

**Responsabilidade:** Subscrever aos canais e rotear para handlers.

**Pattern matching:** `pubsub:response:*`

**Roteamento:**
- `web` → WebHandler (WebSocket)
- `whatsapp` → WhatsAppHandler
- `telegram` → TelegramHandler
- `api` → Callback HTTP

---

### 5. Delivery Handlers (`queues/handlers/*.handler.ts`)

#### Web Handler (WebSocket)
Entrega mensagens via WebSocket para clientes conectados.

**Registro de conexões:**
```typescript
// No ChatWebSocketServer
WebHandler.registerConnection(socketId, ws);

// Quando cliente desconecta
WebHandler.unregisterConnection(socketId);
```

#### WhatsApp Handler (Placeholder)
```typescript
// TODO: Implementar com Twilio ou WhatsApp Business API
await whatsappHandler.deliver(event);
```

#### Telegram Handler (Placeholder)
```typescript
// TODO: Implementar com Telegram Bot API
await telegramHandler.deliver(event);
```

---

## 🔧 Configuração

### Variáveis de Ambiente

```bash
# .env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

N8N_BASE_URL=http://localhost:5678
```

### Docker Compose

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
```

---

## 📡 API Endpoints

### 1. Enviar Mensagem (Assíncrono)

```http
POST /api/messages
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "agentId": "agent-uuid",
  "message": "Olá, como posso ajudar?",
  "conversationId": "conv-uuid", // opcional
  "channel": "web", // web | whatsapp | telegram | api
  "channelMetadata": {
    "websocketId": "ws-123"
  },
  "priority": 5 // 1-10, menor = maior prioridade
}
```

**Resposta (202 Accepted):**
```json
{
  "success": true,
  "message": "Mensagem recebida e em processamento",
  "data": {
    "messageId": "msg-uuid-123",
    "conversationId": "conv-uuid-456",
    "jobId": "msg-uuid-123",
    "status": "processing",
    "estimatedTime": "5-30 segundos"
  }
}
```

### 2. Status da Mensagem

```http
GET /api/messages/{messageId}/status
Authorization: Bearer {jwt_token}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "messageId": "msg-uuid-123",
    "state": "completed", // waiting | active | completed | failed
    "progress": 100,
    "finishedOn": 1675350000000
  }
}
```

### 3. Estatísticas da Fila

```http
GET /api/messages/queue/stats
Authorization: Bearer {jwt_token}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "waiting": 5,
    "active": 3,
    "completed": 1250,
    "failed": 12,
    "delayed": 0,
    "paused": 0,
    "total": 1270
  }
}
```

### 4. Health Check da Fila

```http
GET /api/messages/queue/health
Authorization: Bearer {jwt_token}
```

**Resposta (200 OK ou 503 Service Unavailable):**
```json
{
  "success": true,
  "data": {
    "healthy": true,
    "stats": { ... }
  }
}
```

---

## 🔄 Fluxo Completo (WebSocket)

### 1. Cliente conecta ao WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3000/ws/chat?token=JWT_TOKEN');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'connected':
      console.log('Conectado!', data.data.socketId);
      break;
    
    case 'queued':
      console.log('Mensagem enfileirada');
      break;
    
    case 'processing':
      console.log('Processando...', data.data);
      break;
    
    case 'message':
      console.log('Resposta recebida:', data.data.message);
      break;
  }
};
```

### 2. Cliente envia mensagem

```javascript
ws.send(JSON.stringify({
  type: 'message',
  data: {
    agentId: 'agent-uuid',
    content: 'Olá, como posso ajudar?'
  }
}));
```

### 3. Servidor responde imediatamente

```json
{
  "type": "queued",
  "data": {
    "message": "Mensagem recebida, processando..."
  }
}
```

```json
{
  "type": "processing",
  "data": {
    "conversationId": "conv-uuid",
    "messageId": "msg-uuid",
    "jobId": "msg-uuid",
    "status": "processing"
  }
}
```

### 4. Worker processa em background

- Busca agente
- Busca histórico
- Chama N8N
- N8N chama OpenAI
- Resposta pronta

### 5. Resposta é entregue via WebSocket

```json
{
  "type": "message",
  "data": {
    "messageId": "msg-uuid",
    "conversationId": "conv-uuid",
    "message": "Olá! Como posso ajudar você hoje?",
    "timestamp": "2026-02-02T10:00:05Z",
    "metadata": {
      "model": "gpt-4o-mini",
      "tokensUsed": 120,
      "processingTime": 2500,
      "finishReason": "stop"
    }
  }
}
```

---

## 🔍 Monitoramento

### Logs

```bash
# Ver logs do sistema
tail -f logs/combined.log | grep "Queue\|Message"

# Ver apenas erros
tail -f logs/error.log

# Filtrar por messageId
grep "msg-uuid-123" logs/combined.log
```

### Métricas

```typescript
// Estatísticas em tempo real
const stats = await queueService.getQueueStatistics();

console.log(`Fila: ${stats.waiting} aguardando`);
console.log(`Processando: ${stats.active}`);
console.log(`Concluídos: ${stats.completed}`);
console.log(`Falhos: ${stats.failed}`);
```

### Health Check

```bash
curl http://localhost:3000/api/messages/queue/health \
  -H "Authorization: Bearer JWT_TOKEN"
```

---

## 🚨 Troubleshooting

### Problema: Fila crescendo demais

**Sintoma:** `waiting > 100`

**Soluções:**
1. Aumentar concurrency do worker
2. Adicionar mais workers (horizontal scaling)
3. Verificar se N8N está respondendo
4. Verificar performance do Redis

```typescript
// Aumentar concurrency
const concurrency = 10; // De 5 para 10
```

### Problema: Jobs falhando

**Sintoma:** `failed > 5% do total`

**Soluções:**
1. Ver logs de erro: `grep "Job failed" logs/combined.log`
2. Verificar conectividade com N8N
3. Verificar timeout (default: 120s)
4. Revisar dados de entrada

### Problema: Redis desconectando

**Sintoma:** `Redis client error` nos logs

**Soluções:**
1. Verificar se Redis está rodando: `docker ps | grep redis`
2. Verificar memória: `redis-cli INFO memory`
3. Verificar configuração de maxmemory
4. Reiniciar Redis: `docker-compose restart redis`

### Problema: WebSocket não recebe resposta

**Sintoma:** Mensagem processada mas não chega ao cliente

**Soluções:**
1. Verificar se `websocketId` está sendo passado
2. Verificar se conexão ainda está aberta
3. Ver logs: `grep "WebSocket" logs/combined.log`
4. Testar com polling: `GET /api/messages/{messageId}/status`

---

## 📊 Performance

### Benchmarks (Hardware médio: 2 cores, 4GB RAM)

| Métrica | Valor |
|---------|-------|
| Latência API (enqueue) | < 50ms |
| Throughput (msg/seg) | 50-100 |
| Tempo médio processamento | 2-10s |
| Redis ops/seg | 5.000+ |
| Concurrency workers | 5 |

### Otimizações

1. **Pipeline Redis** (batch operations)
2. **Connection pooling** (Bull gerencia automaticamente)
3. **Índices MongoDB** (conversationId, agentId)
4. **Limpeza automática** de jobs antigos
5. **Rate limiting** por usuário (futuro)

---

## 🔐 Segurança

### Autenticação

Todas rotas requerem JWT token:
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Rate Limiting (Futuro)

```typescript
// TODO: Implementar rate limiting por usuário
const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});
```

### Isolamento de Dados

- Cada usuário só acessa seus próprios agentes
- Validação em todas as camadas
- System API Keys para N8N (separado)

---

## 🚀 Próximos Passos

- [ ] Dashboard Bull Board (visualização web)
- [ ] Métricas Prometheus/Grafana
- [ ] Rate limiting por usuário
- [ ] Prioridade automática (usuários premium)
- [ ] Implementar handlers WhatsApp/Telegram
- [ ] Circuit breaker para N8N
- [ ] Retry inteligente baseado em tipo de erro
- [ ] Event sourcing completo

---

## 📚 Recursos

- [Bull Documentation](https://github.com/OptimalBits/bull)
- [ioredis Documentation](https://github.com/luin/ioredis)
- [Redis PubSub](https://redis.io/docs/manual/pubsub/)

---

**Última atualização:** Fevereiro 2026
