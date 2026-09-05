import type { Plugin, PluginModule } from '@opencode-ai/plugin';
import { applyPresetToOpenCodeConfig, loadQaSkillConfig } from './config';

export * from './config';

type Logger = Pick<Console, 'warn'>;

type QaSkillServerFactoryOptions = {
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  loadConfig?: typeof loadQaSkillConfig;
};

export function createQaSkillServerPlugin(options: QaSkillServerFactoryOptions = {}): Plugin {
  const logger = options.logger ?? console;
  const loadConfig = options.loadConfig ?? loadQaSkillConfig;
  const env = options.env ?? process.env;

  return async (input) => ({
    config: async (openCodeConfig) => {
      const loaded = loadConfig({ directory: input.directory, env });
      for (const warning of loaded.warnings) logger.warn(`[qa-skill-opencode-plugin] ${warning}`);
      if (!loaded.valid) return;

      const result = applyPresetToOpenCodeConfig(openCodeConfig as Record<string, any>, loaded.config);
      for (const warning of result.warnings) logger.warn(`[qa-skill-opencode-plugin] ${warning}`);
    },
  });
}

export function createQaSkillServerModule(options: QaSkillServerFactoryOptions = {}): PluginModule {
  return {
    id: 'qa-skill:server',
    server: createQaSkillServerPlugin(options),
  };
}

const qaSkillServerModule = createQaSkillServerModule();

export default qaSkillServerModule;
