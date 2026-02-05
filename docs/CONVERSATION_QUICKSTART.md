# 🚀 Quick Start - Sistema de Persistência de Conversas

## O que mudou?

Antes, as conversas **NÃO eram salvas** em nenhum local permanente. O histórico ficava apenas no Redis (temporário).

Agora, **TODAS as conversas e mensagens são automaticamente salvas no MongoDB**, com informações completas sobre:
- Origem e destino (WebSocket, WhatsApp, Telegram, API)
- Status de processamento
- Métricas (tokens, tempo de resposta, etc.)
- Histórico completo

## 📦 Componentes Implementados

### 1. Modelos MongoDB
- `Conversation`: Representa uma conversa completa
- `Message`: Representa cada mensagem individual

### 2. Serviço de Persistência
- `conversation.service.ts`: Gerencia todas as operações de conversas/mensagens

### 3. Integração Automática
- `chat.service.ts`: Salva mensagens ao enfileirar
- `message.consumer.ts`: Salva respostas da IA após processamento

### 4. APIs de Consulta
- `conversation.controller.ts`: Endpoints para consultar histórico
- Rotas em `/api/conversations/*`

## 🎯 Como Funciona (Automático)

### Fluxo de Mensagem

```
1. Usuário envia mensagem via WebSocket/API
   ↓
2. [NOVO] Conversa criada/atualizada no MongoDB
   ↓
3. [NOVO] Mensagem do usuário salva (status: queued)
   ↓
4. Mensagem enfileirada no Redis
   ↓
5. Consumer processa com N8N/OpenAI
   ↓
6. [NOVO] Resposta da IA salva no MongoDB (status: delivered)
   ↓
7. Resposta enviada ao usuário via WebSocket/Webhook
```

**Tudo é automático! Você não precisa mudar nada no fluxo atual.**

## 🔧 Setup

### 1. Migrar Índices (Opcional, mas recomendado)

```bash
npm run migrate:indexes
```

Isso cria índices otimizados no MongoDB para melhorar performance.

### 2. Reiniciar o Backend

```bash
npm run dev
```

Pronto! O sistema já está salvando tudo automaticamente.

## 📖 Como Consultar o Histórico

### Listar conversas de um agente

```bash
curl -X GET "http://localhost:3000/api/agents/1/conversations" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Ver mensagens de uma conversa

```bash
curl -X GET "http://localhost:3000/api/conversations/CONVERSATION_ID/messages" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Ver conversa completa (conversa + mensagens)

```bash
curl -X GET "http://localhost:3000/api/conversations/CONVERSATION_ID/full" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Buscar conversa por origem (ex: WhatsApp)

```bash
curl -X POST "http://localhost:3000/api/conversations/find-by-source" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "1",
    "sourceType": "whatsapp",
    "sourceIdentifier": {
      "phoneNumber": "+5511999999999"
    }
  }'
```

## 🌐 Endpoints Disponíveis

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/conversations/:id` | Buscar conversa específica |
| GET | `/api/conversations/:id/messages` | Buscar mensagens de uma conversa |
| GET | `/api/conversations/:id/full` | Buscar conversa completa (conversa + mensagens) |
| GET | `/api/agents/:agentId/conversations` | Listar conversas de um agente |
| GET | `/api/agents/:agentId/conversations/stats` | Estatísticas de conversas |
| GET | `/api/users/:userId/conversations` | Listar conversas de um usuário |
| PATCH | `/api/conversations/:id/status` | Atualizar status (active, closed, paused) |
| POST | `/api/conversations/find-by-source` | Buscar conversa por origem |

## 📊 Informações Salvas

### Conversa (Conversation)
```json
{
  "conversationId": "uuid",
  "agentId": "1",
  "userId": "123",
  "source": {
    "type": "websocket",
    "socketId": "socket-123",
    "name": "User 123"
  },
  "destination": {
    "type": "system",
    "systemId": "1",
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
```

### Mensagem (Message)
```json
{
  "messageId": "uuid",
  "conversationId": "uuid",
  "agentId": "1",
  "content": "Olá, preciso de ajuda",
  "type": "user",
  "direction": "inbound",
  "role": "user",
  "status": "delivered",
  "createdAt": "2024-01-01T10:00:00Z",
  "channel": "web",
  "processingTime": 1234,
  "tokensUsed": 150,
  "model": "gpt-4"
}
```

## 🎨 Cenários de Uso

### WebSocket (Chat Web)
- Origem: `{ type: 'websocket', socketId: 'socket-123' }`
- Canal: `web`

### WhatsApp
- Origem: `{ type: 'whatsapp', phoneNumber: '+5511999999999' }`
- Canal: `whatsapp`

### Telegram
- Origem: `{ type: 'telegram', telegramChatId: '12345' }`
- Canal: `telegram`

### API
- Origem: `{ type: 'api', apiClientId: 'client-id' }`
- Canal: `api`

## 📚 Documentação Completa

- **[CONVERSATION_PERSISTENCE.md](./CONVERSATION_PERSISTENCE.md)**: Documentação técnica completa
- **[CONVERSATION_EXAMPLES.md](./CONVERSATION_EXAMPLES.md)**: Exemplos práticos de código

## 🔍 Verificar se Está Funcionando

### 1. Envie uma mensagem via WebSocket ou API

```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "agentId": "1",
    "content": "Teste de mensagem",
    "channel": "web"
  }'
```

### 2. Aguarde alguns segundos (processamento)

### 3. Consulte as mensagens salvas

```bash
curl -X GET "http://localhost:3000/api/agents/1/conversations" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Você verá a conversa criada com todas as mensagens!

## ❓ FAQ

### As mensagens antigas serão salvas?
Não, apenas as novas mensagens (a partir de agora) serão salvas.

### O Redis continua sendo usado?
Sim! O Redis continua gerenciando o histórico temporário para o N8N. O MongoDB é uma camada adicional de persistência.

### Isso afeta a performance?
Não! As operações de salvamento são assíncronas e não bloqueiam o fluxo principal.

### E se o MongoDB falhar?
As mensagens continuam sendo processadas normalmente, apenas não são persistidas.

### Preciso mudar algo no código existente?
Não! Tudo é automático. Apenas use as novas APIs para consultar o histórico.

---

**Pronto para usar!** 🎉
