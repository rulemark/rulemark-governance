import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      port: 3000,
      logLevel: 'info',
    });
  });

  it('reads the values it is given', () => {
    expect(loadConfig({ NODE_ENV: 'production', PORT: '8080', LOG_LEVEL: 'warn' })).toEqual({
      nodeEnv: 'production',
      port: 8080,
      logLevel: 'warn',
    });
  });

  it('treats an empty string as unset, so a blank line in .env does not override a default', () => {
    expect(loadConfig({ PORT: '', LOG_LEVEL: '   ' })).toEqual({
      nodeEnv: 'development',
      port: 3000,
      logLevel: 'info',
    });
  });

  it('rejects a port that is not a number, naming the variable', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: '3000.5' })).toThrow(ConfigError);
  });

  it('rejects an unknown log level, naming the variable', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('reports every problem at once, so one run fixes them all', () => {
    let message = '';
    try {
      loadConfig({ PORT: 'abc', LOG_LEVEL: 'chatty' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/LOG_LEVEL/);
  });

  it('allows the silent log level, which the tests rely on', () => {
    expect(loadConfig({ LOG_LEVEL: 'silent' }).logLevel).toBe('silent');
  });
});
