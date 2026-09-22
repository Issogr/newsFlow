import networkConfig from './networkConfig';
const { getAllowedOrigins, isOriginAllowed } = networkConfig;

describe('networkConfig utils', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

  afterEach(() => {
    if (typeof originalNodeEnv === 'undefined') {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (typeof originalAllowedOrigins === 'undefined') {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  });

  test('getAllowedOrigins parses ALLOWED_ORIGINS from environment', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.example, https://b.example ';
    expect(getAllowedOrigins()).toEqual(['https://a.example', 'https://b.example']);
  });

  test('production defaults do not allow the whole local network implicitly', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOWED_ORIGINS;

    expect(getAllowedOrigins()).not.toContain('@local-network');
  });

  test.each([
    ['same-origin request', undefined, ['https://a.example'], true],
    ['global wildcard', 'https://any.example', ['*'], true],
    ['local network hostname', 'http://fedora.local', ['@local-network'], true],
    ['private IPv4 address', 'http://192.168.1.188', ['@local-network'], true],
    ['private IPv4 address with port', 'http://10.0.0.25:8080', ['@local-network'], true],
    ['loopback IPv4 address', 'http://127.0.0.2', ['@local-network'], true],
    ['first private 172 subnet', 'http://172.16.0.1', ['@local-network'], true],
    ['last private 172 subnet', 'http://172.31.255.255', ['@local-network'], true],
    ['before private 172 range', 'http://172.15.255.255', ['@local-network'], false],
    ['after private 172 range', 'http://172.32.0.1', ['@local-network'], false],
    ['invalid IPv4 address', 'http://192.168.999.1', ['@local-network'], false],
    ['wildcard local origin', 'http://fedora.local', ['http://*.local'], true],
    ['wildcard subdomain origin', 'https://app.example.com', ['https://*.example.com'], true],
    ['literal dots in wildcard origin', 'https://appXexample.com', ['https://*.example.com'], false],
    ['non-whitelisted origin', 'https://denied.example', ['https://allowed.example'], false],
    ['public origin with local-network token', 'https://public.example', ['@local-network'], false]
  ])('isOriginAllowed handles %s', (label, origin, allowedOrigins, expected) => {
    expect(isOriginAllowed(origin, allowedOrigins)).toBe(expected);
  });
});
