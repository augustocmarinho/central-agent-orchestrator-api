# Sistema de Persistência de Conversas

## 📋 Visão Geral

O sistema de persistência de conversas salva **todas as conversas e mensagens** no MongoDB, mantendo um histórico completo de interações entre usuários e agentes de IA.

### Principais Características

✅ **Persistência Completa**: Todas as conversas e mensagens são salvas automaticamente  
✅ **Origem e Destino**: Rastreamento de contatos para WhatsApp, Telegram, WebSocket e API  
✅ **Histórico Detalhado**: Informações completas sobre tipo, direção, status e processamento  
✅ **Consultas Flexíveis**: APIs para buscar conversas por agente, usuário, canal, etc.  
✅ **Estatísticas**: Contadores automáticos de mensagens e análise de uso  

---

## 🗄️ Estrutura de Dados

### Modelo: Conversation

Representa uma conversa entre um usuário e um agente.

```typescript
interface IConversation {
  conversationId: string;          // UUID único da conversa
  agentId: string;                 // ID do agente
  userId?: string;                 // ID do usuário (se autenticado)
  
  // Origem e Destino
  source: IContact;                // Contato de origem (usuário)
  destination: IContact;           // Contato de destino (agente)
  
  // Informações do canal
  channel: 'web' | 'whatsapp' | 'telegram' | 'api';
  channelMetadata?: Record<string, any>;
  
  // Status e timestamps
  status: 'active' | 'closed' | 'transferred' | 'paused';
  startedAt: Date;
  lastMessageAt?: Date;
  endedAt?: Date;
  
  // Estatísticas
  messageCount: number;            // Total de mensagens
  userMessageCount: number;        // Mensagens do usuário
  assistantMessageCount: number;   // Mensagens do assistente
  
  // Metadados gerais
  metadata?: Record<string, any>;
}
```

### Modelo: Contact (Origem/Destino)

Identifica os participantes da conversa.

```typescript
interface IContact {
  type: 'websocket' | 'whatsapp' | 'telegram' | 'api' | 'system';
  
  // WebSocket
  socketId?: string;
  
  // WhatsApp
  phoneNumber?: string;
  whatsappChatId?: string;
  
  // Telegram
  telegramChatId?: string;
  telegramUserId?: string;
  telegramUsername?: string;
  
  // API
  apiClientId?: string;
  callbackUrl?: string;
  
  // Sistema
  systemId?: string;
  
  // Informações adicionais
  name?: string;
  metadata?: Record<string, any>;
}
```

### Modelo: Message

Representa uma mensagem individual dentro de uma conversa.

```typescript
interface IMessage {
  messageId: string;               // UUID único da mensagem
  conversationId: string;          // UUID da conversa
  
  // Identificação
  agentId: string;
  userId?: string;
  
  // Conteúdo
  content: string;
  
  // Classificação
  type: 'user' | 'assistant' | 'system' | 'external';
  direction: 'inbound' | 'outbound';
  role: 'user' | 'assistant' | 'system';
  
  // Status
  status: 'queued' | 'processing' | 'delivered' | 'failed' | 'cancelled';
  
  // Timestamps
  queuedAt?: Date;
  processedAt?: Date;
  deliveredAt?: Date;
  createdAt: Date;
  
  // Informações de processamento (para assistente)
  processingTime?: number;         // Tempo de processamento (ms)
  tokensUsed?: number;             // Tokens consumidos
  model?: string;                  // Modelo de IA usado
  finishReason?: string;           // Motivo de finalização
  
  // Informações do canal
  channel: 'web' | 'whatsapp' | 'telegram' | 'api';
  channelMetadata?: Record<string, any>;
  
  // Referências
  replyToMessageId?: string;       // ID da mensagem sendo respondida
  executionId?: string;
  jobId?: string;
  
  // Erros
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  
  // Metadados
  metadata?: Record<string, any>;
}
```

---

## 🔄 Fluxo de Funcionamento

### 1. Recebimento de Mensagem do Usuário

```
WebSocket/API → chat.service.ts
  ↓
1. Validar agente
2. Criar/buscar conversa no MongoDB
3. Salvar mensagem do usuário (status: queued)
4. Enfileirar para processamento
```

### 2. Processamento pela IA

```
message.consumer.ts
  ↓
1. Atualizar mensagem do usuário (status: processing)
2. Chamar N8N/OpenAI
3. Salvar resposta do assistente (status: delivered)
4. Atualizar mensagem do usuário (status: delivered)
5. Publicar resposta via WebSocket/Webhook
```

### 3. Entrega ao Usuário

