# 🚀 COMECE AQUI!

Bem-vindo ao backend da Plataforma de Agentes de IA!

---

## ⚡ Início em 5 Minutos

```bash
# 1. Entre na pasta
cd back

# 2. Setup completo (Docker + migrations + seed)
make setup

# 3. Inicie o servidor
make dev
```

**Pronto!** 🎉

Servidor rodando em: `http://localhost:3000`

---

## 🔐 Credenciais Padrão

```
Email: admin@example.com
Senha: admin123
```

---

## 🧪 Teste Rápido

```bash
# Health check
curl http://localhost:3000/api/health

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'
```

---

## 📚 Documentação

Leia nesta ordem:

1. **[README.md](./README.md)** ← Comece aqui
2. **[QUICKSTART.md](./QUICKSTART.md)** ← Guia rápido
3. **[API.md](./API.md)** ← Endpoints da API
4. **[ARCHITECTURE.md](./ARCHITECTURE.md)** ← Arquitetura

### Guias Específicos

- **[N8N_INTEGRATION.md](./N8N_INTEGRATION.md)** - Integrar com n8n
- **[FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md)** - Integrar frontend
- **[PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md)** - Resumo completo

---

## 🎯 O Que Este Backend Faz?

```
┌─────────────────────────────────────────────┐
│  ✅ Autenticação (Login/JWT)                │
│  ✅ Gerenciamento de Agentes de IA          │
│  ✅ Sistema de Plugins Extensível           │
│  ✅ Chat em Tempo Real (WebSocket)          │
│  ✅ Integração com n8n                      │
│  ✅ Dois Modos de Criação de Agentes        │
│  ✅ Histórico de Conversas                  │
│  ✅ Logs de Execução                        │
└─────────────────────────────────────────────┘
```

---

## 🛠️ Stack

- **Node.js** + Express + TypeScript
- **PostgreSQL** (dados estruturais)
- **MongoDB** (conversas e logs)
- **WebSocket** (chat real-time)
- **n8n** (engine de IA)
- **JWT** (autenticação)

---

## 📡 Endpoints Principais

```
POST   /api/auth/login           # Login
GET    /api/agents               # Listar agentes
POST   /api/agents               # Criar agente
GET    /api/plugins              # Listar plugins
POST   /api/chat/message         # Enviar mensagem
```

**WebSocket:**
```
ws://localhost:3000/ws/chat?token={JWT}
```

---

## 🔧 Comandos Úteis

```bash
make setup          # Setup completo
make dev            # Desenvolvimento
make migrate        # Executar migrations
make docker-up      # Subir bancos (Docker)
make docker-logs    # Ver logs do Docker
make clean          # Limpar build
```

---

## 📁 Estrutura

```
src/
├── server.ts           # 🚀 Entrada
├── app.ts              # ⚙️  Express
├── routes/             # 🛣️  Rotas
├── controllers/        # 🎮 Controllers
├── services/           # 💼 Lógica de negócio
├── models/             # 📦 Models MongoDB
├── db/                 # 🗄️  Bancos
├── plugins/            # 🔌 Sistema de plugins
├── websocket/          # 🔌 WebSocket
├── auth/               # 🔐 Autenticação
└── utils/              # 🛠️  Utilitários
```

---

## 🎓 Conceitos Importantes

### 1. Node.js é o DONO
- Frontend **nunca** acessa n8n diretamente
- Node decide tudo, n8n apenas executa

### 2. Agentes Sempre Ativos
- Status padrão: `active`
- Funcionam imediatamente no chat

### 3. Plugins são Capabilities
- **NÃO** criam agentes
- **ESTENDEM** agentes existentes

### 4. Dois Modos de Criação
- **Simplificado**: Formulário → Gera prompt
- **Avançado**: Edição direta do prompt

---

## 🧩 Plugins Incluídos

1. **Echo** (`plugin.echo`)
   - Repete mensagens
   - Exemplo básico

2. **Calendar Fake** (`plugin.calendar_fake`)
   - Agendamento em memória
   - Exemplo com múltiplas ações

---

## 🔄 Fluxo do Chat

```
1. Frontend envia mensagem (WebSocket)
   ↓
2. Node.js recebe e processa
   ↓
3. Busca configuração do agente
   ↓
4. Busca histórico de conversa
   ↓
5. Chama n8n com contexto completo
   ↓
6. n8n decide qual LLM usar
   ↓
7. Resposta retorna para Node
   ↓
8. Node salva logs e envia ao front
```

---

## 🐛 Problemas?

### Backend não inicia

```bash
# Verifique se os bancos estão rodando
docker ps

# Se não estiverem
docker-compose up -d

# Aguarde 5 segundos
sleep 5

# Tente novamente
npm run dev
```

### "Port 3000 already in use"

```bash
# Mude a porta no .env
echo "PORT=3001" >> .env
```

### Migrations falharam

```bash
# Recrie o banco
psql -U postgres -c "DROP DATABASE IF EXISTS ai_agents;"
psql -U postgres -c "CREATE DATABASE ai_agents;"
npm run migrate
```

---

## 🎯 Próximos Passos

### 1. Teste o Backend

```bash
curl http://localhost:3000/api/health
```

### 2. Leia a Documentação

- [README.md](./README.md)
- [API.md](./API.md)

### 3. Configure o n8n (Opcional)

- [N8N_INTEGRATION.md](./N8N_INTEGRATION.md)

### 4. Integre o Frontend

- [FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md)

---

## 📊 Checklist

- [ ] Backend rodando (`http://localhost:3000`)
- [ ] Health check funcionando
- [ ] Login funciona
- [ ] Criar agente funciona
- [ ] Plugins listam
- [ ] Chat responde (mesmo que simulado)

---

## 🆘 Precisa de Ajuda?

1. **Guia Rápido**: [QUICKSTART.md](./QUICKSTART.md)
2. **Documentação da API**: [API.md](./API.md)
3. **Arquitetura**: [ARCHITECTURE.md](./ARCHITECTURE.md)
4. **Resumo**: [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md)

---

## 🎉 Tudo Pronto!

Agora você tem:

✅ Backend funcional  
✅ Autenticação  
✅ Sistema de agentes  
✅ Sistema de plugins  
✅ Chat em tempo real  
✅ Integração com n8n  
✅ Documentação completa  

**Divirta-se construindo agentes incríveis!** 🚀

---

<div align="center">

**[⬆️ Voltar ao Início](#-comece-aqui)**

---

Desenvolvido com ❤️ seguindo especificações rigorosas

</div>
