# Sistema de Tokens para Integração N8N

Este documento descreve o sistema de tokens de autenticação para sistemas externos (como N8N) se conectarem ao backend de forma segura.

## Características

✅ **Tokens de longa duração** - Tokens que não expiram ou com validade customizável  
✅ **Limitação de IP** - Restrinja o acesso por IP ou CIDR  
✅ **Auditoria completa** - Todos os usos são registrados  
✅ **Gerenciamento via API** - CRUD completo de tokens  
✅ **Segurança moderna** - Tokens criptograficamente seguros

## Índice

1. [Quick Start](#quick-start)
2. [Configuração Detalhada](#configuração-detalhada)
3. [API Endpoints](#api-endpoints)
4. [Segurança](#segurança)
5. [Troubleshooting](#troubleshooting)

---

## Quick Start

### 1. Executar Migração

Primeiro, execute a migração para criar as tabelas necessárias:

```bash
cd back
npm run migrate
```

### 2. Criar Token para N8N

Execute o script de setup:

```bash
npm run setup:n8n-token
```

O script irá:
- Criar um usuário admin (se não existir)
- Gerar um token seguro
- Exibir o token (guarde-o com segurança!)

### 3. Configurar no N8N

No seu workflow N8N, configure o HTTP Request node:

**Headers:**
```
X-System-API-Key: sat_abc123def456... (seu token)
```

**Base URL:**
```
http://localhost:3000/api
```

Pronto! O N8N agora pode acessar a API.

---

## Configuração Detalhada

### Variáveis de Ambiente do Script

Ao executar `npm run setup:n8n-token`, você pode customizar:

```bash
# Nome do token
N8N_TOKEN_NAME="N8N Production"

# Descrição
N8N_TOKEN_DESCRIPTION="Token para produção do N8N"

# IPs permitidos (separados por vírgula)
N8N_ALLOWED_IPS="192.168.1.100,10.0.0.0/8,172.16.0.1"

# URL da API (para documentação)
API_URL="https://api.seudominio.com"

# Senha do admin padrão (caso precise criar)
DEFAULT_ADMIN_PASSWORD="senha-segura-aqui"
```

Exemplo de uso:

```bash
N8N_TOKEN_NAME="N8N Dev" \
N8N_ALLOWED_IPS="127.0.0.1,::1" \
npm run setup:n8n-token
```

### Formato dos IPs Permitidos

O sistema suporta múltiplos formatos:

1. **IP individual:**
   ```
   192.168.1.100
   ```

2. **CIDR (range de IPs):**
   ```
   10.0.0.0/8       # Toda a rede 10.x.x.x
   192.168.1.0/24   # IPs de 192.168.1.1 a 192.168.1.254
   ```

3. **Wildcard:**
   ```
   192.168.1.*      # Qualquer IP 192.168.1.x
   ```

4. **Múltiplos IPs:**
   ```
   192.168.1.100,10.0.0.0/8,172.16.0.1
   ```

5. **Sem restrição:**
   ```
   # Não defina N8N_ALLOWED_IPS ou deixe vazio
   # (não recomendado para produção!)
   ```

---

## API Endpoints

### Autenticação

Todos os endpoints de gerenciamento requerem autenticação de usuário **admin**.

**Header de autenticação:**
```
Authorization: Bearer {jwt_token}
```

### 1. Criar Token

```http
POST /api/system-tokens
Authorization: Bearer {admin_jwt}
Content-Type: application/json

{
  "name": "N8N Production",
  "description": "Token para servidor de produção do N8N",
  "allowed_ips": ["192.168.1.100", "10.0.0.0/8"],
  "expires_at": "2025-12-31T23:59:59Z"  // opcional, null = nunca expira
}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "token": {
      "id": "uuid-aqui",
      "name": "N8N Production",
      "token": "sat_abc123...",  // ⚠️ Aparece apenas na criação!
      "description": "...",
      "allowed_ips": ["192.168.1.100"],
      "expires_at": "2025-12-31T23:59:59Z",
      "created_at": "2024-01-15T10:30:00Z"
    },
    "warning": "Guarde este token em local seguro. Ele não será exibido novamente."
  }
}
```

### 2. Listar Tokens

```http
GET /api/system-tokens
Authorization: Bearer {admin_jwt}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "id": "uuid-1",
        "name": "N8N Production",
        "description": "...",
        "allowed_ips": ["192.168.1.100"],
        "is_active": true,
        "expires_at": null,
        "last_used_at": "2024-01-20T15:45:00Z",
        "last_used_ip": "192.168.1.100",
        "created_at": "2024-01-15T10:30:00Z"
      }
    ]
  }
}
```

### 3. Buscar Token Específico

```http
GET /api/system-tokens/{id}
Authorization: Bearer {admin_jwt}
```

### 4. Atualizar IPs Permitidos

```http
PUT /api/system-tokens/{id}/allowed-ips
Authorization: Bearer {admin_jwt}
Content-Type: application/json

{
  "allowed_ips": ["192.168.1.100", "192.168.1.101"]
}
```

### 5. Revogar Token

```http
DELETE /api/system-tokens/{id}
Authorization: Bearer {admin_jwt}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Token revogado com sucesso"
}
```

### 6. Ver Logs de Uso

```http
GET /api/system-tokens/{id}/logs?limit=100
Authorization: Bearer {admin_jwt}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "uuid",
        "ip_address": "192.168.1.100",
        "path": "/api/agents/123",
        "method": "GET",
        "status_code": 200,
        "success": true,
        "error_message": null,
        "created_at": "2024-01-20T15:45:00Z"
      }
    ]
  }
}
```

---

## Segurança

### Boas Práticas

1. **Sempre use restrição de IP em produção**
   ```bash
   N8N_ALLOWED_IPS="ip-do-servidor-n8n" npm run setup:n8n-token
   ```

2. **Rotacione tokens periodicamente**
   - Crie um novo token
   - Atualize o N8N
   - Revogue o token antigo

3. **Monitore os logs**
   ```bash
   curl -H "Authorization: Bearer {admin_jwt}" \
     http://localhost:3000/api/system-tokens/{id}/logs
   ```

4. **Nunca comite tokens no código**
   - Use variáveis de ambiente
   - No N8N: Settings → Environment Variables

5. **Use HTTPS em produção**
   - Tokens trafegam no header
   - HTTPS previne interceptação

### Validações Automáticas

O sistema valida automaticamente:

- ✅ Token existe e está ativo
- ✅ Token não expirou
- ✅ IP do cliente está na lista permitida
- ✅ Registra todos os usos (auditoria)

### Logs de Auditoria

Cada uso do token gera um registro com:
- Data/hora
- IP de origem
- Endpoint acessado
- Status da resposta
- Mensagem de erro (se houver)

Logs são mantidos por **90 dias** (configurável).

---

## Troubleshooting

### "API Key inválida"

**Causas:**
1. Token incorreto ou mal copiado
2. Token revogado
3. Token expirado

**Solução:**
```bash
# Verificar tokens ativos
curl -H "Authorization: Bearer {admin_jwt}" \
  http://localhost:3000/api/system-tokens

# Criar novo token se necessário
npm run setup:n8n-token
```

### "System API request from unauthorized IP"

**Causa:** IP do cliente não está na lista permitida

**Solução:**
```bash
# Verificar IP atual do N8N
curl https://api.ipify.org

# Atualizar IPs permitidos
curl -X PUT \
  -H "Authorization: Bearer {admin_jwt}" \
  -H "Content-Type: application/json" \
  -d '{"allowed_ips": ["novo-ip-aqui"]}' \
  http://localhost:3000/api/system-tokens/{id}/allowed-ips
```

### "Expired system token attempt"

**Causa:** Token expirou

**Solução:**
```bash
# Criar novo token sem expiração
npm run setup:n8n-token
```

### N8N não consegue se conectar

**Checklist:**

1. **Backend rodando?**
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **Token correto no N8N?**
   - Verifique o header `X-System-API-Key`
   - Não deve ter espaços ou quebras de linha

3. **URL correta?**
   ```
   http://localhost:3000/api  # ✅ Correto
   http://localhost:3000      # ❌ Falta /api
   ```

4. **Firewall bloqueando?**
   ```bash
   # Testar conexão
   curl -H "X-System-API-Key: {token}" \
     http://localhost:3000/api/health
   ```

---

## Migração de API Keys Antigas

Se você estava usando `SYSTEM_API_KEYS` no `.env`, pode migrar:

### Antes (legado):
```env
SYSTEM_API_KEYS=chave1,chave2,chave3
```

### Depois (novo sistema):
```bash
# Criar token para cada integração
N8N_TOKEN_NAME="Sistema Legado 1" \
N8N_ALLOWED_IPS="192.168.1.100" \
npm run setup:n8n-token

# Anotar o token gerado e configurar no sistema
```

**Nota:** O sistema antigo continua funcionando (compatibilidade), mas recomenda-se migrar para o novo sistema que oferece:
- Auditoria completa
- Limitação de IP
- Gerenciamento via API
- Logs detalhados

---

## Exemplo Completo: Configurar N8N

### 1. No Backend

```bash
cd back

# Executar migração
npm run migrate

# Criar token para N8N
N8N_TOKEN_NAME="N8N Production" \
N8N_ALLOWED_IPS="192.168.1.50" \
npm run setup:n8n-token

# Anotar o token exibido: sat_abc123...
```

### 2. No N8N

**Workflow → HTTP Request Node:**

```yaml
Method: GET
URL: http://192.168.1.10:3000/api/agents/123
Authentication: None  # Não usar, pois usamos header customizado

Headers:
  X-System-API-Key: sat_abc123def456...  # Cole o token aqui
```

### 3. Testar

No N8N, execute o workflow. Deve retornar os dados do agente.

### 4. Monitorar

```bash
# Ver últimos usos do token
curl -H "Authorization: Bearer {admin_jwt}" \
  "http://localhost:3000/api/system-tokens/{token_id}/logs?limit=10"
```

---

## Suporte

Dúvidas ou problemas? Verifique:

1. Logs do backend: `back/logs/`
2. Logs de uso do token: `GET /api/system-tokens/{id}/logs`
3. Status da API: `GET /api/health`

---

## Changelog

### v1.0 (2024-01-28)
- Sistema inicial de tokens de sistema
- Validação de IP/CIDR/Wildcard
- Auditoria completa
- API de gerenciamento
- Script de setup automatizado
- Compatibilidade com sistema legado
