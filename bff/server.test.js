const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const cookieSignature = require('cookie-signature');
const request = require('supertest');
const { createApp, createServer, _getTrustProxySetting } = require('./server');
const {
  encryptBackendSessionCookie,
  getBffSessionSecret,
  isValidSessionPayload,
  unsignSessionId
} = require('./lib/sessionPolicy');

const SAME_ORIGIN = 'http://127.0.0.1';

async function listen(server) {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
}

async function close(server) {
  await new Promise((resolve) => {
    server.close(resolve);
  });
}

function requestUpgrade(server, { cookie = '', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/socket.io/?EIO=4&transport=websocket',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
    });

    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ statusCode: res.statusCode, headers: res.headers, upgraded: true });
    });
    req.on('response', (res) => {
      res.resume();
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, upgraded: false }));
    });
    req.on('error', reject);
    req.end();
  });
}

function createFrontendDist() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newsflow-bff-frontend-'));
  fs.mkdirSync(path.join(tempDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'index.html'), '<!doctype html><html><body>News Flow</body></html>');
  fs.writeFileSync(path.join(tempDir, 'assets', 'app-test.js'), 'window.__newsFlowTest = true;');
  fs.writeFileSync(path.join(tempDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" />');
  return tempDir;
}

function createSessionDbPath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newsflow-bff-session-'));
  return {
    tempDir,
    sessionDbPath: path.join(tempDir, 'sessions.sqlite'),
  };
}

function getBffSessionCookie(response) {
  const cookie = response.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));
  expect(cookie).toContain('newsflow_bff_session=');
  return cookie;
}

async function login(target, { username = 'alice', headers = {} } = {}) {
  const response = await request(target)
    .post('/api/auth/login')
    .set(headers)
    .send({ username, password: 'secret123' })
    .expect(200);

  return {
    response,
    cookie: getBffSessionCookie(response),
  };
}

