# 🔐 Sistema de Tokens de Autenticação para N8N

## TL;DR - Quick Start

```bash
# 1. Rodar migrações
npm run migrate

# 2. Criar token para N8N
npm run setup:n8n-token

# 3. Copiar o token exibido

# 4. No N8N, adicionar header:
# X-System-API-Key: {seu-token}
```

## ⚡ O que mudou?

### Antes (Sistema Antigo)
```env
SYSTEM_API_KEYS=chave-estatica-no-env
```

❌ Chaves fixas no .env  
❌ Sem controle de IP  
❌ Sem auditoria  
❌ Sem gerenciamento  

### Agora (Sistema Novo)
```bash
npm run setup:n8n-token
```

✅ Tokens armazenados no banco  
✅ Limitação por IP/CIDR  
✅ Auditoria completa (logs)  
✅ Gerenciamento via API  
✅ Tokens que não expiram (ou com validade customizável)  

## 🚀 Como Usar

### 1. Setup Inicial

```bash
cd back

# Instalar dependências (se necessário)
npm install

# Rodar migrações (cria tabelas)
npm run migrate

# Criar token para N8N
npm run setup:n8n-token
```

O script irá:
1. Criar usuário admin (se não existir)
2. Gerar token seguro
3. Exibir o token (copie e guarde!)

### 2. Configurar N8N

No workflow N8N, configure o HTTP Request:

**Headers:**
```
X-System-API-Key: sat_abc123def456...
```

**URL:**
```
http://localhost:3000/api/agents/123
```

### 3. (Opcional) Restringir por IP

```bash
# Descobrir IP do servidor N8N
curl https://api.ipify.org

# Criar token com restrição de IP
N8N_ALLOWED_IPS="192.168.1.100" npm run setup:n8n-token
```

Suporta:
- IP individual: `192.168.1.100`
- CIDR: `10.0.0.0/8`
- Wildcard: `192.168.1.*`
- Múltiplos: `192.168.1.100,10.0.0.0/8`

## 📋 Gerenciamento de Tokens

### Via API (requer autenticação admin)

```bash
# Listar tokens
curl -H "Authorization: Bearer {jwt_admin}" \
  http://localhost:3000/api/system-tokens

# Ver logs de uso
curl -H "Authorization: Bearer {jwt_admin}" \
  http://localhost:3000/api/system-tokens/{id}/logs

# Revogar token
curl -X DELETE \
  -H "Authorization: Bearer {jwt_admin}" \
  http://localhost:3000/api/system-tokens/{id}

# Atualizar IPs permitidos
curl -X PUT \
  -H "Authorization: Bearer {jwt_admin}" \
  -H "Content-Type: application/json" \
  -d '{"allowed_ips": ["192.168.1.100", "192.168.1.101"]}' \
  http://localhost:3000/api/system-tokens/{id}/allowed-ips
```

## 🔒 Segurança

### Boas Práticas

1. ✅ **Use restrição de IP em produção**
2. ✅ **Rotacione tokens periodicamente**
3. ✅ **Monitore os logs**
4. ✅ **Nunca comite tokens no código**
5. ✅ **Use HTTPS em produção**

### O que o sistema valida automaticamente:

- Token existe e está ativo
- Token não expirou
- IP está na lista permitida
- Registra todos os acessos

## 🐛 Troubleshooting

### "API Key inválida"
```bash
# Verificar tokens ativos
curl -H "Authorization: Bearer {jwt_admin}" \
  http://localhost:3000/api/system-tokens

# Criar novo token
npm run setup:n8n-token
```

### "Unauthorized IP"
```bash
# Verificar IP do N8N
curl https://api.ipify.org

# Atualizar IPs permitidos via API
curl -X PUT ... (ver seção Gerenciamento)
```

### N8N não conecta
1. Backend rodando? `curl http://localhost:3000/api/health`
2. Token correto no header?
3. URL correta? (não esquecer `/api`)
4. Firewall bloqueando?

## 📚 Documentação Completa

Ver: [SYSTEM_TOKENS.md](./SYSTEM_TOKENS.md)

## 🔄 Migração do Sistema Antigo

Se você usa `SYSTEM_API_KEYS`:

1. Sistema antigo continua funcionando (compatibilidade)
2. Crie tokens novos: `npm run setup:n8n-token`
3. Atualize o N8N para usar novo token
4. (Opcional) Remova `SYSTEM_API_KEYS` do .env

## 📊 Endpoints Disponíveis

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/system-tokens` | Criar token |
| GET | `/api/system-tokens` | Listar tokens |
| GET | `/api/system-tokens/:id` | Ver token específico |
| DELETE | `/api/system-tokens/:id` | Revogar token |
| PUT | `/api/system-tokens/:id/allowed-ips` | Atualizar IPs |
| GET | `/api/system-tokens/:id/logs` | Ver logs de uso |

Todos requerem autenticação de usuário **admin**.

## 🎯 Exemplo Completo

```bash
# 1. Setup
cd back
npm run migrate
npm run setup:n8n-token
# Anotar token: sat_abc123...

# 2. No N8N (HTTP Request Node)
# Method: GET
# URL: http://localhost:3000/api/agents/123
# Headers:
#   X-System-API-Key: sat_abc123...

# 3. Testar
# Execute o workflow no N8N

# 4. Monitorar
curl -H "Authorization: Bearer {jwt_admin}" \
  http://localhost:3000/api/system-tokens/{id}/logs
```

## ❓ Suporte

- Documentação completa: [SYSTEM_TOKENS.md](./SYSTEM_TOKENS.md)
- Logs do backend: `back/logs/`
- Logs de tokens: `GET /api/system-tokens/{id}/logs`
- Status da API: `GET /api/health`
