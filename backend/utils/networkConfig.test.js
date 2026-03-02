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

  test('isOriginAllowed rejects non-whitelisted origins', () => {
    expect(isOriginAllowed('https://denied.example', ['https://allowed.example'])).toBe(false);
  });
});
