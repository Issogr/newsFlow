const {
  DEFAULT_INTERNAL_SERVICE,
  DEFAULT_INTERNAL_PROXY_TOKEN,
  getInternalServiceName,
  hasTrustedInternalService,
} = require('./internalRequestGate');

describe('internalRequestGate', () => {
  const originalToken = process.env.INTERNAL_PROXY_TOKEN;
  const originalServiceName = process.env.INTERNAL_SERVICE_NAME;

  beforeEach(() => {
    process.env.INTERNAL_PROXY_TOKEN = 'test-proxy-token';
    process.env.INTERNAL_SERVICE_NAME = 'bff';
  });

  afterAll(() => {
    if (originalToken === undefined) {
      delete process.env.INTERNAL_PROXY_TOKEN;
    } else {
      process.env.INTERNAL_PROXY_TOKEN = originalToken;
    }

    if (originalServiceName === undefined) {
      delete process.env.INTERNAL_SERVICE_NAME;
      return;
    }

    process.env.INTERNAL_SERVICE_NAME = originalServiceName;
  });

  test('falls back to the default token and service when env is missing', () => {
    delete process.env.INTERNAL_PROXY_TOKEN;
    delete process.env.INTERNAL_SERVICE_NAME;

    expect(hasTrustedInternalService({
      'x-newsflow-proxy': DEFAULT_INTERNAL_PROXY_TOKEN,
      'x-newsflow-service': DEFAULT_INTERNAL_SERVICE
    })).toBe(true);
  });

  test('reads the internal service name from configuration', () => {
    expect(getInternalServiceName()).toBe('bff');

    process.env.INTERNAL_SERVICE_NAME = 'edge-proxy';

    expect(getInternalServiceName()).toBe('edge-proxy');
  });

  test('accepts only requests coming through the trusted proxy token and service name', () => {
    expect(hasTrustedInternalService({
      'x-newsflow-proxy': 'test-proxy-token',
      'x-newsflow-service': 'bff'
    })).toBe(true);

    expect(hasTrustedInternalService({
      'x-newsflow-proxy': 'wrong-token',
      'x-newsflow-service': 'bff'
    })).toBe(false);

    expect(hasTrustedInternalService({
      'x-newsflow-proxy': 'test-proxy-token',
      'x-newsflow-service': 'other'
    })).toBe(false);

    expect(hasTrustedInternalService({})).toBe(false);
  });
});
