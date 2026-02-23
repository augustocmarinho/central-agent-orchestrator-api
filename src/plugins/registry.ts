// Registry: plugin id -> handler (com getTools e execute quando suportado)
import calendarPlugin from './calendar/handler';

export interface PluginExecuteContext {
  agentId: string;
}

export interface PluginHandler {
  id: string;
  getTools?(): Array<{ type: string; name: string; description: string; parameters: Record<string, unknown>; strict?: boolean }>;
  execute?(
    action: string,
    data: Record<string, unknown>,
    config: Record<string, unknown>,
    context?: PluginExecuteContext
  ): Promise<unknown>;
}

export const pluginHandlers: Record<string, PluginHandler> = {
  'plugin.calendar': calendarPlugin,
};
