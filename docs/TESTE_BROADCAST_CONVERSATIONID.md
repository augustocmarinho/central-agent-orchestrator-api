# 🧪 Teste: Broadcast por ConversationId

## 📋 O Que Foi Implementado

O `WebHandler` agora entrega mensagens via WebSocket usando **2 estratégias em cascata**:

1. **Estratégia 1 (Preferencial):** Por `socketId` específico
2. **Estratégia 2 (Fallback):** Broadcast para TODAS as conexões com o mesmo `conversationId`

---

## 🎯 Cenário de Teste

Você abre um WebSocket, faz conversas normais, e depois envia uma mensagem via POST REST API. A mensagem deve chegar no WebSocket aberto, mesmo sem passar o `socketId` no POST.

---

## 🔧 Passo a Passo do Teste

### 1️⃣ Reiniciar o Servidor

```bash
# Parar o servidor atual (Ctrl+C)
# Iniciar novamente
cd back
yarn dev
```

### 2️⃣ Conectar WebSocket

Abra o Console do navegador ou use um cliente WebSocket:

```javascript
// No navegador (Console)
const token = 'SEU_JWT_TOKEN'; // Token obtido do login
const ws = new WebSocket(`ws://localhost:3000/ws/chat?token=${token}`);

ws.onopen = () => {
  console.log('✅ WebSocket conectado');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('📩 Mensagem recebida:', data);
  
  // Salvar socketId quando conectar
  if (data.type === 'connected') {
    console.log('🆔 SocketId:', data.data.socketId);
    window.socketId = data.data.socketId;
  }
};
```

### 3️⃣ Fazer "Join" em uma Conversa (ou criar nova)

```javascript
// Opção A: Entrar em conversa existente
ws.send(JSON.stringify({
  type: 'join',
  data: {
    agentId: 'SEU_AGENT_ID',
    conversationId: 'conv-existente-123' // Use um conversationId existente
  }
}));

// OU

// Opção B: Enviar mensagem e criar nova conversa
ws.send(JSON.stringify({
  type: 'message',
  data: {
    agentId: 'SEU_AGENT_ID',
    content: 'Primeira mensagem via WebSocket'
  }
}));

// Vai receber de volta:
// { type: 'processing', data: { conversationId: '...', ... } }
// ANOTE o conversationId recebido!
```

### 4️⃣ Enviar Mensagem via POST (Mesmo conversationId)

Agora, com o WebSocket AINDA ABERTO, faça um POST via curl/Postman:

```bash
# Use o MESMO conversationId do passo anterior
curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer SEU_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "SEU_AGENT_ID",
    "conversationId": "conv-existente-123",
    "message": "Mensagem enviada via POST REST API",
    "channel": "web"
  }'
```

**IMPORTANTE:** Não precisa passar `channelMetadata.websocketId`!

### 5️⃣ Verificar Resultado

No Console do navegador (onde o WebSocket está aberto), você deve ver:

```javascript
// 📩 Mensagem recebida:
{
  type: 'message',
  data: {
    messageId: 'msg-xxx',
    conversationId: 'conv-existente-123',
    message: 'Resposta do N8N para mensagem enviada via POST',
    timestamp: '2026-02-02T...',
    metadata: {
      model: 'gpt-4',
      tokensUsed: 234,
      processingTime: 3456,
      finishReason: 'stop'
    }
  }
}
```

---

## 📊 Logs Esperados (Backend)

### ✅ Sucesso - Entregue por socketId

```
✅ Message delivered via WebSocket (by socketId)
   socketId: abc-123
   messageId: msg-xxx
   conversationId: conv-456
```

### ✅ Sucesso - Broadcast por conversationId

```
✅ Message delivered via WebSocket (by conversationId)
   socketId: abc-123
   messageId: msg-xxx
   conversationId: conv-456

📡 Message broadcasted to 1 WebSocket(s)
   messageId: msg-xxx
   conversationId: conv-456
```

### ⚠️ Nenhuma Conexão Encontrada

```
❌ No WebSocket available for delivery
   socketId: undefined
   conversationId: conv-456
   messageId: msg-xxx
   reason: No matching WebSocket connection found (by socketId or conversationId)
```

---

## 🔍 Cenários Testados

| Cenário | socketId | conversationId WS | Resultado Esperado |
|---------|----------|-------------------|-------------------|
| POST com socketId | ✅ Fornecido | ✅ Match | ✅ Entrega por socketId |
| POST sem socketId | ❌ Não | ✅ Match | ✅ Broadcast por conversationId |
| POST sem socketId | ❌ Não | ❌ Não match | ❌ Log de aviso, não entrega |
| WS fechado | ✅ Fornecido | ✅ Match | ⚠️ Não entrega (conexão fechada) |

---

## 🎯 Casos de Uso

### Caso 1: Múltiplos Dispositivos
```
Cliente abre WebSocket no celular   → conversationId: conv-123
Cliente abre WebSocket no desktop   → conversationId: conv-123
Serviço externo envia POST          → conversationId: conv-123
Resultado: AMBOS os WebSockets recebem! 📱💻
```

### Caso 2: Integração com Serviço Externo
```
Cliente abre chat no site           → conversationId: conv-456
Sistema de notificações envia POST  → conversationId: conv-456
Resultado: Cliente recebe notificação no chat aberto! 🔔
```

### Caso 3: API de Teste/Debug
```
Dev abre WebSocket no browser       → conversationId: conv-789
Dev testa via Postman/curl          → conversationId: conv-789
Resultado: Vê resposta no WebSocket em tempo real! 🧪
```

---

## 🐛 Troubleshooting

### Problema: Mensagem não chegou

**Checklist:**

1. ✅ WebSocket está conectado? (`ws.readyState === 1`)
2. ✅ WebSocket fez "join" ou enviou mensagem (tem `conversationId` setado)?
3. ✅ POST usou o MESMO `conversationId`?
4. ✅ Verificar logs do backend procurando por:
   - `Message delivered via WebSocket`
   - `No WebSocket available for delivery`

```bash
# Ver logs em tempo real
tail -f logs/combined.log | grep -i "websocket\|delivered\|broadcast"
```

### Debug no Console do Navegador

```javascript
// Verificar se conversationId foi setado
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('📩', data);
  
  if (data.type === 'joined') {
    console.log('✅ ConversationId setado:', data.data.conversationId);
  }
  
  if (data.type === 'processing') {
    console.log('✅ ConversationId da nova conversa:', data.data.conversationId);
  }
};
```

---

## 📝 Como Funciona (Internamente)

```
┌─────────────────────────────────────────────────┐
│ POST /api/messages                              │
│ conversationId: "conv-123"                      │
│ channelMetadata: {} (SEM socketId)              │
└───────────────┬─────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────┐
│ Consumer processa → N8N → Publica PubSub        │
└───────────────┬─────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────┐
│ WebHandler.deliver(event)                       │
│   - socketId? → NÃO                             │
│   - conversationId? → SIM: "conv-123"           │
│   - Busca conexões com conversationId="conv-123"│
│   - Encontra ws.socketId="abc-xyz"              │
│   - Envia: ws.send(payload) ✅                  │
└─────────────────────────────────────────────────┘
```

---

## ✅ Pronto para Testar!

Siga os passos acima e me avise:
- ✅ Funcionou perfeitamente
- ⚠️ Mensagem não chegou (envie os logs)
- 🐛 Outro erro

Boa sorte! 🚀
