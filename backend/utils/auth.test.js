const { extractBearerToken, safeTokenCompare } = require('./auth');

describe('auth utils', () => {
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
});

describe('auth session cleanup throttling', () => {
  test('purges expired sessions at most once per cleanup interval', () => {
    jest.resetModules();

    const databaseMock = {
      purgeExpiredSessions: jest.fn(() => 2)
    };

    jest.doMock('../services/database', () => databaseMock);

    const auth = require('./auth');

    auth._resetSessionCleanupState();
    expect(auth.purgeExpiredSessionsIfNeeded(5 * 60 * 1000)).toBe(2);
    expect(auth.purgeExpiredSessionsIfNeeded((5 * 60 * 1000) + 1_000)).toBe(0);
    expect(auth.purgeExpiredSessionsIfNeeded(10 * 60 * 1000)).toBe(2);
    expect(databaseMock.purgeExpiredSessions).toHaveBeenCalledTimes(2);
  });
});
