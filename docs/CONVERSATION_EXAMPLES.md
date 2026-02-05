# Exemplos de Uso - Sistema de Persistência de Conversas

## 🚀 Quick Start

### 1. Migrar Índices do MongoDB

Primeiro, execute a migração para criar os índices otimizados:

```bash
npm run migrate:indexes
```

### 2. Testar via API

#### A. Enviar uma mensagem (cria conversa automaticamente)

```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "agentId": "1",
    "content": "Olá, preciso de ajuda com meu pedido",
    "channel": "web"
  }'
```

**Resposta:**
```json
{
  "success": true,
  "conversationId": "550e8400-e29b-41d4-a716-446655440000",
  "messageId": "660e8400-e29b-41d4-a716-446655440001",
  "jobId": "123",
  "status": "processing"
}
```

#### B. Consultar conversa criada

```bash
curl -X GET http://localhost:3000/api/conversations/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### C. Consultar mensagens da conversa

```bash
curl -X GET "http://localhost:3000/api/conversations/550e8400-e29b-41d4-a716-446655440000/messages?limit=50" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### D. Consultar conversa completa (conversa + mensagens)

```bash
curl -X GET http://localhost:3000/api/conversations/550e8400-e29b-41d4-a716-446655440000/full \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 📱 Exemplo: Integração WhatsApp

### Fluxo Completo

```javascript
// ============================================
// 1. Receber mensagem do WhatsApp
// ============================================

const incomingMessage = {
  from: '+5511999999999',
  text: 'Olá, gostaria de saber sobre produtos',
  whatsappChatId: 'whatsapp-chat-123',
  name: 'João Silva'
};

// ============================================
// 2. Buscar conversa ativa existente
// ============================================

let conversation = await fetch('http://localhost:3000/api/conversations/find-by-source', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    agentId: 'agent-1',
    sourceType: 'whatsapp',
    sourceIdentifier: {
      phoneNumber: incomingMessage.from
    },
    status: 'active'
  })
}).then(r => r.json());

// ============================================
// 3. Enviar mensagem (cria conversa se não existir)
// ============================================

const response = await fetch('http://localhost:3000/api/messages', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    agentId: 'agent-1',
    content: incomingMessage.text,
    conversationId: conversation?.data?.conversationId, // Opcional
    channel: 'whatsapp',
    channelMetadata: {
      phoneNumber: incomingMessage.from,
      whatsappChatId: incomingMessage.whatsappChatId,
      name: incomingMessage.name
    }
  })
}).then(r => r.json());

console.log('Mensagem enviada:', response);
// {
//   "conversationId": "uuid",
//   "messageId": "uuid",
//   "status": "processing"
// }

// ============================================
// 4. Aguardar resposta (via webhook ou polling)
// ============================================

// Opção A: Webhook (configurar no N8N)
app.post('/webhook/whatsapp-response', async (req, res) => {
  const { conversationId, message } = req.body;
  
  // Enviar resposta de volta para o WhatsApp
  await sendWhatsAppMessage(incomingMessage.from, message);
  
  res.json({ success: true });
});

// Opção B: Polling (consultar status da mensagem)
const checkStatus = async (messageId) => {
  const status = await fetch(`http://localhost:3000/api/messages/${messageId}/status`, {
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }).then(r => r.json());
  
  if (status.state === 'completed') {
    // Enviar resposta
    await sendWhatsAppMessage(
      incomingMessage.from, 
      status.response.message
    );
  }
};

// ============================================
// 5. Consultar histórico da conversa
// ============================================

