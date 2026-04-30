const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const cookieSignature = require('cookie-signature');
const request = require('supertest');
const { createApp, getBffSessionSecret, isValidSessionPayload, unsignSessionId } = require('./server');

function createFrontendDist() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newsflow-bff-frontend-'));
  fs.writeFileSync(path.join(tempDir, 'index.html'), '<!doctype html><html><body>News Flow</body></html>');
  return tempDir;
}

function createSessionDbPath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newsflow-bff-session-'));
  return {
    tempDir,
    sessionDbPath: path.join(tempDir, 'sessions.sqlite'),
  };
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
    process.env.SESSION_STORE_CLEAR_INTERVAL_MS = '0';

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

    const created = createApp({ backendBaseUrl, frontendDistDir, sessionDbPath });
    app = created.app;
    sessionDb = created.sessionDb;
    sessionStore = created.sessionStore;
  });

  afterEach(async () => {
    await new Promise((resolve) => {
      backendServer.close(resolve);
    });

    sessionStore?.stopCleanupInterval?.();
    sessionDb?.close?.();
    fs.rmSync(frontendDistDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
    delete process.env.BFF_SESSION_SECRET;
    delete process.env.INTERNAL_PROXY_TOKEN;
    delete process.env.INTERNAL_SERVICE_NAME;
    delete process.env.SESSION_STORE_CLEAR_INTERVAL_MS;
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test('creates a persisted BFF session on login and uses it for proxied app requests', async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);

    const bffSessionCookie = loginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));

    expect(bffSessionCookie).toContain('newsflow_bff_session=');
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
    expect(meResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='))).toContain('Expires=');
  });

  test('serves browser responses with security headers', async () => {
    const response = await request(app)
      .get('/')
      .expect(200);

    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['referrer-policy']).toBe('same-origin');
    expect(response.headers['set-cookie']).toBeUndefined();
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
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);

    const bffSessionCookie = loginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));
    sessionDb.close();
    sessionStore.stopCleanupInterval();

    const restarted = createApp({ backendBaseUrl, frontendDistDir, sessionDbPath });
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
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);

    const bffSessionCookie = loginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));

    const logoutResponse = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', bffSessionCookie)
      .expect(200);

    expect(logoutResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='))).toContain('Max-Age=0');

    await request(app)
      .get('/api/me')
      .set('Cookie', bffSessionCookie)
      .expect(401);
  });

  test('clears the local BFF session when backend logout fails', async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);

    const bffSessionCookie = loginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));
    logoutShouldFail = true;

    const logoutResponse = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', bffSessionCookie)
      .expect(200);

    expect(logoutResponse.body).toEqual({ success: true });
    expect(logoutResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='))).toContain('Max-Age=0');

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

    const adminLoginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'secret123' })
      .expect(200);
    const adminBffSessionCookie = adminLoginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));

    await request(app)
      .delete('/api/admin/users/user-1')
      .set('Cookie', adminBffSessionCookie)
      .set('Authorization', 'Bearer hostile')
      .set('x-session-token', 'hostile')
      .set('x-newsflow-app', 'hostile')
      .expect(200);

    expect(lastBackendHeaders.authorization).toBeUndefined();
    expect(lastBackendHeaders['x-session-token']).toBeUndefined();
    expect(lastBackendHeaders['x-newsflow-app']).toBeUndefined();
    expect(lastBackendHeaders.cookie).toBe('newsflow_session=backend-session-admin-id');
  });

  test('removes persisted BFF sessions for a deleted user after an admin delete', async () => {
    const aliceLoginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);
    const aliceBffSessionCookie = aliceLoginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));

    const adminLoginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'secret123' })
      .expect(200);
    const adminBffSessionCookie = adminLoginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));

    expect(sessionDb.prepare('SELECT COUNT(*) as count FROM sessions').get().count).toBe(2);

    await request(app)
      .delete('/api/admin/users/user-1')
      .set('Cookie', adminBffSessionCookie)
      .expect(200);

    expect(sessionDb.prepare('SELECT COUNT(*) as count FROM sessions').get().count).toBe(1);

    await request(app)
      .get('/api/me')
      .set('Cookie', aliceBffSessionCookie)
      .expect(401);

    expect(lastBackendHeaders.cookie).not.toBe('newsflow_session=backend-session-user-1');
  });

  test('removes stale session_users rows when expired sessions are cleaned', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);

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
  });

  test('sanitizes forwarded headers on public API routes', async () => {
    await request(app)
      .get('/api/public/ping')
      .set('X-Forwarded-For', '203.0.113.99')
      .set('X-Forwarded-Host', 'evil.example')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);

    expect(lastBackendHeaders['x-forwarded-for']).not.toContain('203.0.113.99');
    expect(lastBackendHeaders['x-forwarded-host']).not.toBe('evil.example');
    expect(lastBackendHeaders['x-forwarded-proto']).toBe('http');
  });

  test('streams multipart feedback through the authenticated app proxy', async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);
    const bffSessionCookie = loginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));

    const response = await request(app)
      .post('/api/me/feedback')
      .set('Cookie', bffSessionCookie)
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
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);
    const bffSessionCookie = loginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));

    const response = await request(app)
      .get('/socket.io/ping')
      .set('Cookie', bffSessionCookie)
      .expect(200);

    expect(response.body.path).toBe('/socket.io/ping');
    expect(lastBackendHeaders.cookie).toBe('newsflow_session=backend-session-user-1');
  });

  test('returns structured JSON when the app proxy fails upstream', async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);
    const bffSessionCookie = loginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));

    const response = await request(app)
      .get('/api/broken-stream')
      .set('Cookie', bffSessionCookie)
      .expect(502);

    expect(response.body.error).toEqual({
      message: 'Unable to reach the application backend.',
      code: 'BFF_UPSTREAM_ERROR',
    });
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
    expect(isValidSessionPayload({ version: 1, backendSessionCookie: 'newsflow_session=abc' })).toBe(true);
    expect(isValidSessionPayload({ version: 2, backendSessionCookie: 'newsflow_session=abc' })).toBe(false);
    expect(isValidSessionPayload({ version: 1, backendSessionCookie: '' })).toBe(false);
  });
});
