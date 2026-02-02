# 🚀 Guia de Início Rápido

Este guia vai te ajudar a rodar o backend em **menos de 5 minutos**.

## Pré-requisitos

Você precisa ter instalado:
- Node.js 18+
- PostgreSQL 14+ (ou via Docker)
- MongoDB 6+ (ou via Docker)

## Opção 1: Setup com Docker (Recomendado)

### 1. Clone e entre no diretório

```bash
cd back
```

### 2. Suba os bancos de dados com Docker

```bash
docker-compose up -d
```

Isso vai iniciar:
- PostgreSQL na porta 5432
- MongoDB na porta 27017

### 3. Instale as dependências

```bash
npm install
```

### 4. Configure o ambiente

```bash
cp env.example .env
```

O `.env` já está configurado para usar os bancos locais.

### 5. Execute as migrations

```bash
npm run migrate
```

### 6. Execute o seed (usuário inicial)

```bash
npx tsx src/db/seed.ts
```

### 7. Inicie o servidor

```bash
npm run dev
```

✅ Pronto! O servidor está rodando em `http://localhost:3000`

---

## Opção 2: Setup Manual (Sem Docker)

### 1. Instale PostgreSQL e MongoDB

**PostgreSQL:**
```bash
# macOS
brew install postgresql@14
brew services start postgresql@14

# Ubuntu
sudo apt install postgresql-14
sudo systemctl start postgresql
```

**MongoDB:**
```bash
# macOS
brew install mongodb-community@6.0
brew services start mongodb-community

# Ubuntu
sudo apt install mongodb-org
sudo systemctl start mongod
```

### 2. Crie o banco de dados

```bash
psql -U postgres -c "CREATE DATABASE ai_agents;"
```

### 3. Clone e configure

```bash
cd back
npm install
cp env.example .env
```

### 4. Edite o .env se necessário

Se suas credenciais forem diferentes, ajuste:

```env
POSTGRES_USER=seu_usuario
POSTGRES_PASSWORD=sua_senha
```

### 5. Execute migrations e seed

```bash
npm run migrate
npx tsx src/db/seed.ts
```

### 6. Inicie o servidor

```bash
npm run dev
```

---

## Testando

### 1. Health Check

```bash
curl http://localhost:3000/api/health
```

Deve retornar:
```json
{
  "status": "ok",
  "timestamp": "..."
}
```

### 2. Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'
```

Salve o `token` retornado.

### 3. Criar Agente

```bash
TOKEN="seu-token-aqui"

curl -X POST http://localhost:3000/api/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Teste Bot",
    "creationMode": "simple",
    "objective": "Ajudar com testes",
    "persona": "amigável"
  }'
```

### 4. Listar Agentes

```bash
curl http://localhost:3000/api/agents \
  -H "Authorization: Bearer $TOKEN"
```

---

## Testando WebSocket

### Usando wscat

```bash
npm install -g wscat

TOKEN="seu-token-aqui"

wscat -c "ws://localhost:3000/ws/chat?token=$TOKEN"
```

Depois de conectar, envie:

```json
{"type":"join","data":{"agentId":"uuid-do-agente"}}
```

E então:

```json
{"type":"message","data":{"agentId":"uuid-do-agente","content":"Olá!"}}
```

---

## Próximos Passos

1. **Configure o n8n** (opcional, para IA real)
   - Instale n8n: `npm install -g n8n`
   - Rode: `n8n start`
   - Configure a API key no `.env`

2. **Explore os plugins**
   - Veja em `src/plugins/`
   - Crie seu próprio plugin

3. **Conecte o Frontend**
   - Configure o frontend para apontar para `http://localhost:3000`

4. **Leia a documentação completa**
   - `README.md` - Visão geral
   - `API.md` - Documentação da API
   - `ARCHITECTURE.md` - Arquitetura do sistema

---

## Problemas Comuns

### "Port 3000 already in use"

Mude a porta no `.env`:
```env
PORT=3001
```

### "Connection refused" ao PostgreSQL

Verifique se o PostgreSQL está rodando:
```bash
# macOS
brew services list

# Linux
sudo systemctl status postgresql
```

### "ECONNREFUSED MongoDB"

Verifique se o MongoDB está rodando:
```bash
# macOS
brew services list

# Linux
sudo systemctl status mongod
```

### Migrations falharam

Recrie o banco:
```bash
psql -U postgres -c "DROP DATABASE IF EXISTS ai_agents;"
psql -U postgres -c "CREATE DATABASE ai_agents;"
npm run migrate
```

---

## Comandos Úteis

```bash
# Desenvolvimento (hot reload)
npm run dev

# Build
npm run build

# Produção
npm start

# Migrations
npm run migrate

# Seed
npx tsx src/db/seed.ts

# Ver logs do Docker
docker-compose logs -f

# Parar Docker
docker-compose down

# Resetar tudo (Docker)
docker-compose down -v
```

---

## Variáveis de Ambiente Principais

```env
PORT=3000                    # Porta do servidor
POSTGRES_HOST=localhost      # Host do PostgreSQL
POSTGRES_DB=ai_agents        # Nome do banco
MONGODB_URI=mongodb://...    # URI do MongoDB
JWT_SECRET=chave-secreta     # Chave JWT (MUDE EM PRODUÇÃO!)
N8N_BASE_URL=http://...      # URL do n8n (opcional)
```

---

**Pronto para começar? Execute:**

```bash
docker-compose up -d && npm install && npm run migrate && npx tsx src/db/seed.ts && npm run dev
```

🎉 **Enjoy!**
