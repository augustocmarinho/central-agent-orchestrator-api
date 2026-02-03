# 🔌 Guia Completo - WebSocket Chat

## 📋 Visão Geral

O WebSocket permite comunicação em tempo real bidirecional entre cliente e servidor. Quando você envia uma mensagem, ela é processada em background e a resposta é enviada automaticamente via WebSocket.

---

## 🔗 URL de Conexão

### Formato
```
ws://localhost:3000/ws/chat?token=SEU_JWT_TOKEN_AQUI
```

### Componentes
- **Protocolo:** `ws://` (ou `wss://` em produção com HTTPS)
- **Host:** `localhost:3000`
- **Path:** `/ws/chat`
- **Query Param:** `token=JWT_TOKEN` (obrigatório para autenticação)

---

## 🔑 Passo 1: Obter Token JWT

Antes de conectar ao WebSocket, você precisa fazer login:

```bash
# Login via API
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user-uuid",
      "email": "admin@example.com",
      "name": "Admin"
    }
  }
}
```

**Copie o `token` para usar no WebSocket!**

---

## 🌐 Exemplo 1: JavaScript no Navegador

### HTML + JavaScript Completo

Crie um arquivo `websocket-test.html`:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WebSocket Chat Test</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .status {
      padding: 10px;
      margin: 10px 0;
      border-radius: 5px;
      font-weight: bold;
    }
    .connected { background: #d4edda; color: #155724; }
    .disconnected { background: #f8d7da; color: #721c24; }
    .processing { background: #fff3cd; color: #856404; }
    
    input, button, select {
      padding: 10px;
      margin: 5px 0;
      width: 100%;
      border: 1px solid #ddd;
      border-radius: 5px;
      font-size: 14px;
    }
    button {
      background: #007bff;
      color: white;
      border: none;
      cursor: pointer;
      font-weight: bold;
    }
    button:hover { background: #0056b3; }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    
    .messages {
      max-height: 400px;
      overflow-y: auto;
      border: 1px solid #ddd;
      padding: 10px;
      margin: 10px 0;
      background: #fafafa;
      border-radius: 5px;
    }
    .message {
      margin: 10px 0;
      padding: 10px;
      border-radius: 5px;
    }
    .user { background: #e3f2fd; text-align: right; }
    .assistant { background: #f1f8e9; }
    .system { background: #fff3e0; font-style: italic; }
    .error { background: #ffebee; color: #c62828; }
    
    .metadata {
      font-size: 11px;
      color: #666;
      margin-top: 5px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔌 WebSocket Chat Test</h1>
    
    <!-- Status da conexão -->
    <div id="status" class="status disconnected">
      ⚠️ Desconectado
    </div>
    
    <!-- Configuração -->
    <div>
      <h3>Configuração</h3>
      <input 
        type="text" 
        id="token" 
        placeholder="Cole seu JWT token aqui"
        value=""
      />
      <input 
        type="text" 
        id="agentId" 
        placeholder="ID do agente (ex: agent-uuid)"
        value=""
      />
      <button id="connectBtn" onclick="connect()">
        Conectar ao WebSocket
      </button>
      <button id="disconnectBtn" onclick="disconnect()" disabled>
        Desconectar
      </button>
    </div>
    
    <!-- Mensagens -->
    <div>
      <h3>Chat</h3>
      <div id="messages" class="messages">
        <div class="message system">
          💡 Conecte-se ao WebSocket para começar a conversar
        </div>
      </div>
      
      <input 
        type="text" 
        id="messageInput" 
        placeholder="Digite sua mensagem..."
        disabled
        onkeypress="if(event.key === 'Enter') sendMessage()"
      />
      <button id="sendBtn" onclick="sendMessage()" disabled>
        Enviar Mensagem
      </button>
    </div>
    
    <!-- Logs técnicos -->
    <details>
      <summary><strong>📊 Logs Técnicos</strong></summary>
      <div id="logs" style="font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto; background: #f5f5f5; padding: 10px; margin-top: 10px;">
      </div>
    </details>
  </div>

  <script>
    let ws = null;
    let conversationId = null;
    let socketId = null;

    // Conectar ao WebSocket
    function connect() {
      const token = document.getElementById('token').value.trim();
      const agentId = document.getElementById('agentId').value.trim();
      
      if (!token) {
        alert('Por favor, insira o JWT token!');
        return;
      }
      
      if (!agentId) {
        alert('Por favor, insira o ID do agente!');
        return;
      }
      
      // Construir URL do WebSocket
      const wsUrl = `ws://localhost:3000/ws/chat?token=${token}`;
      
      addLog(`🔄 Conectando ao WebSocket...`);
      addLog(`URL: ${wsUrl}`);
      
      // Criar conexão WebSocket
      ws = new WebSocket(wsUrl);
      
      // Evento: Conexão aberta
      ws.onopen = () => {
        addLog('✅ WebSocket conectado!');
        updateStatus('connected', '✅ Conectado');
        document.getElementById('connectBtn').disabled = true;
        document.getElementById('disconnectBtn').disabled = false;
        document.getElementById('messageInput').disabled = false;
        document.getElementById('sendBtn').disabled = false;
      };
      
      // Evento: Mensagem recebida
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        addLog(`📥 Recebido: ${JSON.stringify(data, null, 2)}`);
        handleMessage(data);
      };
      
      // Evento: Erro
      ws.onerror = (error) => {
        addLog(`❌ Erro no WebSocket: ${error}`);
        addSystemMessage('Erro na conexão WebSocket', 'error');
      };
      
      // Evento: Conexão fechada
      ws.onclose = () => {
        addLog('🔌 WebSocket desconectado');
        updateStatus('disconnected', '⚠️ Desconectado');
        document.getElementById('connectBtn').disabled = false;
        document.getElementById('disconnectBtn').disabled = true;
        document.getElementById('messageInput').disabled = true;
        document.getElementById('sendBtn').disabled = true;
        ws = null;
      };
    }
    
    // Desconectar
    function disconnect() {
      if (ws) {
        ws.close();
      }
    }
    
    // Enviar mensagem
    function sendMessage() {
      const messageInput = document.getElementById('messageInput');
      const message = messageInput.value.trim();
      const agentId = document.getElementById('agentId').value.trim();
      
      if (!message) {
        alert('Digite uma mensagem!');
        return;
      }
      
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('WebSocket não está conectado!');
        return;
      }
      
      // Preparar payload
      const payload = {
        type: 'message',
        data: {
          agentId: agentId,
          content: message,
          conversationId: conversationId // Se já existe
        }
      };
      
      addLog(`📤 Enviando: ${JSON.stringify(payload, null, 2)}`);
      
      // Enviar via WebSocket
      ws.send(JSON.stringify(payload));
      
      // Adicionar mensagem do usuário na tela
      addUserMessage(message);
      
      // Limpar input
      messageInput.value = '';
    }
    
    // Processar mensagens recebidas
    function handleMessage(data) {
      switch (data.type) {
        case 'connected':
          // Confirmação de conexão
          socketId = data.data.socketId;
          addSystemMessage(`Conectado! Socket ID: ${socketId}`);
          break;
        
        case 'queued':
          // Mensagem enfileirada
          updateStatus('processing', '⏳ Enfileirado...');
          addSystemMessage('Mensagem recebida, processando...');
          break;
        
        case 'processing':
          // Mensagem em processamento
          updateStatus('processing', '⚙️ Processando...');
          conversationId = data.data.conversationId;
          addSystemMessage(`Processando... (Job: ${data.data.jobId})`);
          break;
        
        case 'message':
          // Resposta do assistente
          updateStatus('connected', '✅ Conectado');
          const response = data.data;
          addAssistantMessage(
            response.message,
            {
              model: response.metadata?.model,
              tokens: response.metadata?.tokensUsed,
              time: response.metadata?.processingTime
            }
          );
          break;
        
        case 'error':
          // Erro
          addSystemMessage(`Erro: ${data.data.error}`, 'error');
          break;
        
        default:
          addLog(`⚠️ Tipo desconhecido: ${data.type}`);
      }
    }
    
    // Adicionar mensagem do usuário
    function addUserMessage(text) {
      const div = document.createElement('div');
      div.className = 'message user';
      div.innerHTML = `<strong>Você:</strong><br/>${text}`;
      document.getElementById('messages').appendChild(div);
      scrollToBottom();
    }
    
    // Adicionar mensagem do assistente
    function addAssistantMessage(text, metadata) {
      const div = document.createElement('div');
      div.className = 'message assistant';
      
      let metaHtml = '';
      if (metadata) {
        metaHtml = `
          <div class="metadata">
            📊 Modelo: ${metadata.model || 'N/A'} | 
            🎫 Tokens: ${metadata.tokens || 'N/A'} | 
            ⏱️ Tempo: ${metadata.time || 'N/A'}ms
          </div>
        `;
      }
      
      div.innerHTML = `<strong>Assistente:</strong><br/>${text}${metaHtml}`;
      document.getElementById('messages').appendChild(div);
      scrollToBottom();
    }
    
    // Adicionar mensagem do sistema
    function addSystemMessage(text, type = 'system') {
      const div = document.createElement('div');
      div.className = `message ${type}`;
      div.innerHTML = `💬 ${text}`;
      document.getElementById('messages').appendChild(div);
      scrollToBottom();
    }
    
    // Atualizar status
    function updateStatus(type, text) {
      const statusDiv = document.getElementById('status');
      statusDiv.className = `status ${type}`;
      statusDiv.textContent = text;
    }
    
    // Adicionar log técnico
    function addLog(text) {
      const logsDiv = document.getElementById('logs');
      const time = new Date().toLocaleTimeString();
      logsDiv.innerHTML += `[${time}] ${text}\n`;
      logsDiv.scrollTop = logsDiv.scrollHeight;
    }
    
    // Scroll automático
    function scrollToBottom() {
      const messagesDiv = document.getElementById('messages');
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  </script>
</body>
</html>
```

### Como Usar:

1. Salve o arquivo como `websocket-test.html`
2. Abra no navegador: `file:///path/to/websocket-test.html`
3. Cole seu JWT token
4. Cole o ID do agente
5. Clique em "Conectar ao WebSocket"
6. Digite mensagens e veja as respostas!

---

## 💻 Exemplo 2: Node.js (CLI)

Crie um arquivo `websocket-client.js`:

```javascript
const WebSocket = require('ws');
const readline = require('readline');

// Configuração
const TOKEN = 'SEU_JWT_TOKEN_AQUI';
const AGENT_ID = 'SEU_AGENT_ID_AQUI';
const WS_URL = `ws://localhost:3000/ws/chat?token=${TOKEN}`;

let conversationId = null;
let ws = null;

// Interface readline para input do usuário
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Conectar ao WebSocket
function connect() {
  console.log(`\n🔄 Conectando ao WebSocket...`);
  console.log(`URL: ${WS_URL}\n`);
  
  ws = new WebSocket(WS_URL);
  
  ws.on('open', () => {
    console.log('✅ WebSocket conectado!\n');
    console.log('Digite suas mensagens (ou "exit" para sair):\n');
    promptUser();
  });
  
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    handleMessage(message);
  });
  
  ws.on('error', (error) => {
    console.error('❌ Erro:', error.message);
  });
  
  ws.on('close', () => {
    console.log('\n🔌 WebSocket desconectado');
    process.exit(0);
  });
}

// Processar mensagens recebidas
function handleMessage(data) {
  switch (data.type) {
    case 'connected':
      console.log(`💬 Sistema: Conectado! Socket ID: ${data.data.socketId}\n`);
      break;
    
    case 'queued':
      console.log('⏳ Sistema: Mensagem enfileirada...\n');
      break;
    
    case 'processing':
      conversationId = data.data.conversationId;
      console.log(`⚙️ Sistema: Processando... (Job: ${data.data.jobId})\n`);
      break;
    
    case 'message':
      const response = data.data;
      console.log('\n' + '='.repeat(60));
      console.log('🤖 Assistente:');
      console.log(response.message);
      console.log('\n📊 Metadados:');
      console.log(`   Modelo: ${response.metadata?.model}`);
      console.log(`   Tokens: ${response.metadata?.tokensUsed}`);
      console.log(`   Tempo: ${response.metadata?.processingTime}ms`);
      console.log('='.repeat(60) + '\n');
      promptUser();
      break;
    
    case 'error':
      console.error(`\n❌ Erro: ${data.data.error}\n`);
      promptUser();
      break;
  }
}

// Solicitar input do usuário
function promptUser() {
  rl.question('Você: ', (input) => {
    const message = input.trim();
    
    if (message.toLowerCase() === 'exit') {
      ws.close();
      return;
    }
    
    if (!message) {
      promptUser();
      return;
    }
    
    // Enviar mensagem
    sendMessage(message);
  });
}

// Enviar mensagem
function sendMessage(content) {
  const payload = {
    type: 'message',
    data: {
      agentId: AGENT_ID,
      content: content,
      conversationId: conversationId
    }
  };
  
  ws.send(JSON.stringify(payload));
}

// Iniciar
connect();
```

### Como Usar:

```bash
# Instalar dependências
npm install ws

# Editar o arquivo e adicionar seu TOKEN e AGENT_ID

# Executar
node websocket-client.js
```

---

## 🔄 Exemplo 3: Python

Crie um arquivo `websocket_client.py`:

```python
import asyncio
import websockets
import json

TOKEN = "SEU_JWT_TOKEN_AQUI"
AGENT_ID = "SEU_AGENT_ID_AQUI"
WS_URL = f"ws://localhost:3000/ws/chat?token={TOKEN}"

conversation_id = None

async def send_message(ws, content):
    """Envia mensagem para o WebSocket"""
    payload = {
        "type": "message",
        "data": {
            "agentId": AGENT_ID,
            "content": content,
            "conversationId": conversation_id
        }
    }
    await ws.send(json.dumps(payload))

async def handle_message(data):
    """Processa mensagens recebidas"""
    global conversation_id
    
    msg_type = data.get("type")
    
    if msg_type == "connected":
        socket_id = data["data"]["socketId"]
        print(f"✅ Conectado! Socket ID: {socket_id}\n")
    
    elif msg_type == "queued":
        print("⏳ Mensagem enfileirada...\n")
    
    elif msg_type == "processing":
        conversation_id = data["data"]["conversationId"]
        job_id = data["data"]["jobId"]
        print(f"⚙️ Processando... (Job: {job_id})\n")
    
    elif msg_type == "message":
        response = data["data"]
        message = response["message"]
        metadata = response.get("metadata", {})
        
        print("\n" + "="*60)
        print("🤖 Assistente:")
        print(message)
        print("\n📊 Metadados:")
        print(f"   Modelo: {metadata.get('model', 'N/A')}")
        print(f"   Tokens: {metadata.get('tokensUsed', 'N/A')}")
        print(f"   Tempo: {metadata.get('processingTime', 'N/A')}ms")
        print("="*60 + "\n")
    
    elif msg_type == "error":
        error = data["data"]["error"]
        print(f"\n❌ Erro: {error}\n")

async def chat():
    """Função principal do chat"""
    async with websockets.connect(WS_URL) as ws:
        print(f"\n🔄 Conectando ao WebSocket...")
        print(f"URL: {WS_URL}\n")
        
        # Task para receber mensagens
        async def receive_messages():
            async for message in ws:
                data = json.loads(message)
                await handle_message(data)
        
        # Iniciar task de recebimento
        receive_task = asyncio.create_task(receive_messages())
        
        # Loop de envio de mensagens
        try:
            await asyncio.sleep(1)  # Aguardar conexão
            print("Digite suas mensagens (ou 'exit' para sair):\n")
            
            while True:
                # Ler input do usuário (de forma assíncrona)
                content = await asyncio.to_thread(input, "Você: ")
                content = content.strip()
                
                if content.lower() == 'exit':
                    break
                
                if content:
                    await send_message(ws, content)
        
        except KeyboardInterrupt:
            print("\n\n👋 Encerrando...")
        
        finally:
            receive_task.cancel()

# Executar
if __name__ == "__main__":
    asyncio.run(chat())
```

### Como Usar:

```bash
# Instalar dependências
pip install websockets

# Editar o arquivo e adicionar seu TOKEN e AGENT_ID

# Executar
python websocket_client.py
```

---

## 📊 Tipos de Mensagens Recebidas

### 1. `connected` - Confirmação de Conexão
```json
{
  "type": "connected",
  "data": {
    "message": "Conectado ao chat",
    "socketId": "ws-uuid-123"
  }
}
```

### 2. `queued` - Mensagem Enfileirada
```json
{
  "type": "queued",
  "data": {
    "message": "Mensagem recebida, processando..."
  }
}
```

### 3. `processing` - Em Processamento
```json
{
  "type": "processing",
  "data": {
    "conversationId": "conv-uuid-456",
    "messageId": "msg-uuid-789",
    "jobId": "msg-uuid-789",
    "status": "processing",
    "message": "Sua mensagem está sendo processada..."
  }
}
```

### 4. `message` - Resposta do Assistente
```json
{
  "type": "message",
  "data": {
    "messageId": "msg-uuid-789",
    "conversationId": "conv-uuid-456",
    "message": "Olá! Como posso ajudar você hoje?",
    "timestamp": "2026-02-02T10:30:05Z",
    "metadata": {
      "model": "gpt-4o-mini",
      "tokensUsed": 120,
      "processingTime": 2500,
      "finishReason": "stop"
    }
  }
}
```

### 5. `error` - Erro
```json
{
  "type": "error",
  "data": {
    "error": "Agente não encontrado"
  }
}
```

---

## 🚀 Quick Start (Linha de Comando)

```bash
# 1. Fazer login e copiar token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}' \
  | jq -r '.data.token'

# 2. Abrir o HTML no navegador
# Ou usar wscat (npm install -g wscat)
wscat -c "ws://localhost:3000/ws/chat?token=SEU_TOKEN"

# 3. Enviar mensagem (no wscat)
{"type":"message","data":{"agentId":"agent-id","content":"Olá!"}}
```

---

## 🐛 Troubleshooting

### Erro: "Não autorizado" (1008)
**Causa:** Token inválido ou expirado  
**Solução:** Faça login novamente e obtenha novo token

### WebSocket fecha imediatamente
**Causa:** Token não foi passado na URL  
**Solução:** Certifique-se de incluir `?token=SEU_TOKEN` na URL

### Não recebe resposta
**Causa:** agentId inválido ou N8N não está rodando  
**Solução:** 
- Verifique se o agentId está correto
- Confirme que N8N está ativo: `curl http://localhost:5678/webhook/openai-chat -I`

---

## 📚 Recursos Adicionais

- [WebSocket API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [ws library (Node.js)](https://github.com/websockets/ws)
- [websockets library (Python)](https://websockets.readthedocs.io/)

---

**Última atualização:** Fevereiro 2026  
**Status:** ✅ Funcionando perfeitamente
