import { pluginService } from './plugin.service';
import { pluginHandlers, PluginExecuteContext } from '@/plugins/registry';

// Formato OpenAI Responses API - item de tool
export interface OpenAIToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

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

    return allTools;
  }

  async executeTool(
    agentId: string,
    params: { call_id: string; name: string; arguments: string }
  ): Promise<string> {
    const { name, arguments: argsStr } = params;
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

    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = argsStr ? JSON.parse(argsStr) : {};
    } catch {
      return JSON.stringify({ success: false, error: 'arguments inválidos (JSON)' });
    }

    const config = await pluginService.getPluginConfig(agentId, pluginId);
    const action = getActionFromToolName(name, pluginId);
    const context: PluginExecuteContext = { agentId };
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
}

export const toolService = new ToolService();
