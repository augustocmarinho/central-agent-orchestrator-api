# Soft Delete - Agentes

Este documento descreve a implementação de soft delete na tabela `agents`.

## O que é Soft Delete?

Soft delete é uma técnica onde, ao invés de deletar permanentemente um registro do banco de dados, apenas marcamos ele como deletado adicionando uma data/hora no campo `deleted_at`. Isso permite:

- **Recuperação**: Possibilidade de restaurar registros deletados
- **Auditoria**: Manter histórico completo das ações
- **Integridade**: Evitar problemas com relacionamentos e referências
- **Conformidade**: Atender requisitos legais de retenção de dados

## Implementação

### Migration

A coluna `deleted_at` foi adicionada à tabela `agents` através da migration `003_add_soft_delete_to_agents.sql`:

```sql
ALTER TABLE agents 
ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL;

-- Índices para performance
CREATE INDEX idx_agents_deleted_at ON agents(deleted_at);
CREATE INDEX idx_agents_user_id_deleted_at ON agents(user_id, deleted_at);
```

### Comportamento

- **Registros ativos**: `deleted_at = NULL`
- **Registros deletados**: `deleted_at = [timestamp da deleção]`

### Métodos Disponíveis

#### 1. `deleteAgent(agentId, userId)` - Soft Delete

Marca um agente como deletado. Este é o comportamento padrão quando um agente é "excluído".

```typescript
await agentService.deleteAgent(agentId, userId);
```

**O que faz:**
- Define `deleted_at = CURRENT_TIMESTAMP`
- O agente desaparece das listagens normais
- Pode ser restaurado posteriormente

#### 2. `restoreAgent(agentId, userId)` - Restaurar

Restaura um agente que foi soft deleted.

```typescript
await agentService.restoreAgent(agentId, userId);
```

**O que faz:**
- Define `deleted_at = NULL`
- O agente volta a aparecer nas listagens normais

#### 3. `getDeletedAgentsByUserId(userId)` - Listar Deletados

Lista todos os agentes soft deleted de um usuário.

```typescript
const deletedAgents = await agentService.getDeletedAgentsByUserId(userId);
```

**Retorna:**
- Array com agentes onde `deleted_at IS NOT NULL`
- Ordenados por data de deleção (mais recentes primeiro)

#### 4. `hardDeleteAgent(agentId, userId)` - Deleção Permanente

Deleta permanentemente um agente do banco de dados. **Usar com extremo cuidado!**

```typescript
await agentService.hardDeleteAgent(agentId, userId);
```

**O que faz:**
- Remove o registro permanentemente do banco
- **Ação irreversível**
- Deve ser usado apenas em casos específicos (ex: LGPD, requisitos legais)

## Queries Atualizadas

Todas as queries foram atualizadas para filtrar automaticamente registros deletados:

### getAgentsByUserId
```sql
SELECT * FROM agents 
WHERE user_id = $1 AND deleted_at IS NULL 
ORDER BY created_at DESC
```

### getAgentById
```sql
SELECT a.*, ap.* 
FROM agents a
LEFT JOIN agent_prompts ap ON a.id = ap.agent_id
WHERE a.id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL
```

### getAgentByIdForSystem (N8N)
```sql
SELECT a.*, ap.* 
FROM agents a
LEFT JOIN agent_prompts ap ON a.id = ap.agent_id
WHERE a.id = $1 AND a.deleted_at IS NULL
```

### updateAgent
```sql
UPDATE agents SET [campos] 
WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
```

## Rotas da API

### Rota Atual (mantida)
- `DELETE /api/agents/:id` - Faz soft delete

### Novas Rotas (opcional - implementar se necessário)
- `POST /api/agents/:id/restore` - Restaura um agente deletado
- `GET /api/agents/deleted` - Lista agentes deletados
- `DELETE /api/agents/:id/permanent` - Hard delete (requer permissão especial)

## Índices de Performance

Foram criados índices específicos para otimizar queries com soft delete:

1. **idx_agents_deleted_at**: Para filtrar registros ativos/deletados
2. **idx_agents_user_id_deleted_at**: Para queries que filtram por usuário e status

Isso garante que as queries com `WHERE deleted_at IS NULL` continuem performáticas.

## Considerações

### Vantagens
- ✅ Permite recuperação de dados
- ✅ Mantém integridade referencial
- ✅ Facilita auditoria e compliance
- ✅ Implementação não-destrutiva

### Desvantagens
- ⚠️ Aumenta o tamanho do banco (registros não são removidos)
- ⚠️ Todas as queries precisam filtrar `deleted_at IS NULL`
- ⚠️ Pode causar confusão se não documentado adequadamente

### Boas Práticas

1. **Sempre filtrar deleted_at**: Em todas as queries de leitura, adicionar `WHERE deleted_at IS NULL`
2. **Manutenção periódica**: Considerar hard delete de registros muito antigos (ex: 1 ano)
3. **Documentação**: Manter equipe informada sobre o comportamento
4. **Testes**: Garantir que soft delete funciona corretamente em todos os fluxos

## Limpeza de Dados Antigos (Opcional)

Para manter o banco de dados limpo, pode-se criar um job periódico para fazer hard delete de registros soft deleted há muito tempo:

```typescript
// Exemplo: deletar agentes soft deleted há mais de 1 ano
async cleanOldDeletedAgents() {
  await query(
    'DELETE FROM agents WHERE deleted_at < NOW() - INTERVAL \'1 year\''
  );
}
```

## Migração de Dados Existentes

Como a coluna `deleted_at` foi adicionada com valor padrão `NULL`, todos os registros existentes continuam ativos (não deletados). Nenhuma ação adicional é necessária.

## Compatibilidade com Frontend

O frontend não precisa de alterações imediatas. A rota `DELETE /api/agents/:id` continua funcionando, apenas mudou o comportamento interno de DELETE físico para soft delete.

Se desejar adicionar funcionalidade de "Lixeira" no frontend para restaurar agentes, será necessário:
1. Adicionar as novas rotas no controller
2. Atualizar o frontend para consumir essas rotas
3. Criar interface de "Agentes Deletados"