```
web.handler.ts (ou whatsapp/telegram.handler.ts)
  ↓
Enviar mensagem via canal apropriado
```

---

## 📡 APIs de Consulta

### Buscar Conversa Específica

```http
GET /api/conversations/:conversationId
Authorization: Bearer {token}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "conversationId": "uuid",
    "agentId": "agent-123",
    "userId": "user-456",
    "source": {
      "type": "websocket",
      "socketId": "socket-789",
      "name": "User 456"
    },
    "destination": {
      "type": "system",
      "systemId": "agent-123",
      "name": "Assistente Virtual"
    },
    "channel": "web",
    "status": "active",
    "startedAt": "2024-01-01T10:00:00Z",
    "lastMessageAt": "2024-01-01T10:05:00Z",
    "messageCount": 10,
    "userMessageCount": 5,
    "assistantMessageCount": 5
  }
}
```

### Buscar Mensagens de uma Conversa

```http
GET /api/conversations/:conversationId/messages?limit=50&offset=0&order=asc
Authorization: Bearer {token}
```

**Parâmetros:**
- `limit` (opcional): Número de mensagens (padrão: 100)
- `offset` (opcional): Offset para paginação (padrão: 0)
- `order` (opcional): Ordenação `asc` ou `desc` (padrão: asc)

**Resposta:**
```json
{
  "success": true,
  "data": [
    {
      "messageId": "msg-uuid-1",
      "conversationId": "conv-uuid",
      "agentId": "agent-123",
      "content": "Olá, preciso de ajuda",
      "type": "user",
      "direction": "inbound",
      "role": "user",
      "status": "delivered",
      "createdAt": "2024-01-01T10:00:00Z",
      "channel": "web"
    },
    {
      "messageId": "msg-uuid-2",
      "conversationId": "conv-uuid",
      "agentId": "agent-123",
      "content": "Olá! Como posso ajudar você?",
      "type": "assistant",
      "direction": "outbound",
      "role": "assistant",
      "status": "delivered",
      "processingTime": 1234,
      "tokensUsed": 150,
      "model": "gpt-4",
      "createdAt": "2024-01-01T10:00:02Z",
      "channel": "web"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "count": 2
  }
}
```

### Buscar Conversa Completa (com mensagens)

```http
GET /api/conversations/:conversationId/full?limit=100&offset=0
Authorization: Bearer {token}
```

**Resposta:** Retorna conversa + mensagens em um único request.

### Listar Conversas de um Agente

```http
GET /api/agents/:agentId/conversations?status=active&limit=50&offset=0
Authorization: Bearer {token}
```

**Parâmetros:**
- `status` (opcional): `active`, `closed`, `transferred`, `paused`
- `limit` (opcional): Número de conversas (padrão: 50)
- `offset` (opcional): Offset para paginação (padrão: 0)

### Listar Conversas de um Usuário

```http
GET /api/users/:userId/conversations?status=active&limit=50&offset=0
Authorization: Bearer {token}
```

### Atualizar Status de Conversa

```http
PATCH /api/conversations/:conversationId/status
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "closed"
}
```

**Status válidos:** `active`, `closed`, `transferred`, `paused`

### Buscar Conversa por Origem (WhatsApp/Telegram)

```http
POST /api/conversations/find-by-source
Authorization: Bearer {token}
Content-Type: application/json

{
  "agentId": "agent-123",
  "sourceType": "whatsapp",
  "sourceIdentifier": {
    "phoneNumber": "+5511999999999"
  },
  "status": "active"
}
```

**Útil para:**
- WhatsApp: Encontrar conversa ativa com um número
- Telegram: Encontrar conversa ativa com um chat
- WebSocket: Encontrar conversa ativa com um socket

### Estatísticas de Conversas

```http
GET /api/agents/:agentId/conversations/stats?from=2024-01-01&to=2024-01-31
Authorization: Bearer {token}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "totalConversations": 150,
    "activeConversations": 25,
    "closedConversations": 125,
    "totalMessages": 3000
  }
}
```

---

## 🔍 Exemplos de Uso

### WebSocket (Frontend)

```javascript
const ws = new WebSocket('ws://localhost:3000/ws/chat?token=YOUR_TOKEN');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'connected') {
    // Conectado
    console.log('Socket ID:', data.data.socketId);
    
    // Entrar em uma conversa
    ws.send(JSON.stringify({
      type: 'join',
      data: {
        agentId: 'agent-123',
        conversationId: 'existing-conv-id' // Opcional
      }
    }));
  }
  
  if (data.type === 'message') {
    // Resposta da IA
    console.log('Resposta:', data.data.message);
  }
};

// Enviar mensagem
ws.send(JSON.stringify({
  type: 'message',
  data: {
    agentId: 'agent-123',
    content: 'Olá, preciso de ajuda'
  }
}));
```

