// Registry de plugins disponíveis no sistema
import { pluginService } from '../services/plugin.service';
import calendarFakeManifest from './calendar_fake/manifest.json';
import echoManifest from './echo/manifest.json';

export const defaultPlugins = [
  {
    ...calendarFakeManifest,
    manifest: calendarFakeManifest,
  },
  {
    ...echoManifest,
    manifest: echoManifest,
  },
];

// Registrar plugins padrão no banco
export const registerDefaultPlugins = async () => {
  console.log('📦 Registrando plugins padrão...');
  
  for (const plugin of defaultPlugins) {
    try {
      await pluginService.registerPlugin({
        id: plugin.id,
        name: plugin.name,
        category: plugin.category,
        description: plugin.description,
        version: plugin.version,
        authType: plugin.auth_type,
        supportsSandbox: plugin.supports_sandbox,
        manifest: plugin.manifest,
      });
      console.log(`  ✅ Plugin ${plugin.name} registrado`);
    } catch (error: any) {
      console.error(`  ❌ Erro ao registrar plugin ${plugin.name}:`, error.message);
    }
  }
  
  console.log('✅ Plugins padrão registrados');
};

// Exportar handlers dos plugins
export { default as calendarFakePlugin } from './calendar_fake/handler';
export { default as echoPlugin } from './echo/handler';