function restoreEnvValue(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function withEnv(overrides, callback) {
  const previousValues = Object.fromEntries(Object.keys(overrides).map((name) => [name, process.env[name]]));

  Object.entries(overrides).forEach(([name, value]) => {
    restoreEnvValue(name, value);
  });

  try {
    return await callback();
  } finally {
    Object.entries(previousValues).forEach(([name, value]) => {
      restoreEnvValue(name, value);
    });
  }
}

function cleanupCreatedApp(created, tempDir) {
  created?.sessionStore?.stopCleanupInterval?.();
  created?.sessionDb?.close?.();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('bff server', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let backendServer;
  let backendBaseUrl;
  let frontendDistDir;
  let sessionDir;
  let sessionDbPath;
  let app;
  let sessionDb;
  let sessionStore;
  let lastBackendHeaders;
  let logoutShouldFail;

  beforeEach(async () => {
    frontendDistDir = createFrontendDist();
    ({ tempDir: sessionDir, sessionDbPath } = createSessionDbPath());
    lastBackendHeaders = {};
    logoutShouldFail = false;
    const backendSessions = new Map();
    const usersById = new Map([
      ['admin-id', { id: 'admin-id', username: 'admin' }],
      ['user-1', { id: 'user-1', username: 'alice' }],
    ]);

    process.env.BFF_SESSION_SECRET = 'test-bff-secret';
    process.env.INTERNAL_PROXY_TOKEN = 'test-proxy-token';
    process.env.INTERNAL_SERVICE_NAME = 'bff';
    process.env.TRUST_PROXY = 'true';

    const backendApp = express();
    backendApp.use(express.json());

    backendApp.post('/internal-api/auth/login', (req, res) => {
      lastBackendHeaders = req.headers;
      const requestedUsername = String(req.body?.username || '').trim().toLowerCase();
      const user = requestedUsername === 'admin' ? usersById.get('admin-id') : usersById.get('user-1');
      const sessionValue = `backend-session-${user.id}`;
      backendSessions.set(`newsflow_session=${sessionValue}`, user);
      res.cookie('newsflow_session', sessionValue, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      });
      res.json({ user });
    });

    backendApp.post('/internal-api/auth/logout', (req, res) => {
      lastBackendHeaders = req.headers;
      if (logoutShouldFail) {
        res.status(503).json({ error: { message: 'Backend unavailable', code: 'UNAVAILABLE' } });
        return;
      }

      backendSessions.delete(String(req.headers.cookie || ''));
      res.json({ success: true });
    });

    backendApp.get('/internal-api/me', (req, res) => {
      lastBackendHeaders = req.headers;

      const user = backendSessions.get(String(req.headers.cookie || ''));
      if (!user) {
        res.status(401).json({ error: { message: 'Authentication required', code: 'UNAUTHORIZED' } });
        return;
      }

      res.json({ user });
    });

    backendApp.get('/internal-api/broken-stream', (req, res) => {
      req.socket.destroy();
    });

    backendApp.delete('/internal-api/admin/users/:userId', (req, res) => {
      lastBackendHeaders = req.headers;
      const actingUser = backendSessions.get(String(req.headers.cookie || ''));

      if (!actingUser || actingUser.id !== 'admin-id') {
        res.status(401).json({ error: { message: 'Authentication required', code: 'UNAUTHORIZED' } });
        return;
      }

      const targetUser = usersById.get(req.params.userId);
      if (!targetUser) {
        res.status(404).json({ error: { message: 'User not found', code: 'RESOURCE_NOT_FOUND' } });
        return;
      }

      res.json({ success: true, user: targetUser });
    });

    backendApp.post('/internal-api/me/feedback', (req, res) => {
      lastBackendHeaders = req.headers;
      let byteCount = 0;

      req.on('data', (chunk) => {
        byteCount += chunk.length;
      });
      req.on('end', () => {
        res.json({ contentType: req.headers['content-type'], byteCount });
      });
    });

    backendApp.get('/api/public/ping', (req, res) => {
      lastBackendHeaders = req.headers;
      res.cookie('newsflow_session', 'backend-public-cookie', { httpOnly: true, path: '/' });
      res.json({ ok: true });
    });

    backendApp.get('/socket.io/ping', (req, res) => {
      lastBackendHeaders = req.headers;
      res.json({ path: req.path });
    });

    backendServer = http.createServer(backendApp);
    await new Promise((resolve) => {
      backendServer.listen(0, resolve);
    });

    const { port } = backendServer.address();
    backendBaseUrl = `http://127.0.0.1:${port}`;

    const created = createApp({ backendBaseUrl, frontendDistDir, sessionDbPath, appBaseUrl: SAME_ORIGIN });
    app = created.app;
    sessionDb = created.sessionDb;
    sessionStore = created.sessionStore;
  });

  afterEach(async () => {
    await close(backendServer);
    cleanupCreatedApp({ sessionStore, sessionDb }, sessionDir);
    fs.rmSync(frontendDistDir, { recursive: true, force: true });
    delete process.env.BFF_SESSION_SECRET;
    delete process.env.INTERNAL_PROXY_TOKEN;
    delete process.env.INTERNAL_SERVICE_NAME;
    delete process.env.TRUST_PROXY;
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test('creates a persisted BFF session on login and uses it for proxied app requests', async () => {
    const { cookie: bffSessionCookie } = await login(app);

    expect(bffSessionCookie).not.toContain('newsflow_session=');
    expect(bffSessionCookie).not.toContain('backend-session-user-1');
    expect(sessionDb.prepare('SELECT sess FROM sessions').get().sess).not.toContain('backend-session-user-1');
    expect(lastBackendHeaders['x-newsflow-service']).toBe('bff');
    expect(lastBackendHeaders['x-newsflow-proxy']).toBe('test-proxy-token');

    const meResponse = await request(app)
      .get('/api/me')
      .set('Cookie', bffSessionCookie)
      .expect(200);

    expect(meResponse.body).toEqual({ user: { id: 'user-1', username: 'alice' } });
    expect(lastBackendHeaders.cookie).toBe('newsflow_session=backend-session-user-1');
    expect(meResponse.headers['set-cookie']).toBeUndefined();
  });

  test('serves browser responses with security headers', async () => {
    const response = await request(app)
      .get('/')
      .expect(200);

    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("connect-src 'self' ws: wss:");
    expect(response.headers['referrer-policy']).toBe('same-origin');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  test('only marks fingerprinted assets as immutable', async () => {
    const assetResponse = await request(app)
      .get('/assets/app-test.js')
      .expect(200);
    const iconResponse = await request(app)
      .get('/icon.svg')
      .expect(200);

    expect(assetResponse.headers['cache-control']).toBe('public, max-age=2592000, immutable');
    expect(iconResponse.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
  });

  test('returns a client error for malformed JSON on auth routes', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{bad json')
      .expect(400);

    expect(response.body.error).toEqual({
      message: 'Request body contains malformed JSON.',
      code: 'INVALID_JSON',
    });
  });

  test('keeps the session valid after recreating the BFF app instance', async () => {
    const { cookie: bffSessionCookie } = await login(app);
    sessionDb.close();
    sessionStore.stopCleanupInterval();

    const restarted = createApp({ backendBaseUrl, frontendDistDir, sessionDbPath, appBaseUrl: SAME_ORIGIN });
    const meResponse = await request(restarted.app)
      .get('/api/me')
      .set('Cookie', bffSessionCookie)
      .expect(200);

    restarted.sessionStore.stopCleanupInterval();
    restarted.sessionDb.close();
    expect(meResponse.body).toEqual({ user: { id: 'user-1', username: 'alice' } });
    expect(lastBackendHeaders.cookie).toBe('newsflow_session=backend-session-user-1');
  });

  test('clears the BFF session on logout', async () => {
    const { cookie: bffSessionCookie } = await login(app);

    const logoutResponse = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', bffSessionCookie)
      .set('Origin', SAME_ORIGIN)
      .expect(200);

    expect(getBffSessionCookie(logoutResponse)).toContain('Max-Age=0');

    await request(app)
      .get('/api/me')
      .set('Cookie', bffSessionCookie)
      .expect(401);
  });

  test('clears the local BFF session when backend logout fails', async () => {
    const { cookie: bffSessionCookie } = await login(app);
    logoutShouldFail = true;

    const logoutResponse = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', bffSessionCookie)
      .set('Origin', SAME_ORIGIN)
      .expect(200);

    expect(logoutResponse.body).toEqual({ success: true });
    expect(getBffSessionCookie(logoutResponse)).toContain('Max-Age=0');

    await request(app)
      .get('/api/me')
      .set('Cookie', bffSessionCookie)
      .expect(401);
  });

  test('does not allow raw backend session headers through the app proxy', async () => {
    await request(app)
      .delete('/api/admin/users/user-1')
      .set('x-session-token', 'backend-session-admin-id')
      .expect(401);

    const { cookie: adminBffSessionCookie } = await login(app, { username: 'admin' });

    await request(app)
      .delete('/api/admin/users/user-1')
      .set('Cookie', adminBffSessionCookie)
      .set('Origin', SAME_ORIGIN)
      .set('Authorization', 'Bearer hostile')
      .set('x-session-token', 'hostile')
      .set('x-newsflow-app', 'hostile')
      .expect(200);

    expect(lastBackendHeaders.authorization).toBeUndefined();
    expect(lastBackendHeaders['x-session-token']).toBeUndefined();
    expect(lastBackendHeaders['x-newsflow-app']).toBeUndefined();
    expect(lastBackendHeaders.cookie).toBe('newsflow_session=backend-session-admin-id');
  });

  test.each([
    { name: 'without same-origin headers', headers: {} },
    { name: 'from another origin', headers: { Origin: 'https://evil.example' } },
  ])('rejects unsafe authenticated API proxy requests $name', async ({ headers }) => {
    const { cookie: adminBffSessionCookie } = await login(app, { username: 'admin' });

    const response = await request(app)
      .delete('/api/admin/users/user-1')
      .set('Cookie', adminBffSessionCookie)
      .set(headers)
      .expect(403);

    expect(response.body.error).toEqual({
      message: 'Cross-origin request rejected.',
      code: 'CSRF_ORIGIN_MISMATCH',
    });
  });

  test('does not let static files shadow protected API routes', async () => {
    fs.mkdirSync(path.join(frontendDistDir, 'api'), { recursive: true });
    fs.writeFileSync(path.join(frontendDistDir, 'api', 'me'), 'static api shadow');

    const response = await request(app)
      .get('/api/me')
      .expect(401);

    expect(response.body.error).toEqual(expect.objectContaining({ code: 'UNAUTHORIZED' }));
    expect(response.text).not.toContain('static api shadow');
  });

  test('parses trust proxy settings without trusting every forwarded header for boolean true', () => {
    expect(_getTrustProxySetting('true')).toBe(1);
    expect(_getTrustProxySetting('2')).toBe(2);
    expect(_getTrustProxySetting('loopback, linklocal')).toEqual(['loopback', 'linklocal']);
    expect(_getTrustProxySetting('false')).toBe(false);
  });

  test.each([
    '/api/admin/users/user-1',
    '/api/admin/users/user-1/'
  ])('removes persisted BFF sessions for a deleted user after admin delete %s', async (deletePath) => {
    const { cookie: aliceBffSessionCookie } = await login(app);
    const { cookie: adminBffSessionCookie } = await login(app, { username: 'admin' });

    expect(sessionDb.prepare('SELECT COUNT(*) as count FROM sessions').get().count).toBe(2);

    await request(app)
      .delete(deletePath)
      .set('Cookie', adminBffSessionCookie)
      .set('Origin', SAME_ORIGIN)
      .expect(200);

    expect(sessionDb.prepare('SELECT COUNT(*) as count FROM sessions').get().count).toBe(1);

    await request(app)
      .get('/api/me')
      .set('Cookie', aliceBffSessionCookie)
      .expect(401);

    expect(lastBackendHeaders.cookie).not.toBe('newsflow_session=backend-session-user-1');
  });

  test('repairs the session user index for existing valid sessions', async () => {
    const { cookie: aliceBffSessionCookie } = await login(app);

    sessionDb.prepare('DELETE FROM session_users').run();
    expect(sessionDb.prepare('SELECT COUNT(*) as count FROM session_users').get().count).toBe(0);

    await request(app)
      .get('/api/me')
      .set('Cookie', aliceBffSessionCookie)
      .expect(200);

    expect(sessionDb.prepare('SELECT COUNT(*) as count FROM session_users WHERE user_id = ?').get('user-1').count).toBe(1);
  });

  test('removes stale session_users rows when expired sessions are cleaned', async () => {
    await login(app);

    expect(sessionDb.prepare('SELECT COUNT(*) as count FROM sessions').get().count).toBe(1);
    expect(sessionDb.prepare('SELECT COUNT(*) as count FROM session_users').get().count).toBe(1);

    sessionDb.prepare('UPDATE sessions SET expire = ?').run(new Date(Date.now() - 1000).toISOString());
    sessionStore.clearExpiredSessions();

    expect(sessionDb.prepare('SELECT COUNT(*) as count FROM sessions').get().count).toBe(0);
    expect(sessionDb.prepare('SELECT COUNT(*) as count FROM session_users').get().count).toBe(0);
  });

  test('proxies public API routes without requiring a BFF session', async () => {
    const response = await request(app)
      .get('/api/public/ping')
      .expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  test('rebuilds forwarded headers on public API routes from trusted request values', async () => {
    await request(app)
      .get('/api/public/ping')
      .set('X-Forwarded-For', '203.0.113.99')
      .set('X-Forwarded-Host', 'evil.example')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);

    expect(lastBackendHeaders['x-forwarded-for']).toContain('203.0.113.99');
    expect(lastBackendHeaders['x-forwarded-host']).not.toBe('evil.example');
    expect(lastBackendHeaders['x-forwarded-proto']).toBe('https');
  });

  test('does not trust caller forwarded headers unless explicitly configured', async () => {
    const directSession = createSessionDbPath();

    await withEnv({ TRUST_PROXY: undefined, NODE_ENV: 'production' }, async () => {
      let directApp;

      try {
        directApp = createApp({ backendBaseUrl, frontendDistDir, sessionDbPath: directSession.sessionDbPath, appBaseUrl: SAME_ORIGIN });
        await request(directApp.app)
          .get('/api/public/ping')
          .set('X-Forwarded-For', '203.0.113.99')
          .set('X-Forwarded-Proto', 'https')
          .expect(200);

        expect(lastBackendHeaders['x-forwarded-for']).not.toContain('203.0.113.99');
        expect(lastBackendHeaders['x-forwarded-proto']).toBe('http');
      } finally {
        cleanupCreatedApp(directApp, directSession.tempDir);
      }
    });
  });

  test('sets a secure BFF session cookie behind an HTTPS proxy without global proxy trust', async () => {
    const secureProxySession = createSessionDbPath();

    await withEnv({
      APP_BASE_URL: 'https://news.example',
      TRUST_PROXY: undefined,
      NODE_ENV: 'production'
    }, async () => {
      let secureProxyApp;

      try {
        secureProxyApp = createApp({
          backendBaseUrl,
          frontendDistDir,
          sessionDbPath: secureProxySession.sessionDbPath,
        });

        const response = await request(secureProxyApp.app)
          .post('/api/auth/login')
          .set('Host', 'news.example')
          .set('X-Forwarded-Proto', 'https')
          .send({ username: 'alice', password: 'secret123' })
          .expect(200);

        expect(getBffSessionCookie(response)).toContain('Secure');
        expect(lastBackendHeaders['x-forwarded-proto']).toBe('http');
      } finally {
        cleanupCreatedApp(secureProxyApp, secureProxySession.tempDir);
      }
    });
  });

  test('rebuilds forwarded headers on authenticated app routes from trusted request values', async () => {
    const { cookie: bffSessionCookie } = await login(app, {
      headers: {
        'X-Forwarded-For': '203.0.113.99',
        'X-Forwarded-Host': 'evil.example',
        'X-Forwarded-Proto': 'https',
      },
    });

    await request(app)
      .get('/api/me')
      .set('Cookie', bffSessionCookie)
      .set('X-Forwarded-For', '203.0.113.99')
      .set('X-Forwarded-Host', 'evil.example')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);

    expect(lastBackendHeaders['x-forwarded-for']).toContain('203.0.113.99');
    expect(lastBackendHeaders['x-forwarded-host']).not.toBe('evil.example');
    expect(lastBackendHeaders['x-forwarded-proto']).toBe('https');
  });

  test('streams multipart feedback through the authenticated app proxy', async () => {
    const { cookie: bffSessionCookie } = await login(app);

    const response = await request(app)
      .post('/api/me/feedback')
      .set('Cookie', bffSessionCookie)
      .set('Origin', SAME_ORIGIN)
      .field('category', 'bug')
      .field('title', 'Upload issue')
      .field('description', 'Attached screenshot')
      .attach('attachment', Buffer.from('fake-image'), 'screenshot.png')
      .expect(200);

    expect(response.body.contentType).toContain('multipart/form-data');
    expect(response.body.byteCount).toBeGreaterThan(0);
    expect(lastBackendHeaders.cookie).toBe('newsflow_session=backend-session-user-1');
  });

  test('proxies socket.io requests without duplicating the socket path', async () => {
    const { cookie: bffSessionCookie } = await login(app);

    const response = await request(app)
      .get('/socket.io/ping')
      .set('Cookie', bffSessionCookie)
      .expect(200);

    expect(response.body.path).toBe('/socket.io/ping');
    expect(lastBackendHeaders.cookie).toBe('newsflow_session=backend-session-user-1');
  });

  test('rejects authenticated socket.io requests from another origin', async () => {
    const { cookie: bffSessionCookie } = await login(app);
    lastBackendHeaders = {};

    const response = await request(app)
      .get('/socket.io/ping')
      .set('Cookie', bffSessionCookie)
      .set('Origin', 'https://evil.example')
      .expect(403);

    expect(response.body.error).toEqual({
      message: 'Cross-origin request rejected.',
      code: 'CSRF_ORIGIN_MISMATCH',
    });
    expect(lastBackendHeaders.cookie).toBeUndefined();
  });

  test('rejects unauthenticated raw socket upgrades before proxying to the backend', async () => {
    const bffServer = createServer({ backendBaseUrl, frontendDistDir, sessionDbPath });
    await listen(bffServer);

    try {
      const response = await requestUpgrade(bffServer);

      expect(response).toEqual(expect.objectContaining({
        statusCode: 401,
        upgraded: false,
      }));
    } finally {
      await close(bffServer);
    }
  });

  test('proxies authenticated raw socket upgrades with sanitized session headers', async () => {
    const bffServer = createServer({ backendBaseUrl, frontendDistDir, sessionDbPath });
    let backendUpgradeHeaders = null;
    backendServer.once('upgrade', (req, socket) => {
      backendUpgradeHeaders = req.headers;
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      socket.destroy();
    });
    await listen(bffServer);

    try {
      const { cookie: bffSessionCookie } = await login(bffServer);

      const response = await requestUpgrade(bffServer, {
        cookie: bffSessionCookie,
        headers: {
          Authorization: 'Bearer hostile',
          'x-session-token': 'hostile',
          'x-newsflow-app': 'hostile',
        },
      });

      expect(response).toEqual(expect.objectContaining({
        statusCode: 101,
        upgraded: true,
      }));
      expect(backendUpgradeHeaders.authorization).toBeUndefined();
      expect(backendUpgradeHeaders['x-session-token']).toBeUndefined();
      expect(backendUpgradeHeaders['x-newsflow-app']).toBeUndefined();
      expect(backendUpgradeHeaders.cookie).toBe('newsflow_session=backend-session-user-1');
      expect(backendUpgradeHeaders['x-newsflow-proxy']).toBe('test-proxy-token');
    } finally {
      await close(bffServer);
    }
  });

  test('rejects authenticated raw socket upgrades from another origin', async () => {
    const bffServer = createServer({ backendBaseUrl, frontendDistDir, sessionDbPath, appBaseUrl: SAME_ORIGIN });
    await listen(bffServer);

    try {
      const { cookie: bffSessionCookie } = await login(bffServer);

      const response = await requestUpgrade(bffServer, {
        cookie: bffSessionCookie,
        headers: {
          Origin: 'https://evil.example',
        },
      });

      expect(response).toEqual(expect.objectContaining({
        statusCode: 403,
        upgraded: false,
      }));
    } finally {
      await close(bffServer);
    }
  });

  test('returns structured JSON when the app proxy fails upstream', async () => {
    const { cookie: bffSessionCookie } = await login(app);

    const response = await request(app)
      .get('/api/broken-stream')
      .set('Cookie', bffSessionCookie)
      .expect(502);

    expect(response.body.error).toEqual({
      message: 'Unable to reach the application backend.',
      code: 'BFF_UPSTREAM_ERROR',
    });
  });

});

describe('session policy helpers', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSessionSecret = process.env.BFF_SESSION_SECRET;

  beforeEach(() => {
    process.env.BFF_SESSION_SECRET = 'test-bff-secret';
  });

  afterEach(() => {
    restoreEnvValue('NODE_ENV', originalNodeEnv);
    restoreEnvValue('BFF_SESSION_SECRET', originalSessionSecret);
  });

  test('requires a non-default BFF session secret in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.BFF_SESSION_SECRET;

    expect(() => getBffSessionSecret()).toThrow('BFF_SESSION_SECRET is required in production.');

    process.env.BFF_SESSION_SECRET = 'development-only-change-me';

    expect(() => getBffSessionSecret()).toThrow('BFF_SESSION_SECRET must not use the development default in production.');
  });

  test('reads signed session cookies with the configured secret', () => {
    const signed = `s:${cookieSignature.sign('session-id', 'test-bff-secret')}`;
    expect(unsignSessionId(signed, getBffSessionSecret())).toBe('session-id');
  });

  test('validates the stored session payload schema version', () => {
    const encryptedCookie = encryptBackendSessionCookie('newsflow_session=abc');

    expect(isValidSessionPayload({ version: 1, backendSessionCookie: encryptedCookie })).toBe(true);
    expect(isValidSessionPayload({ version: 1, backendSessionCookie: 'newsflow_session=abc' })).toBe(false);
    expect(isValidSessionPayload({ version: 2, backendSessionCookie: 'newsflow_session=abc' })).toBe(false);
    expect(isValidSessionPayload({ version: 1, backendSessionCookie: '' })).toBe(false);
  });
});
