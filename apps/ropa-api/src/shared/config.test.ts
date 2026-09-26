import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig, loadDatabaseConfig, loadDemoClientConfig } from './config.js';

/** The variables with no sensible default: everything else may be omitted. */
const REQUIRED = {
  DATABASE_URL: 'postgres://ropa:ropa@localhost:5432/ropa',
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'another-secret-long-enough-to-use',
  PRINCIPALS: '[{"sub":"priya.raman","name":"Priya Raman","roles":["editor","approver"]}]',
};

describe('loadConfig', () => {
  it('applies defaults when nothing is set', () => {
    expect(loadConfig({ ...REQUIRED })).toEqual({
      nodeEnv: 'development',
      port: 3000,
      logLevel: 'info',
      databaseUrl: REQUIRED.DATABASE_URL,
      jwtSecret: REQUIRED.JWT_SECRET,
      tokenMintSecret: REQUIRED.TOKEN_MINT_SECRET,
      principals: [{ sub: 'priya.raman', name: 'Priya Raman', roles: ['editor', 'approver'] }],
      requireAuthForReads: false,
      authDisabled: false,
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
      jwtSecret: REQUIRED.JWT_SECRET,
      tokenMintSecret: REQUIRED.TOKEN_MINT_SECRET,
      principals: [{ sub: 'priya.raman', name: 'Priya Raman', roles: ['editor', 'approver'] }],
      requireAuthForReads: false,
      authDisabled: false,
    });
  });

  it('treats an empty string as unset, so a blank line in .env does not override a default', () => {
    expect(loadConfig({ ...REQUIRED, PORT: '', LOG_LEVEL: '   ' })).toEqual({
      nodeEnv: 'development',
      port: 3000,
      logLevel: 'info',
      databaseUrl: REQUIRED.DATABASE_URL,
      jwtSecret: REQUIRED.JWT_SECRET,
      tokenMintSecret: REQUIRED.TOKEN_MINT_SECRET,
      principals: [{ sub: 'priya.raman', name: 'Priya Raman', roles: ['editor', 'approver'] }],
      requireAuthForReads: false,
      authDisabled: false,
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
    const { DATABASE_URL: _url, ...rest } = REQUIRED;
    expect(() => loadConfig(rest)).toThrow(ConfigError);
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });

  it('accepts a postgres connection string', () => {
    for (const url of [
      'postgres://ropa:ropa@localhost:5432/ropa',
      'postgresql://user:pw@dpg-abc.frankfurt-postgres.render.com/ropa',
      'postgres://ropa@db:5432/ropa?sslmode=require',
    ]) {
      expect(loadConfig({ ...REQUIRED, DATABASE_URL: url }).databaseUrl, url).toBe(url);
    }
  });

  it('rejects something that is not a connection string at all', () => {
    expect(() => loadConfig({ ...REQUIRED, DATABASE_URL: 'localhost:5432' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects the wrong protocol, which is usually a copied MySQL or Redis URL', () => {
    expect(() =>
      loadConfig({ ...REQUIRED, DATABASE_URL: 'mysql://ropa:ropa@localhost:3306/ropa' }),
    ).toThrow(/DATABASE_URL/);
  });
});

describe('secrets', () => {
  it('requires both secrets: neither may fall back to a default', () => {
    // A signing key with a default is a signing key everyone knows.
    const { JWT_SECRET: _jwt, ...withoutJwt } = REQUIRED;
    expect(() => loadConfig(withoutJwt)).toThrow(/JWT_SECRET/);

    const { TOKEN_MINT_SECRET: _mint, ...withoutMint } = REQUIRED;
    expect(() => loadConfig(withoutMint)).toThrow(/TOKEN_MINT_SECRET/);
  });

  it('rejects a secret too short to be worth anything', () => {
    expect(() => loadConfig({ ...REQUIRED, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });
});

describe('PRINCIPALS', () => {
  it('parses the JSON list of known subjects (§1.9)', () => {
    const config = loadConfig({
      ...REQUIRED,
      PRINCIPALS: JSON.stringify([
        { sub: 'priya.raman', name: 'Priya Raman', roles: ['editor', 'approver'] },
        { sub: 'svc:monitor', name: 'Subprocessor Monitor', roles: ['service:monitor'] },
      ]),
    });

    expect(config.principals).toHaveLength(2);
    expect(config.principals[1]).toEqual({
      sub: 'svc:monitor',
      name: 'Subprocessor Monitor',
      roles: ['service:monitor'],
    });
  });

  it('rejects malformed JSON, naming the variable', () => {
    expect(() => loadConfig({ ...REQUIRED, PRINCIPALS: '[{oops}]' })).toThrow(/PRINCIPALS/);
  });

  it('rejects a role nobody defined, rather than granting nothing silently', () => {
    expect(() =>
      loadConfig({
        ...REQUIRED,
        PRINCIPALS: JSON.stringify([{ sub: 'x', name: 'X', roles: ['superuser'] }]),
      }),
    ).toThrow(/PRINCIPALS/);
  });

  it('rejects a principal with no roles at all', () => {
    expect(() =>
      loadConfig({
        ...REQUIRED,
        PRINCIPALS: JSON.stringify([{ sub: 'x', name: 'X', roles: [] }]),
      }),
    ).toThrow(/PRINCIPALS/);
  });

  it('rejects two principals sharing a subject, which would make the token ambiguous', () => {
    expect(() =>
      loadConfig({
        ...REQUIRED,
        PRINCIPALS: JSON.stringify([
          { sub: 'priya.raman', name: 'Priya', roles: ['editor'] },
          { sub: 'priya.raman', name: 'Priya Again', roles: ['admin'] },
        ]),
      }),
    ).toThrow(/PRINCIPALS/);
  });
});

describe('auth switches', () => {
  it('reads the booleans as written in .env', () => {
    const config = loadConfig({
      ...REQUIRED,
      REQUIRE_AUTH_FOR_READS: 'true',
      AUTH_DISABLED: 'true',
    });
    expect(config.requireAuthForReads).toBe(true);
    expect(config.authDisabled).toBe(true);
  });

  it('rejects a value that is neither true nor false', () => {
    expect(() => loadConfig({ ...REQUIRED, AUTH_DISABLED: 'yes' })).toThrow(/AUTH_DISABLED/);
  });

  it('refuses to start with auth disabled in production', () => {
    // AUTH_DISABLED honours X-Actor, so anyone could claim to be anyone in the
    // history. That is a development convenience, never a deployment.
    expect(() =>
      loadConfig({ ...REQUIRED, NODE_ENV: 'production', AUTH_DISABLED: 'true' }),
    ).toThrow(/AUTH_DISABLED/);
  });

  it('allows auth disabled outside production', () => {
    expect(
      loadConfig({ ...REQUIRED, NODE_ENV: 'development', AUTH_DISABLED: 'true' }).authDisabled,
    ).toBe(true);
  });
});

describe('loadDatabaseConfig: for tools that only touch the database', () => {
  const DATABASE_URL = 'postgres://ropa:ropa@localhost:5432/ropa';

  it('needs DATABASE_URL and nothing else: no secrets, no principals', () => {
    expect(loadDatabaseConfig({ DATABASE_URL })).toEqual({
      nodeEnv: 'development',
      logLevel: 'info',
      databaseUrl: DATABASE_URL,
    });
  });

  it('reads the environment and log level the logger needs', () => {
    expect(
      loadDatabaseConfig({ DATABASE_URL, NODE_ENV: 'production', LOG_LEVEL: 'warn' }),
    ).toMatchObject({ nodeEnv: 'production', logLevel: 'warn' });
  });

  it('checks what it does read, as strictly as loadConfig', () => {
    expect(() => loadDatabaseConfig({})).toThrow(ConfigError);
    expect(() => loadDatabaseConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => loadDatabaseConfig({ DATABASE_URL, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});

describe('loadDemoClientConfig: demo:data talks HTTP and needs no database', () => {
  const TOKEN_MINT_SECRET = 'the-mint-secret-nobody-should-guess';

  it('needs the mint secret and nothing else, and defaults to the local service', () => {
    expect(loadDemoClientConfig({ TOKEN_MINT_SECRET })).toEqual({
      baseUrl: 'http://127.0.0.1:3000',
      subject: 'svc:seed',
      tokenMintSecret: TOKEN_MINT_SECRET,
    });
  });

  it('follows PORT locally, and DEMO_API_URL for a deployed service', () => {
    expect(loadDemoClientConfig({ TOKEN_MINT_SECRET, PORT: '4000' }).baseUrl).toBe(
      'http://127.0.0.1:4000',
    );
    expect(
      loadDemoClientConfig({
        TOKEN_MINT_SECRET,
        DEMO_API_URL: 'https://ropa-api.onrender.com/',
        DEMO_SUBJECT: 'priya.raman',
      }),
    ).toMatchObject({ baseUrl: 'https://ropa-api.onrender.com', subject: 'priya.raman' });
  });

  it('refuses a missing secret or a URL that is not one', () => {
    expect(() => loadDemoClientConfig({})).toThrow(/TOKEN_MINT_SECRET/);
    expect(() => loadDemoClientConfig({ TOKEN_MINT_SECRET, DEMO_API_URL: 'ropa' })).toThrow(
      /DEMO_API_URL/,
    );
  });
});
