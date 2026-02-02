# 🔒 Guia de Segurança

## Checklist de Segurança para Produção

### ✅ Variáveis de Ambiente

- [ ] `JWT_SECRET` configurado com chave forte (mínimo 32 caracteres aleatórios)
- [ ] `SYSTEM_API_KEYS` configurado com chaves seguras para N8N
- [ ] Senha do PostgreSQL alterada do padrão `postgres`
- [ ] Senha do MongoDB configurada (se aplicável)
- [ ] `NODE_ENV=production` definido
- [ ] Arquivo `.env` não está commitado no Git (verificar `.gitignore`)
- [ ] Credenciais de produção armazenadas em gerenciador de secrets (AWS Secrets Manager, etc)

### ✅ Banco de Dados

- [ ] PostgreSQL com acesso restrito (não exposto publicamente)
- [ ] MongoDB com autenticação habilitada
- [ ] Backup automático configurado
- [ ] Conexões usando SSL/TLS em produção
- [ ] Índices otimizados para performance

### ✅ API e Autenticação

- [ ] CORS configurado com origins específicos (não usar `*`)
- [ ] Rate limiting implementado (considerar usar express-rate-limit)
- [ ] Validação de entrada em todos endpoints
- [ ] JWT com tempo de expiração adequado
- [ ] Refresh tokens implementados (se necessário)
- [ ] API Keys do sistema rotacionadas periodicamente

### ✅ Logging e Monitoramento

- [ ] `LOG_LEVEL` configurado adequadamente (warn ou error em produção)
- [ ] `LOG_TO_FILE=true` em produção
- [ ] Logs não contêm informações sensíveis (senhas, tokens completos)
- [ ] Sistema de alerta para erros críticos
- [ ] Monitoramento de saúde do servidor (uptime)

### ✅ Network e Infrastructure

- [ ] HTTPS habilitado (certificado SSL válido)
- [ ] Firewall configurado (permitir apenas portas necessárias)
- [ ] Servidor rodando com usuário não-root
- [ ] Updates de segurança do SO aplicados
- [ ] Container security (se usando Docker)

### ✅ Código

- [ ] Dependências atualizadas (`npm audit` sem vulnerabilidades críticas)
- [ ] Senhas hasheadas com bcrypt
- [ ] SQL injection prevenido (queries parametrizadas)
- [ ] XSS prevention
- [ ] CSRF protection (se aplicável)
- [ ] Input sanitization

## 🔑 Gerando Chaves Seguras

### JWT Secret

```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# OpenSSL
openssl rand -hex 64
```

### System API Keys

```bash
# Gerar API Key única
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 🛡️ Boas Práticas de System API Keys

1. **Nunca compartilhe API Keys publicamente**
   - Não commite no Git
   - Não envie por email/Slack sem criptografia
   - Use gerenciadores de secrets

2. **Use uma chave por sistema**
   ```env
   SYSTEM_API_KEYS=n8n-production-key,outro-sistema-key
   ```

3. **Rotacione as chaves periodicamente**
   - Recomendado: a cada 90 dias
   - Após qualquer suspeita de comprometimento

4. **Monitore o uso**
   - Revise logs de acesso com System API Keys
   - Configure alertas para acessos suspeitos

5. **Princípio do menor privilégio**
   - System API Keys só têm acesso a endpoints específicos
   - Não dê acesso total à API

## 🚨 Resposta a Incidentes

### Se uma chave for comprometida:

1. **Imediatamente**:
   - Gere nova chave
   - Atualize `SYSTEM_API_KEYS` no servidor
   - Reinicie o serviço

2. **Investigação**:
   - Revise logs de acesso com a chave comprometida
   - Identifique atividades suspeitas
   - Documente o incidente

3. **Notificação**:
   - Informe sistemas afetados (N8N, etc)
   - Atualize documentação

## 📋 Auditoria de Segurança

Execute periodicamente:

```bash
# Verificar vulnerabilidades em dependências
npm audit

# Atualizar dependências com vulnerabilidades
npm audit fix

# Revisar logs de erro
tail -f logs/error.log

# Verificar tentativas de autenticação falhadas
# (filtrar logs por "Auth attempt" e status 401)
```

## 🔍 Endpoints Sensíveis

### Protegidos por JWT (usuários)
- `POST /api/agents` - Criar agente
- `PUT /api/agents/:id` - Atualizar agente
- `DELETE /api/agents/:id` - Deletar agente
- `POST /api/agents/:agentId/plugins` - Instalar plugin

### Acessíveis com System API Key
- `GET /api/agents/:id` - Buscar agente (N8N precisa para executar)
- `GET /api/agents/:agentId/plugins` - Listar plugins
- `GET /api/chat/conversations/:id` - Buscar conversação

### Públicos (sem autenticação)
- `GET /api/health` - Health check
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Registro

## 📚 Recursos

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)

---

**Última atualização**: Janeiro 2026
