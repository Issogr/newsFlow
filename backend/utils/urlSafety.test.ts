import { vi as jest } from 'vitest';
jest.doMock('node:dns', () => ({
  promises: {
    lookup: jest.fn()
  }
}));

jest.doMock('axios', () => ({ default: {
  get: jest.fn()
} }));

const dns: { lookup: import('vitest').Mock } = jest.mocked((await import('node:dns')).promises);
const axios: ReturnType<typeof require> = (await import('axios')).default;
const { fetchSafeTextUrl } = (await import('./urlSafety')).default;
import { Readable } from 'node:stream';

describe('urlSafety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('allows public http and https URLs', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    axios.get.mockResolvedValue({ status: 200, data: 'ok', headers: {} });

    await expect(fetchSafeTextUrl('https://example.com/feed')).resolves.toMatchObject({
      finalUrl: 'https://example.com/feed',
      data: 'ok'
    });
  });

  test('rejects localhost and private-network URLs', async () => {
    await expect(fetchSafeTextUrl('http://127.0.0.1/feed')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });

    await expect(fetchSafeTextUrl('http://localhost/feed')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });
  });

  test('rejects special-use IPv4 and IPv4-mapped IPv6 URLs', async () => {
    await expect(fetchSafeTextUrl('http://0.0.0.0/feed')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });

    await expect(fetchSafeTextUrl('http://100.64.0.1/feed')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });

    await expect(fetchSafeTextUrl('http://[::ffff:127.0.0.1]/feed')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });
  });

  test('rejects public hostnames that resolve to private IPs', async () => {
    dns.lookup.mockResolvedValue([{ address: '10.0.0.25', family: 4 }]);

    await expect(fetchSafeTextUrl('https://feeds.example.com/rss')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });
  });

  test('rejects public hostnames that resolve to IPv4-mapped private IPv6 addresses', async () => {
    dns.lookup.mockResolvedValue([{ address: '::ffff:7f00:1', family: 6 }]);

    await expect(fetchSafeTextUrl('https://feeds.example.com/rss')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });
  });

  test.each([
    ['172.31.255.255', 4, true], ['172.32.0.0', 4, false],
    ['::', 6, true], ['fd00::1', 6, true], ['febf::1', 6, true],
    ['ff02::1', 6, true], ['2001:db8::1', 6, true],
    ['::ffff:192.168.1.1', 6, true], ['::ffff:c0a8:101', 6, true],
    ['2606:4700:4700::1111', 6, false]
  ])('preserves outbound range policy for %s', async (address, family, blocked) => {
    dns.lookup.mockResolvedValue([{ address, family }]);
    axios.get.mockResolvedValue({ status: 200, data: 'ok', headers: {} });
    const result = fetchSafeTextUrl('https://example.com/feed');
    if (blocked) {
      await expect(result).rejects.toMatchObject({ code: 'FORBIDDEN_URL' });
      expect(axios.get).not.toHaveBeenCalled();
    } else {
      await expect(result).resolves.toMatchObject({ data: 'ok' });
    }
  });

  test('rejects non-http outbound schemes', async () => {
    await expect(fetchSafeTextUrl('javascript:alert(1)')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_URL'
    });
  });

  test('blocks redirects to private hosts', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    axios.get.mockResolvedValue({
      status: 302,
      headers: {
        location: 'http://127.0.0.1/admin'
      }
    });

    await expect(fetchSafeTextUrl('https://example.com/feed')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });
  });

  test('pins outbound requests to a validated IPv4 result when available', async () => {
    dns.lookup.mockResolvedValue([
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      { address: '93.184.216.34', family: 4 }
    ]);
    axios.get.mockResolvedValue({ status: 200, data: 'ok', headers: {} });

    await fetchSafeTextUrl('https://example.com/feed');

    const lookup = axios.get.mock.calls[0][1].lookup;
    const callback = jest.fn();

    lookup('example.com', {}, callback);

    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  test('rejects oversized outbound responses', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    axios.get.mockResolvedValue({
      status: 200,
      data: 'x'.repeat(32),
      headers: {}
    });

    await expect(fetchSafeTextUrl('https://example.com/feed', { maxResponseBytes: 16 })).rejects.toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE'
    });
  });

  test('reads streamed text, destroys oversized streams, and rejects premature closes', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const stream = Readable.from([Buffer.from('hello '), Buffer.from('world')]);
    axios.get.mockResolvedValue({ status: 200, data: stream, headers: {} });
    await expect(fetchSafeTextUrl('https://example.com/feed')).resolves.toMatchObject({ data: 'hello world' });

    const oversized = Readable.from([Buffer.alloc(32)]);
    axios.get.mockResolvedValue({ status: 200, data: oversized, headers: {} });
    await expect(fetchSafeTextUrl('https://example.com/feed', { maxResponseBytes: 16 }))
      .rejects.toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(oversized.destroyed).toBe(true);

    const aborted = new Readable({ read() { this.destroy(); } });
    axios.get.mockResolvedValue({ status: 200, data: aborted, headers: {} });
    await expect(fetchSafeTextUrl('https://example.com/feed'))
      .rejects.toMatchObject({ status: 502, code: 'CONNECTION_ERROR' });
  });
});
