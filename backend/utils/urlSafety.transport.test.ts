import https from 'node:https';
import { vi } from 'vitest';
import urlSafety from './urlSafety';

test('the real Axios adapter selects a direct HTTPS connection even with an environment proxy', async () => {
  vi.stubEnv('https_proxy', 'http://proxy.example:8080');
  vi.stubEnv('no_proxy', '');
  vi.stubEnv('NO_PROXY', '');
  const transport = vi.spyOn(https, 'request').mockImplementation(() => { throw new Error('transport selected'); });
  try {
    await expect(urlSafety.fetchSafeTextUrl('https://93.184.216.34/feed')).rejects.toThrow('transport selected');
    const options = transport.mock.calls[0][0] as https.RequestOptions;
    expect(options.hostname).toBe('93.184.216.34');
    expect(options.lookup).toBeTypeOf('function');
    expect(options.agent ?? https.globalAgent).toBeInstanceOf(https.Agent);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
});
