import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

/** The one variable with no sensible default: everything else may be omitted. */
const REQUIRED = { DATABASE_URL: 'postgres://ropa:ropa@localhost:5432/ropa' };

describe('loadConfig', () => {
  it('applies defaults when nothing is set', () => {
    expect(loadConfig({ ...REQUIRED })).toEqual({
      nodeEnv: 'development',
      port: 3000,
      logLevel: 'info',
      databaseUrl: REQUIRED.DATABASE_URL,
    });
  });

  it('reads the values it is given', () => {
    expect(
      loadConfig({ ...REQUIRED, NODE_ENV: 'production', PORT: '8080', LOG_LEVEL: 'warn' }),
    ).toEqual({
      nodeEnv: 'production',
      port: 8080,
      logLevel: 'warn',
      databaseUrl: REQUIRED.DATABASE_URL,
    });
  });

  it('treats an empty string as unset, so a blank line in .env does not override a default', () => {
    expect(loadConfig({ ...REQUIRED, PORT: '', LOG_LEVEL: '   ' })).toEqual({
      nodeEnv: 'development',
      port: 3000,
      logLevel: 'info',
      databaseUrl: REQUIRED.DATABASE_URL,
    });
  });

  it('rejects a port that is not a number, naming the variable', () => {
    expect(() => loadConfig({ ...REQUIRED, PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...REQUIRED, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ ...REQUIRED, PORT: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...REQUIRED, PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...REQUIRED, PORT: '3000.5' })).toThrow(ConfigError);
  });

  it('rejects an unknown log level, naming the variable', () => {
    expect(() => loadConfig({ ...REQUIRED, LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...REQUIRED, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('reports every problem at once, so one run fixes them all', () => {
    let message = '';
    try {
      loadConfig({ ...REQUIRED, PORT: 'abc', LOG_LEVEL: 'chatty' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/LOG_LEVEL/);
  });

  it('allows the silent log level, which the tests rely on', () => {
    expect(loadConfig({ ...REQUIRED, LOG_LEVEL: 'silent' }).logLevel).toBe('silent');
  });
});

describe('DATABASE_URL', () => {
  it('is required: the service cannot do anything useful without it', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('accepts a postgres connection string', () => {
    for (const url of [
      'postgres://ropa:ropa@localhost:5432/ropa',
      'postgresql://user:pw@dpg-abc.frankfurt-postgres.render.com/ropa',
      'postgres://ropa@db:5432/ropa?sslmode=require',
    ]) {
      expect(loadConfig({ DATABASE_URL: url }).databaseUrl, url).toBe(url);
    }
  });

  it('rejects something that is not a connection string at all', () => {
    expect(() => loadConfig({ DATABASE_URL: 'localhost:5432' })).toThrow(/DATABASE_URL/);
  });

  it('rejects the wrong protocol, which is usually a copied MySQL or Redis URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://ropa:ropa@localhost:3306/ropa' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