const history = await fetch(
  `http://localhost:3000/api/conversations/${response.conversationId}/messages`,
  {
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
).then(r => r.json());

console.log('Histórico:', history.data);
```

---

## 💬 Exemplo: WebSocket (Chat Web)

### Frontend

```javascript
class ChatClient {
  constructor(token, agentId) {
    this.token = token;
    this.agentId = agentId;
    this.conversationId = null;
    this.ws = null;
  }

  connect() {
    this.ws = new WebSocket(`ws://localhost:3000/ws/chat?token=${this.token}`);
    
    this.ws.onopen = () => {
      console.log('✅ Conectado ao WebSocket');
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };
    
    this.ws.onerror = (error) => {
      console.error('❌ Erro no WebSocket:', error);
    };
    
    this.ws.onclose = () => {
      console.log('🔌 Conexão fechada');
    };
  }

  handleMessage(data) {
    switch (data.type) {
      case 'connected':
        console.log('Socket ID:', data.data.socketId);
        this.joinConversation();
        break;
      
      case 'joined':
        console.log('Entrou na conversa:', data.data.conversationId);
        this.conversationId = data.data.conversationId;
        this.loadHistory();
        break;
      
      case 'message':
        console.log('Nova mensagem:', data.data.message);
        this.displayMessage('assistant', data.data.message);
        break;
      
      case 'queued':
        console.log('Mensagem enfileirada');
        break;
      
      case 'processing':
        console.log('Processando mensagem...');
        this.showTypingIndicator();
        break;
      
      case 'error':
        console.error('Erro:', data.data.error);
        break;
    }
  }

  joinConversation(conversationId = null) {
    this.ws.send(JSON.stringify({
      type: 'join',
      data: {
        agentId: this.agentId,
        conversationId: conversationId // Opcional: retomar conversa existente
      }
    }));
  }

  sendMessage(text) {
    this.displayMessage('user', text);
    
    this.ws.send(JSON.stringify({
      type: 'message',
      data: {
        agentId: this.agentId,
        content: text,
        conversationId: this.conversationId
      }
    }));
  }

  async loadHistory() {
    if (!this.conversationId) return;
    
    const response = await fetch(
      `http://localhost:3000/api/conversations/${this.conversationId}/messages?limit=50`,
      {
        headers: { 'Authorization': `Bearer ${this.token}` }
      }
    );
    
    const { data: messages } = await response.json();
    
    messages.forEach(msg => {
      this.displayMessage(msg.type, msg.content, false);
    });
  }

  displayMessage(type, text, animate = true) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${type}`;
    messageDiv.textContent = text;
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  showTypingIndicator() {
    // Mostrar indicador de digitação
    const indicator = document.createElement('div');
    indicator.id = 'typing-indicator';
    indicator.textContent = '...';
    document.getElementById('messages').appendChild(indicator);
  }

  hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
  }
}

// Uso
const chat = new ChatClient('YOUR_JWT_TOKEN', 'agent-1');
chat.connect();

// Enviar mensagem
document.getElementById('send-btn').addEventListener('click', () => {
  const input = document.getElementById('message-input');
  chat.sendMessage(input.value);
  input.value = '';
});
```

### HTML

```html
<!DOCTYPE html>
<html>
<head>
  <title>Chat AI</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    #messages { height: 400px; border: 1px solid #ccc; padding: 10px; overflow-y: scroll; margin-bottom: 10px; }
    .message { padding: 8px; margin: 5px 0; border-radius: 5px; }
    .message-user { background: #e3f2fd; text-align: right; }
    .message-assistant { background: #f5f5f5; text-align: left; }
    #typing-indicator { color: #999; font-style: italic; }
    #input-area { display: flex; gap: 10px; }
    #message-input { flex: 1; padding: 10px; }
    #send-btn { padding: 10px 20px; background: #2196f3; color: white; border: none; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Chat AI</h1>
  <div id="messages"></div>
  <div id="input-area">
    <input type="text" id="message-input" placeholder="Digite sua mensagem..." />
    <button id="send-btn">Enviar</button>
  </div>
  
  <script src="chat-client.js"></script>
</body>
</html>
```

---

## 📊 Exemplo: Dashboard de Análise

```javascript
// ============================================
// Dashboard de Conversas
// ============================================

async function loadDashboard(agentId) {
  // 1. Estatísticas gerais
  const stats = await fetch(
    `http://localhost:3000/api/agents/${agentId}/conversations/stats`,
    {
      headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
    }
  ).then(r => r.json());

  console.log('Estatísticas:', stats.data);
  // {
  //   "totalConversations": 150,
  //   "activeConversations": 25,
  //   "closedConversations": 125,
  //   "totalMessages": 3000
  // }

  // 2. Conversas ativas
  const activeConversations = await fetch(
    `http://localhost:3000/api/agents/${agentId}/conversations?status=active&limit=10`,
    {
      headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
    }
  ).then(r => r.json());

  console.log('Conversas ativas:', activeConversations.data);

  // 3. Últimas mensagens de cada conversa
  for (const conv of activeConversations.data) {
    const messages = await fetch(
      `http://localhost:3000/api/conversations/${conv.conversationId}/messages?limit=1&order=desc`,
      {
        headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
      }
    ).then(r => r.json());

    console.log(`Última mensagem de ${conv.conversationId}:`, messages.data[0]);
  }

  // 4. Renderizar dashboard
  renderDashboard(stats.data, activeConversations.data);
}

function renderDashboard(stats, conversations) {
  // Implementar UI do dashboard
  document.getElementById('total-conversations').textContent = stats.totalConversations;
  document.getElementById('active-conversations').textContent = stats.activeConversations;
  document.getElementById('total-messages').textContent = stats.totalMessages;

  const conversationsList = document.getElementById('conversations-list');
  conversationsList.innerHTML = '';

  conversations.forEach(conv => {
    const div = document.createElement('div');
    div.className = 'conversation-item';
    div.innerHTML = `
      <h3>${conv.source.name || 'Usuário'}</h3>
      <p>Canal: ${conv.channel}</p>
      <p>Mensagens: ${conv.messageCount}</p>
      <p>Última atividade: ${new Date(conv.lastMessageAt).toLocaleString()}</p>
      <button onclick="openConversation('${conv.conversationId}')">Ver conversa</button>
    `;
    conversationsList.appendChild(div);
  });
}

