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

  beforeEach(async () => {
    frontendDistDir = createFrontendDist();
    ({ tempDir: sessionDir, sessionDbPath } = createSessionDbPath());
    lastBackendHeaders = {};
    let backendSessionActive = true;

    process.env.BFF_SESSION_SECRET = 'test-bff-secret';
    process.env.INTERNAL_PROXY_TOKEN = 'test-proxy-token';
    process.env.INTERNAL_SERVICE_NAME = 'bff';
    process.env.SESSION_STORE_CLEAR_INTERVAL_MS = '0';

    const backendApp = express();
    backendApp.use(express.json());

    backendApp.post('/internal-api/auth/login', (req, res) => {
      lastBackendHeaders = req.headers;
      backendSessionActive = true;
      res.cookie('newsflow_session', 'backend-session-1', {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      });
      res.json({ user: { username: 'alice' } });
    });

    backendApp.post('/internal-api/auth/logout', (req, res) => {
      lastBackendHeaders = req.headers;
      backendSessionActive = false;
      res.json({ success: true });
    });

    backendApp.get('/internal-api/me', (req, res) => {
      lastBackendHeaders = req.headers;

      if (!backendSessionActive || req.headers.cookie !== 'newsflow_session=backend-session-1') {
        res.status(401).json({ error: { message: 'Authentication required', code: 'UNAUTHORIZED' } });
        return;
      }

      res.json({ user: { username: 'alice' } });
    });

    backendApp.get('/api/public/ping', (req, res) => {
      res.json({ ok: true });
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
    expect(bffSessionCookie).not.toContain('backend-session-1');
    expect(lastBackendHeaders['x-newsflow-service']).toBe('bff');
    expect(lastBackendHeaders['x-newsflow-proxy']).toBe('test-proxy-token');

    const meResponse = await request(app)
      .get('/api/me')
      .set('Cookie', bffSessionCookie)
      .expect(200);

    expect(meResponse.body).toEqual({ user: { username: 'alice' } });
    expect(lastBackendHeaders.cookie).toBe('newsflow_session=backend-session-1');
    expect(meResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='))).toContain('Expires=');
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
    expect(meResponse.body).toEqual({ user: { username: 'alice' } });
    expect(lastBackendHeaders.cookie).toBe('newsflow_session=backend-session-1');
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

  test('proxies public API routes without requiring a BFF session', async () => {
    const response = await request(app)
      .get('/api/public/ping')
      .expect(200);

    expect(response.body).toEqual({ ok: true });
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
