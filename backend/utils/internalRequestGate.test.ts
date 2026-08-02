const {
  DEFAULT_INTERNAL_PROXY_TOKEN,
  hasTrustedInternalService,
  getInternalProxyToken,
} = require('./internalRequestGate');

describe('internalRequestGate', () => {
  const originalToken = process.env.INTERNAL_PROXY_TOKEN;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.INTERNAL_PROXY_TOKEN = 'test-proxy-token';
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    if (originalToken === undefined) {
      delete process.env.INTERNAL_PROXY_TOKEN;
    } else {
      process.env.INTERNAL_PROXY_TOKEN = originalToken;
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
      return;
    }

    process.env.NODE_ENV = originalNodeEnv;
  });

  test('falls back to the default token when env is missing', () => {
    delete process.env.INTERNAL_PROXY_TOKEN;

    expect(hasTrustedInternalService({
      'x-newsflow-proxy': DEFAULT_INTERNAL_PROXY_TOKEN
    })).toBe(true);
  });

  test('requires a non-default proxy token in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.INTERNAL_PROXY_TOKEN;

    expect(() => getInternalProxyToken()).toThrow('INTERNAL_PROXY_TOKEN is required in production.');

    process.env.INTERNAL_PROXY_TOKEN = DEFAULT_INTERNAL_PROXY_TOKEN;

    expect(() => getInternalProxyToken()).toThrow('INTERNAL_PROXY_TOKEN must not use the development default in production.');
  });

  test('accepts only requests carrying the trusted proxy token', () => {
    expect(hasTrustedInternalService({
      'x-newsflow-proxy': 'test-proxy-token'
    })).toBe(true);

    expect(hasTrustedInternalService({
      'x-newsflow-proxy': 'wrong-token'
    })).toBe(false);

    expect(hasTrustedInternalService({})).toBe(false);
  });
});
