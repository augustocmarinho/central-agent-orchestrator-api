import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres').max(255, 'Nome muito longo'),
  email: z.string().email('Email inválido').toLowerCase(),
  password: z.string()
    .min(6, 'Senha deve ter no mínimo 6 caracteres')
    .max(100, 'Senha muito longa')
    .regex(/[A-Za-z]/, 'Senha deve conter pelo menos uma letra')
    .regex(/[0-9]/, 'Senha deve conter pelo menos um número'),
});

export const loginSchema = z.object({
  email: z.string().email('Email inválido').toLowerCase(),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
});

export const createAgentSchema = z.object({
    name: z.string().min(1, 'Nome é obrigatório'),
    creationMode: z.enum(['simple', 'advanced']),
    
    // Campos do modo simplificado
    objective: z.string().optional(),
    persona: z.string().optional(),
    audience: z.string().optional(),
    topics: z.string().optional(),
    restrictions: z.string().optional(),
    knowledgeSource: z.string().optional(),
    
    // Campo do modo avançado
    finalPrompt: z.string().optional(),
    
  }).superRefine((data, ctx) => {

    if (data.creationMode === 'simple') {
      const fields = [
        data.objective,
        data.persona,
        data.audience,
        data.topics,
        data.restrictions,
        data.knowledgeSource,
      ];
      const filled = fields.filter((f) => !!f && String(f).trim().length > 0);
      if (filled.length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Ao menos 3 campos entre objetivo, persona, público-alvo, tópicos, restrições ou base de conhecimento precisam ser preenchidos no modo simplificado.',
          path: [],
        });
      }
    }
  
    if (data.creationMode === 'advanced') {
      if (!data.finalPrompt || data.finalPrompt.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'O campo finalPrompt é obrigatório no modo avançado.',
          path: ['finalPrompt'],
        });
      }
    }
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'draft']).optional(),
  creationMode: z.enum(['simple', 'advanced']).optional(),
  objective: z.string().optional(),
  persona: z.string().optional(),
  audience: z.string().optional(),
  topics: z.string().optional(),
  restrictions: z.string().optional(),
  knowledgeSource: z.string().optional(),
  finalPrompt: z.string().optional(),
});

export const installPluginSchema = z.object({
  pluginId: z.string().min(1),
  isSandbox: z.boolean().default(false),
  config: z.record(z.any()).optional(),
});
