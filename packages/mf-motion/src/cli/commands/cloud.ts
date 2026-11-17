// cloud list / enable / disable: cloud modules are off until the user enables
// one; enabling needs the key variable and a verified default model.
import { disableModule, enableModule, listModules } from '../../cloud/consent';
import { dataHome } from '../../paths/index';
import { defineCommand } from '../registry';

export const cloudListCommand = defineCommand({
  name: 'cloud list',
  summary: 'List the cloud modules: on or off, provider, whether its key is set, and the models it can use.',
  flags: {},
  dataSchema: {
    type: 'object',
    required: ['modules'],
    properties: {
      modules: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'enabled', 'provider', 'keyPresent', 'models'],
          properties: { id: { type: 'string' }, enabled: { type: 'boolean' }, provider: { type: ['string', 'null'] }, keyPresent: { type: 'boolean' }, models: { type: 'array' } },
        },
      },
    },
  },
  async handler({ cwd, env, global }) {
    return { data: { modules: listModules(dataHome({ flag: global.home, env, cwd }), env) } };
  },
});

export const cloudEnableCommand = defineCommand({
  name: 'cloud enable',
  summary: 'Turn a cloud module on for a provider (only when the user asks); prints what it sends and where.',
  positionals: [{ name: 'module', description: 'voice-cloud, images or vision', required: true }],
  flags: {
    provider: { type: 'string', required: true, value: '<provider>', description: 'provider id, for example openai' },
    model: { type: 'string', value: '<id>', description: "a model id instead of the provider's verified default" },
  },
  dataSchema: {
    type: 'object',
    required: ['module'],
    properties: { module: { type: 'object', required: ['id', 'enabled', 'provider', 'model', 'host', 'sends'] } },
  },
  async handler({ args, flags, cwd, env, global, log }) {
    const home = dataHome({ flag: global.home, env, cwd });
    const module = await enableModule({ home, module: String(args.module), provider: flags.provider, ...(flags.model !== undefined ? { model: flags.model } : {}), env });
    log.warn(`${module.id} is on: each call sends ${module.sends} to ${module.host}, and asks first.`);
    return { data: { module } };
  },
});

export const cloudDisableCommand = defineCommand({
  name: 'cloud disable',
  summary: 'Turn a cloud module off.',
  positionals: [{ name: 'module', description: 'voice-cloud, images or vision', required: true }],
  flags: {},
  dataSchema: { type: 'object', required: ['module'], properties: { module: { type: 'object', required: ['id', 'enabled'] } } },
  async handler({ args, cwd, env, global }) {
    return { data: { module: await disableModule(dataHome({ flag: global.home, env, cwd }), String(args.module)) } };
  },
});
