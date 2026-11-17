import { describe, expect, it } from 'vitest';
import { CLOUD_CREDENTIALS, engineEnv } from '../../../src/engine/index';

const parent = {
  PATH: '/usr/bin',
  HOME: '/home/ana',
  LANG: 'en_US.UTF-8',
  TZ: 'UTC',
  HYPERFRAMES_CAPTURE_PROXY: 'http://proxy.example:8080',
  SECRET_TOKEN: 'leak',
  NODE_OPTIONS: '--require evil.js',
  npm_config_cache: '/tmp/npm',
  HTTPS_PROXY: 'http://proxy.example:8080',
  ...Object.fromEntries(CLOUD_CREDENTIALS.map((name) => [name, `sentinel-${name}`])),
};

describe('engine environment', () => {
  it('sets the telemetry, update-check, skill-install and optional-install switches', () => {
    const env = engineEnv({ engineDir: '/cache/engine/hf-0.9.61', parent });
    expect(env).toMatchObject({
      HYPERFRAMES_NO_UPDATE_CHECK: '1',
      HYPERFRAMES_NO_TELEMETRY: '1',
      DO_NOT_TRACK: '1',
      HYPERFRAMES_SKIP_SKILLS: '1',
      HYPERFRAMES_NO_OPTIONAL_INSTALL: '1',
      HYPERFRAMES_AGENT: '1',
      HYPERFRAMES_CACHE_DIR: '/cache/engine/hf-0.9.61/hf-cache',
      HYPERFRAMES_CONFIG_DIR: '/cache/engine/hf-0.9.61/hf-config',
    });
    expect(env.HYPERFRAMES_RENDER_LOCK).toBeUndefined();
    expect(env.HYPERFRAMES_BROWSER_PATH).toBeUndefined();
  });

  it('strips every cloud credential even when the parent has it', () => {
    const env = engineEnv({ engineDir: '/e', parent });
    for (const name of CLOUD_CREDENTIALS) expect(env[name], name).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain('sentinel-');
  });

  it('passes only the allow-listed parent variables', () => {
    const env = engineEnv({ engineDir: '/e', parent });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/ana');
    expect(env.HYPERFRAMES_CAPTURE_PROXY).toBe('http://proxy.example:8080');
    expect(env.SECRET_TOKEN).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.npm_config_cache).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
  });

  it('adds npm configuration and proxies for the engine install only', () => {
    const env = engineEnv({ engineDir: '/e', parent, forInstall: true });
    expect(env.npm_config_cache).toBe('/tmp/npm');
    expect(env.HTTPS_PROXY).toBe('http://proxy.example:8080');
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('adds exactly the credential one cloud call needs, and the per-call switches', () => {
    const env = engineEnv({
      engineDir: 'C:\\cache\\engine\\hf-0.9.61',
      parent,
      credentials: { ELEVENLABS_API_KEY: 'k' },
      allowOptionalInstall: true,
      renderLockOff: true,
      browserPath: '/chrome',
    });
    expect(env.ELEVENLABS_API_KEY).toBe('k');
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.HYPERFRAMES_NO_OPTIONAL_INSTALL).toBeUndefined();
    expect(env.HYPERFRAMES_RENDER_LOCK).toBe('off');
    expect(env.HYPERFRAMES_BROWSER_PATH).toBe('/chrome');
    expect(env.HYPERFRAMES_CACHE_DIR).toBe('C:\\cache\\engine\\hf-0.9.61\\hf-cache');
  });
});
