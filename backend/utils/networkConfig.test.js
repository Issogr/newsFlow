const { getAllowedOrigins, isOriginAllowed } = require('./networkConfig');

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

  test('isOriginAllowed returns true for wildcard and same-origin requests', () => {
    expect(isOriginAllowed(undefined, ['https://a.example'])).toBe(true);
    expect(isOriginAllowed('https://any.example', ['*'])).toBe(true);
  });

  test('isOriginAllowed accepts local network origins with the special token', () => {
    expect(isOriginAllowed('http://fedora.local', ['@local-network'])).toBe(true);
    expect(isOriginAllowed('http://192.168.1.188', ['@local-network'])).toBe(true);
    expect(isOriginAllowed('http://10.0.0.25:8080', ['@local-network'])).toBe(true);
  });

  test('isOriginAllowed supports wildcard origin entries', () => {
    expect(isOriginAllowed('http://fedora.local', ['http://*.local'])).toBe(true);
    expect(isOriginAllowed('https://app.example.com', ['https://*.example.com'])).toBe(true);
  });

  test('isOriginAllowed rejects non-whitelisted origins', () => {
    expect(isOriginAllowed('https://denied.example', ['https://allowed.example'])).toBe(false);
    expect(isOriginAllowed('https://public.example', ['@local-network'])).toBe(false);
  });
});
