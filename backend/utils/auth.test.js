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

    jest.isolateModules(() => {
      const auth = require('./auth');

      expect(auth.purgeExpiredSessionsIfNeeded(5 * 60 * 1000)).toBe(2);
      expect(auth.purgeExpiredSessionsIfNeeded((5 * 60 * 1000) + 1_000)).toBe(0);
      expect(auth.purgeExpiredSessionsIfNeeded(10 * 60 * 1000)).toBe(2);
      expect(databaseMock.purgeExpiredSessions).toHaveBeenCalledTimes(2);
    });
  });

  test('refreshes the backend session expiry during authenticated requests', () => {
    jest.resetModules();

    const databaseMock = {
      findSessionByTokenHash: jest.fn(() => ({
        tokenHash: 'hashed-token',
        userId: 'user-1',
        username: 'alice',
        expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString()
      })),
      refreshSessionExpiry: jest.fn(() => 1),
      touchUserActivity: jest.fn(() => 1),
      purgeExpiredSessions: jest.fn(() => 0)
    };

    jest.doMock('../services/database', () => databaseMock);

    jest.isolateModules(() => {
      const auth = require('./auth');

      const resolved = auth.resolveAuthenticatedSession({
        headers: {
          authorization: 'Bearer my-session-token'
        }
      });

      expect(resolved.user).toEqual(expect.objectContaining({ username: 'alice' }));
      expect(databaseMock.findSessionByTokenHash).toHaveBeenCalledWith(auth.hashSessionToken('my-session-token'));
      expect(databaseMock.refreshSessionExpiry).toHaveBeenCalledWith('hashed-token', expect.any(String));
      expect(databaseMock.touchUserActivity).toHaveBeenCalledWith('user-1', expect.any(String), expect.any(Number));
    });
  });
});
