import { query } from '../db/postgres';
import { v4 as uuidv4 } from 'uuid';

export interface Plugin {
  id: string;
  name: string;
  category: string;
  description?: string;
  version: string;
  authType: string;
  supportsSandbox: boolean;
  manifest: any;
}

export interface InstallPluginData {
  agentId: string;
  pluginId: string;
  isSandbox: boolean;
  config?: Record<string, any>;
}

export class PluginService {
  async getAllPlugins(): Promise<Plugin[]> {
    const result = await query('SELECT * FROM plugins ORDER BY name');
    return result.rows;
  }
  
  async getPluginById(pluginId: string): Promise<Plugin | null> {
    const result = await query('SELECT * FROM plugins WHERE id = $1', [pluginId]);
    return result.rows[0] || null;
  }
  
  async registerPlugin(plugin: Plugin): Promise<Plugin> {
    const result = await query(
      `INSERT INTO plugins (id, name, category, description, version, auth_type, supports_sandbox, manifest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         version = EXCLUDED.version,
         auth_type = EXCLUDED.auth_type,
         supports_sandbox = EXCLUDED.supports_sandbox,
         manifest = EXCLUDED.manifest
       RETURNING *`,
      [
        plugin.id,
        plugin.name,
        plugin.category,
        plugin.description,
        plugin.version,
        plugin.authType,
        plugin.supportsSandbox,
        JSON.stringify(plugin.manifest)
      ]
    );
    
    return result.rows[0];
  }
  
  async installPlugin(data: InstallPluginData): Promise<any> {
    const client = await query('BEGIN');
    
    try {
      // Verificar se o plugin existe
      const plugin = await this.getPluginById(data.pluginId);
      if (!plugin) {
        throw new Error('Plugin não encontrado');
      }
      
      // Verificar dependências
      const depsResult = await query(
        'SELECT depends_on_plugin_id FROM plugin_dependencies WHERE plugin_id = $1',
        [data.pluginId]
      );
      
      if (depsResult.rows.length > 0) {
        // Verificar se todas as dependências estão instaladas
        for (const dep of depsResult.rows) {
          const installedDep = await query(
            'SELECT id FROM agent_plugins WHERE agent_id = $1 AND plugin_id = $2 AND is_active = true',
            [data.agentId, dep.depends_on_plugin_id]
          );
          
          if (installedDep.rows.length === 0) {
            throw new Error(`Plugin requer a dependência: ${dep.depends_on_plugin_id}`);
          }
        }
      }
      
      // Instalar plugin
      const agentPluginId = uuidv4();
      const installResult = await query(
        `INSERT INTO agent_plugins (id, agent_id, plugin_id, is_active, is_sandbox)
         VALUES ($1, $2, $3, true, $4)
         ON CONFLICT (agent_id, plugin_id) DO UPDATE SET
           is_active = true,
           is_sandbox = EXCLUDED.is_sandbox
         RETURNING *`,
        [agentPluginId, data.agentId, data.pluginId, data.isSandbox]
      );
      
      // Salvar configurações se fornecidas
      if (data.config) {
        for (const [key, value] of Object.entries(data.config)) {
          await query(
            `INSERT INTO plugin_configs (agent_plugin_id, config_key, config_value)
             VALUES ($1, $2, $3)
             ON CONFLICT (agent_plugin_id, config_key) DO UPDATE SET
               config_value = EXCLUDED.config_value`,
            [agentPluginId, key, JSON.stringify(value)]
          );
        }
      }
      
      await query('COMMIT');
      
      return installResult.rows[0];
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  }
  
  async getAgentPlugins(agentId: string): Promise<any[]> {
    const result = await query(
      `SELECT ap.*, p.name, p.category, p.description, p.auth_type, p.supports_sandbox
       FROM agent_plugins ap
       JOIN plugins p ON ap.plugin_id = p.id
       WHERE ap.agent_id = $1 AND ap.is_active = true
       ORDER BY ap.installed_at DESC`,
      [agentId]
    );
    
    return result.rows;
  }
  
  async uninstallPlugin(agentId: string, pluginId: string): Promise<boolean> {
    const result = await query(
      'UPDATE agent_plugins SET is_active = false WHERE agent_id = $1 AND plugin_id = $2',
      [agentId, pluginId]
    );
    
    return (result.rowCount ?? 0) > 0;
  }
  
  async getPluginConfig(agentId: string, pluginId: string): Promise<Record<string, any>> {
    const result = await query(
      `SELECT pc.config_key, pc.config_value
       FROM plugin_configs pc
       JOIN agent_plugins ap ON pc.agent_plugin_id = ap.id
       WHERE ap.agent_id = $1 AND ap.plugin_id = $2`,
      [agentId, pluginId]
    );
    
    const config: Record<string, any> = {};
    for (const row of result.rows) {
      try {
        config[row.config_key] = JSON.parse(row.config_value);
      } catch {
        config[row.config_key] = row.config_value;
      }
    }
    
    return config;
  }
}

export const pluginService = new PluginService();
