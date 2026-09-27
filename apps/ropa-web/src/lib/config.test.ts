import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config';

describe('loadConfig', () => {
  it('takes the API as a URL, as local development gives it', () => {
    expect(loadConfig({ ROPA_API_URL: 'http://localhost:3000/' })).toEqual({
      ropaApiUrl: 'http://localhost:3000',
    });
  });

  // Render's Blueprint wires another service in as host:port (fromService,
  // hostport), which is plain http on the private network.
  it('takes the API as host:port, as the Blueprint wires it', () => {
    expect(loadConfig({ ROPA_API_URL: 'ropa-api-x1y2:10000' })).toEqual({
      ropaApiUrl: 'http://ropa-api-x1y2:10000',
    });
  });

  it('refuses to start without the API', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/ROPA_API_URL/);
  });

  it.each(['localhost', 'ftp://example.com', 'not a url'])('refuses %j', (value) => {
    expect(() => loadConfig({ ROPA_API_URL: value })).toThrow(
      /ROPA_API_URL: Must be host:port or an http\(s\) URL/,
    );
  });
});
