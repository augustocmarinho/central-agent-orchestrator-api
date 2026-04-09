import { pluginService } from './plugin.service';
import { conversationService } from './conversation.service';
import { pluginHandlers, PluginExecuteContext } from '@/plugins/registry';
import { logInfo } from '../utils/logger';

// Formato OpenAI Responses API - item de tool
export interface OpenAIToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

// Tools de sistema — sempre disponíveis para todos os agentes, sem precisar de plugin
const SYSTEM_TOOLS: OpenAIToolDefinition[] = [
  {
    type: 'function',
    name: 'transfer_to_human',
    description: 'Transfere a conversa para um atendente humano. Use quando o cliente solicitar falar com uma pessoa real, quando não souber responder, ou quando a situação exigir intervenção humana.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Motivo da transferência (ex: "Cliente solicitou atendente humano", "Dúvida fora do escopo")',
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    strict: true,
  },
];

// Convenção: prefixo do nome da tool -> plugin id (ex: calendar_ -> plugin.calendar)
const TOOL_PREFIX_TO_PLUGIN_ID: Record<string, string> = {
  calendar_: 'plugin.calendar',
};

function getPluginIdForTool(toolName: string): string | null {
  for (const [prefix, pluginId] of Object.entries(TOOL_PREFIX_TO_PLUGIN_ID)) {
    if (toolName.startsWith(prefix)) {
      return pluginId;
    }
  }
  return null;
}

function getActionFromToolName(toolName: string, pluginId: string): string {
  const prefix = Object.entries(TOOL_PREFIX_TO_PLUGIN_ID).find(
    ([_, id]) => id === pluginId
  )?.[0];
  if (!prefix) return toolName;
  return toolName.slice(prefix.length);
}

export class ToolService {
  async getToolsForAgent(agentId: string): Promise<OpenAIToolDefinition[]> {
    const agentPlugins = await pluginService.getAgentPlugins(agentId);
    const allTools: OpenAIToolDefinition[] = [];

    for (const ap of agentPlugins) {
      const handler = pluginHandlers[ap.plugin_id];
      if (!handler || typeof (handler as { getTools?: () => OpenAIToolDefinition[] }).getTools !== 'function') {
        continue;
      }
      const tools = (handler as { getTools: () => OpenAIToolDefinition[] }).getTools();
      if (Array.isArray(tools)) {
        allTools.push(...tools);
      }
    }

    // Sempre incluir tools de sistema
    allTools.push(...SYSTEM_TOOLS);

    return allTools;
  }

  async executeTool(
    agentId: string,
    params: { call_id: string; name: string; arguments: string; conversationId?: string }
  ): Promise<string> {
    const { name, arguments: argsStr, conversationId } = params;

    // Parsear argumentos antes de qualquer execução
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = argsStr ? JSON.parse(argsStr) : {};
    } catch {
      return JSON.stringify({ success: false, error: 'arguments inválidos (JSON)' });
    }

    // System tools — executar diretamente sem plugin
    if (name === 'transfer_to_human') {
      return this.executeTransferToHuman(conversationId, parsedArgs);
    }

    // Plugin tools — lookup por prefixo
    const pluginId = getPluginIdForTool(name);
    if (!pluginId) {
      return JSON.stringify({ success: false, error: `Tool desconhecida: ${name}` });
    }

    const agentPlugins = await pluginService.getAgentPlugins(agentId);
    const installed = agentPlugins.find((p) => p.plugin_id === pluginId);
    if (!installed) {
      return JSON.stringify({ success: false, error: `Plugin do agente não encontrado para: ${name}` });
    }

    const handler = pluginHandlers[pluginId];
    if (!handler || typeof (handler as { execute?: (a: string, d: Record<string, unknown>, c: Record<string, unknown>) => Promise<unknown> }).execute !== 'function') {
      return JSON.stringify({ success: false, error: `Handler não suporta execução para: ${name}` });
    }

    const config = await pluginService.getPluginConfig(agentId, pluginId);
    const action = getActionFromToolName(name, pluginId);
    const context: PluginExecuteContext = { agentId, conversationId };
    const result = await (handler as { execute: (a: string, d: Record<string, unknown>, c: Record<string, unknown>, ctx?: PluginExecuteContext) => Promise<unknown> }).execute(
      action,
      parsedArgs,
      config,
      context
    );

    const resultObj = result as { success: boolean; data?: unknown; error?: string };
    if (resultObj.success === false && resultObj.error) {
      return JSON.stringify({ success: false, error: resultObj.error });
    }
    if (resultObj.data !== undefined) {
      return JSON.stringify(resultObj);
    }
    return JSON.stringify(result);
  }

  private async executeTransferToHuman(
    conversationId: string | undefined,
    args: Record<string, unknown>
  ): Promise<string> {
    if (!conversationId) {
      return JSON.stringify({ success: false, error: 'conversationId não disponível para transferência' });
    }

    const reason = (args.reason as string) || 'Transferência solicitada';

    await conversationService.updateConversationStatus(conversationId, 'paused');

    logInfo('Conversation transferred to human', { conversationId, reason });

    return JSON.stringify({
      success: true,
      data: {
        message: 'Conversa transferida para atendimento humano. A IA foi pausada para esta conversa.',
        reason,
      },
    });
  }
}

export const toolService = new ToolService();
