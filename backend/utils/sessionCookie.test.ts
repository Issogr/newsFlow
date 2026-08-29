describe('session cookie policy', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCookieSecure = process.env.COOKIE_SECURE;

  afterEach(() => {
    jest.resetModules();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalCookieSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = originalCookieSecure;
  });

  test('rejects invalid production secure-cookie settings', () => {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECURE = 'sometimes';

    const { getSessionCookieOptions } = require('./sessionCookie');
    expect(() => getSessionCookieOptions()).toThrow('COOKIE_SECURE must be one of: auto, true, false.');
  });

  test('uses a secure cookie for trusted HTTPS requests in auto mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECURE = 'auto';

    const { getSessionCookieOptions } = require('./sessionCookie');
    expect(getSessionCookieOptions({ secure: true }).secure).toBe(true);
  });
});
