const { requireAdminToken, extractBearerToken, safeTokenCompare } = require('./auth');

describe('auth utils', () => {
  const originalAdminApiToken = process.env.ADMIN_API_TOKEN;
  const originalLegacyAdminToken = process.env.API_ADMIN_TOKEN;

  afterEach(() => {
    if (typeof originalAdminApiToken === 'undefined') {
      delete process.env.ADMIN_API_TOKEN;
    } else {
      process.env.ADMIN_API_TOKEN = originalAdminApiToken;
    }

    if (typeof originalLegacyAdminToken === 'undefined') {
      delete process.env.API_ADMIN_TOKEN;
    } else {
      process.env.API_ADMIN_TOKEN = originalLegacyAdminToken;
    }
  });

  test('extractBearerToken returns empty string for invalid values', () => {
    expect(extractBearerToken()).toBe('');
    expect(extractBearerToken('Token abc')).toBe('');
    expect(extractBearerToken('Bearer')).toBe('');
  });

  test('extractBearerToken returns token for valid bearer header', () => {
    expect(extractBearerToken('Bearer my-token')).toBe('my-token');
  });

  test('safeTokenCompare validates equal token only', () => {
    expect(safeTokenCompare('abc', 'abc')).toBe(true);
    expect(safeTokenCompare('abc', 'abcd')).toBe(false);
    expect(safeTokenCompare('abc', 'def')).toBe(false);
  });

  test('requireAdminToken rejects when server token is not configured', () => {
    const req = { headers: {} };
    const next = jest.fn();

    requireAdminToken(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.status).toBe(503);
    expect(err.code).toBe('ADMIN_TOKEN_NOT_CONFIGURED');
  });

  test('requireAdminToken accepts valid bearer token', () => {
    process.env.ADMIN_API_TOKEN = 'top-secret';
    const req = { headers: { authorization: 'Bearer top-secret' } };
    const next = jest.fn();

    requireAdminToken(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('requireAdminToken rejects invalid token', () => {
    process.env.ADMIN_API_TOKEN = 'top-secret';
    const req = { headers: { 'x-admin-token': 'wrong-token' } };
    const next = jest.fn();

    requireAdminToken(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });
});
