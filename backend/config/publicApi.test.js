describe('publicApi config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('accepts only true for public API enable flags', () => {
    process.env.PUBLIC_API_ANONYMOUS_ENABLED = 'true';
    process.env.PUBLIC_API_AUTHENTICATED_ENABLED = 'true';

    const publicApi = require('./publicApi');

    expect(publicApi.isAnonymousPublicApiEnabled()).toBe(true);
    expect(publicApi.isAuthenticatedPublicApiEnabled()).toBe(true);
  });

  test('does not accept legacy true-like public API values', () => {
    process.env.PUBLIC_API_ANONYMOUS_ENABLED = '1';
    process.env.PUBLIC_API_AUTHENTICATED_ENABLED = 'yes';

    const publicApi = require('./publicApi');

    expect(publicApi.isAnonymousPublicApiEnabled()).toBe(false);
    expect(publicApi.isAuthenticatedPublicApiEnabled()).toBe(false);
  });
});