### WhatsApp Integration

```javascript
// Quando receber mensagem do WhatsApp
const phoneNumber = '+5511999999999';

// 1. Buscar ou criar conversa
let conversation = await fetch('/api/conversations/find-by-source', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    agentId: 'agent-123',
    sourceType: 'whatsapp',
    sourceIdentifier: { phoneNumber },
    status: 'active'
  })
});

if (!conversation.ok) {
  // Criar nova conversa
  // Isso será feito automaticamente ao enviar a primeira mensagem
}

// 2. Enviar mensagem
const response = await fetch('/api/messages', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    agentId: 'agent-123',
    content: 'Mensagem do usuário',
    channel: 'whatsapp',
    channelMetadata: {
      phoneNumber,
      whatsappChatId: 'chat-id',
      name: 'Nome do Usuário'
    }
  })
});
```

### Consultar Histórico

```javascript
// Buscar últimas conversas do agente
const conversations = await fetch(
  '/api/agents/agent-123/conversations?status=active&limit=10',
  {
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
).then(r => r.json());

// Buscar mensagens de uma conversa específica
const messages = await fetch(
  `/api/conversations/${conversationId}/messages?limit=100&order=asc`,
  {
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
).then(r => r.json());

// Buscar conversa completa (conversa + mensagens)
const full = await fetch(
  `/api/conversations/${conversationId}/full`,
  {
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
).then(r => r.json());
```

---

## 🎯 Cenários de Uso

### 1. Chat Web (WebSocket)

- **Origem**: `{ type: 'websocket', socketId: 'socket-123' }`
- **Destino**: `{ type: 'system', systemId: 'agent-id' }`
- **Canal**: `web`

### 2. WhatsApp

- **Origem**: `{ type: 'whatsapp', phoneNumber: '+5511999999999' }`
- **Destino**: `{ type: 'system', systemId: 'agent-id' }`
- **Canal**: `whatsapp`

### 3. Telegram

- **Origem**: `{ type: 'telegram', telegramChatId: '12345' }`
- **Destino**: `{ type: 'system', systemId: 'agent-id' }`
- **Canal**: `telegram`

### 4. API

- **Origem**: `{ type: 'api', apiClientId: 'client-id' }`
- **Destino**: `{ type: 'system', systemId: 'agent-id' }`
- **Canal**: `api`

---

## 🔐 Segurança

- ✅ Todas as rotas exigem autenticação via JWT
- ✅ Usuários só podem acessar suas próprias conversas
- ✅ System tokens podem acessar qualquer conversa (para N8N/integrations)
- ✅ Validação de permissões no nível do controller

---

## 📊 Índices do MongoDB

Os seguintes índices foram criados para otimizar consultas:

### Conversation
- `conversationId` (unique)
- `agentId` + `status` + `startedAt`
- `userId` + `startedAt`
- `source.phoneNumber` (para WhatsApp)
- `source.telegramChatId` (para Telegram)

### Message
- `messageId` (unique)
- `conversationId` + `createdAt`
- `agentId` + `createdAt`
- `userId` + `createdAt`
- `type` + `status` + `createdAt`

---

## 🚀 Próximos Passos

1. ✅ Implementar handlers para WhatsApp e Telegram
2. ✅ Adicionar suporte a anexos/mídias
3. ✅ Implementar busca full-text em mensagens
4. ✅ Dashboard de análise de conversas
5. ✅ Export de conversas (JSON, CSV, PDF)

---

## 📝 Notas Importantes

- **Redis vs MongoDB**: O histórico de chat continua no Redis para o N8N (performance), mas tudo também é persistido no MongoDB para análise e consultas.
- **Performance**: As operações de salvamento são assíncronas e não bloqueiam o fluxo principal.
- **Resiliência**: Se o MongoDB falhar, as mensagens continuam sendo processadas normalmente (apenas não são persistidas).

---

## 🐛 Troubleshooting

### Mensagens não estão sendo salvas

1. Verificar se MongoDB está conectado:
```bash
# No terminal
curl http://localhost:3000/api/health
```

2. Verificar logs:
```bash
# No terminal do backend
# Procurar por: "Message saved" e "Conversation created"
```

### Conversa não está sendo encontrada

1. Verificar se `conversationId` está correto
2. Usar a rota `find-by-source` para buscar por origem
3. Verificar se o status da conversa é `active`

---

**Documentação atualizada em:** 2024
**Versão:** 1.0.0