async function openConversation(conversationId) {
  const full = await fetch(
    `http://localhost:3000/api/conversations/${conversationId}/full`,
    {
      headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
    }
  ).then(r => r.json());

  console.log('Conversa completa:', full.data);
  // Exibir conversa em modal ou nova página
}

// Carregar dashboard
loadDashboard('agent-1');
```

---

## 🔄 Exemplo: Fechar/Gerenciar Conversas

```javascript
// ============================================
// Fechar uma conversa
// ============================================

async function closeConversation(conversationId) {
  const response = await fetch(
    `http://localhost:3000/api/conversations/${conversationId}/status`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'closed'
      })
    }
  ).then(r => r.json());

  console.log('Conversa fechada:', response.data);
}

// ============================================
// Pausar uma conversa
// ============================================

async function pauseConversation(conversationId) {
  const response = await fetch(
    `http://localhost:3000/api/conversations/${conversationId}/status`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'paused'
      })
    }
  ).then(r => r.json());

  console.log('Conversa pausada:', response.data);
}

// ============================================
// Reativar uma conversa
// ============================================

async function reactivateConversation(conversationId) {
  const response = await fetch(
    `http://localhost:3000/api/conversations/${conversationId}/status`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'active'
      })
    }
  ).then(r => r.json());

  console.log('Conversa reativada:', response.data);
}
```

---

## 🧪 Exemplo: Testes

```javascript
// ============================================
// Teste: Criar conversa e enviar mensagens
// ============================================

async function testConversationFlow() {
  console.log('🧪 Iniciando teste de fluxo de conversa...\n');

  // 1. Enviar primeira mensagem
  console.log('1️⃣ Enviando primeira mensagem...');
  const msg1 = await fetch('http://localhost:3000/api/messages', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agentId: 'agent-1',
      content: 'Olá, preciso de ajuda',
      channel: 'web'
    })
  }).then(r => r.json());

  console.log('Resposta:', msg1);
  const conversationId = msg1.conversationId;

  // 2. Aguardar processamento
  console.log('\n2️⃣ Aguardando processamento...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 3. Consultar conversa
  console.log('\n3️⃣ Consultando conversa...');
  const conversation = await fetch(
    `http://localhost:3000/api/conversations/${conversationId}`,
    {
      headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
    }
  ).then(r => r.json());

  console.log('Conversa:', conversation.data);

  // 4. Consultar mensagens
  console.log('\n4️⃣ Consultando mensagens...');
  const messages = await fetch(
    `http://localhost:3000/api/conversations/${conversationId}/messages`,
    {
      headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
    }
  ).then(r => r.json());

  console.log('Mensagens:', messages.data);
  console.log(`Total de mensagens: ${messages.data.length}`);

  // 5. Enviar segunda mensagem
  console.log('\n5️⃣ Enviando segunda mensagem...');
  const msg2 = await fetch('http://localhost:3000/api/messages', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agentId: 'agent-1',
      content: 'Qual o status do meu pedido?',
      conversationId: conversationId,
      channel: 'web'
    })
  }).then(r => r.json());

  console.log('Resposta:', msg2);

  // 6. Aguardar e consultar novamente
  console.log('\n6️⃣ Aguardando e consultando novamente...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  const updatedMessages = await fetch(
    `http://localhost:3000/api/conversations/${conversationId}/messages`,
    {
      headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
    }
  ).then(r => r.json());

  console.log(`Total de mensagens atualizado: ${updatedMessages.data.length}`);

  // 7. Fechar conversa
  console.log('\n7️⃣ Fechando conversa...');
  await fetch(
    `http://localhost:3000/api/conversations/${conversationId}/status`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'closed' })
    }
  );

  console.log('\n✅ Teste concluído!');
}

// Executar teste
testConversationFlow();
```

---

## 📝 Checklist de Implementação

### Backend ✅
- [x] Modelos MongoDB (Conversation, Message)
- [x] Serviço de persistência (conversation.service.ts)
- [x] Integração no fluxo de mensagens
- [x] Controller de conversas
- [x] Rotas de API
- [x] Índices otimizados

### Frontend (Próximos passos)
- [ ] Cliente WebSocket com histórico
- [ ] Dashboard de conversas
- [ ] Visualização de mensagens
- [ ] Gerenciamento de conversas (fechar, pausar, etc.)

### Integrações (Próximos passos)
- [ ] Handler WhatsApp com persistência
- [ ] Handler Telegram com persistência
- [ ] Webhooks de notificação

---

**Documentação atualizada em:** 2024  
**Versão:** 1.0.0
