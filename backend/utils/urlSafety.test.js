jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn()
  }
}));

jest.mock('axios', () => ({
  get: jest.fn()
}));

const dns = require('dns').promises;
const axios = require('axios');
const { assertSafeOutboundUrl, fetchSafeTextUrl } = require('./urlSafety');

describe('urlSafety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('allows public http and https URLs', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await expect(assertSafeOutboundUrl('https://example.com/feed')).resolves.toBe('https://example.com/feed');
  });

  test('rejects localhost and private-network URLs', async () => {
    await expect(assertSafeOutboundUrl('http://127.0.0.1/feed')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });

    await expect(assertSafeOutboundUrl('http://localhost/feed')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });
  });

  test('rejects special-use IPv4 and IPv4-mapped IPv6 URLs', async () => {
    await expect(assertSafeOutboundUrl('http://0.0.0.0/feed')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });

    await expect(assertSafeOutboundUrl('http://100.64.0.1/feed')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });

    await expect(assertSafeOutboundUrl('http://[::ffff:127.0.0.1]/feed')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });
  });

  test('rejects public hostnames that resolve to private IPs', async () => {
    dns.lookup.mockResolvedValue([{ address: '10.0.0.25', family: 4 }]);

    await expect(assertSafeOutboundUrl('https://feeds.example.com/rss')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });
  });

  test('rejects public hostnames that resolve to IPv4-mapped private IPv6 addresses', async () => {
    dns.lookup.mockResolvedValue([{ address: '::ffff:7f00:1', family: 6 }]);

    await expect(assertSafeOutboundUrl('https://feeds.example.com/rss')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_URL'
    });
  });

  test('rejects non-http outbound schemes', async () => {
    await expect(assertSafeOutboundUrl('javascript:alert(1)')).rejects.toMatchObject({
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

  test('pins outbound requests to the validated DNS result', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
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
});
