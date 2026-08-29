import fs = require('node:fs');
import http = require('node:http');
import path = require('node:path');
import type { Application } from 'express';
import type { Socket } from 'socket.io-client';
import type { Response as SupertestResponse } from 'supertest';

const request = require('supertest') as typeof import('supertest');
const { cleanupTempNewsDb, setupTempNewsDb } = require('./test-utils/tempNewsDb');

const originalEnvironment = {
  APP_BASE_URL: process.env.APP_BASE_URL,
  COOKIE_SECURE: process.env.COOKIE_SECURE,
  NODE_ENV: process.env.NODE_ENV,
  PUBLIC_API_ANONYMOUS_ENABLED: process.env.PUBLIC_API_ANONYMOUS_ENABLED,
  TRUST_PROXY: process.env.TRUST_PROXY,
};

function getSessionCookie(response: SupertestResponse): string {
  const cookies = response.headers['set-cookie'] as string[] | undefined;
  return cookies?.find((value) => value.startsWith('newsflow_session=')) || '';
}

function getCookiePair(response: SupertestResponse): string {
  return getSessionCookie(response).split(';')[0];
}

describe('browser application boundary', () => {
  let app: Application;
  let database: ReturnType<typeof require>;
  let tempDir: string;

  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.APP_BASE_URL = 'http://localhost';
    process.env.COOKIE_SECURE = 'auto';
    process.env.PUBLIC_API_ANONYMOUS_ENABLED = 'true';
    process.env.TRUST_PROXY = 'false';
    ({ tempDir } = setupTempNewsDb('news-app-test-'));

    const frontendDir = path.join(tempDir, 'frontend');
    fs.mkdirSync(path.join(frontendDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(frontendDir, 'index.html'), '<!doctype html><title>News Flow</title><main>application shell</main>');
    fs.writeFileSync(path.join(frontendDir, 'assets', 'app.js'), 'globalThis.newsFlow = true;');

    jest.doMock('./services/newsAggregator', () => ({
      getCachedNewsFeed: jest.fn().mockResolvedValue({ items: [], meta: {}, filters: {} }),
      refreshUserSources: jest.fn().mockResolvedValue({ success: true }),
    }));
    jest.doMock('./services/feedbackService', () => ({ isFeedbackConfigured: jest.fn(() => false) }));

    app = require('./app').createApp({ frontendDistDir: frontendDir });
    database = require('./services/database');
  });

  afterEach(() => {
    cleanupTempNewsDb({ tempDir }, database);
    jest.clearAllMocks();
  });

  afterAll(() => {
    Object.entries(originalEnvironment).forEach(([name, value]) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  });

  test('serves the SPA, docs, security headers, and cache policies without shadowing APIs', async () => {
    await request(app).get('/api').expect(302).expect('Location', '/api/docs');

    const docs = await request(app).get('/api/docs').expect(200);
    expect(docs.text).toContain('application shell');
    expect(docs.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
    expect(docs.headers['content-security-policy']).toContain("media-src 'self' blob:");

    await request(app)
      .get('/assets/app.js')
      .expect(200)
      .expect('Cache-Control', 'public, max-age=2592000, immutable');
    await request(app).get('/privacy-policy').expect(200).expect(/application shell/);

    const unknownApi = await request(app).get('/api/not-a-route').expect(401);
    expect(unknownApi.type).toMatch(/json/u);
  });

  test.each([
    ['/api/auth/register', { username: 'missing-origin', password: 'secret123' }],
    ['/api/auth/login', { username: 'missing-origin', password: 'secret123' }],
    ['/api/auth/password-setup/complete', { token: 'missing-origin', password: 'secret123' }],
  ])('requires same-origin headers for session creation at %s', async (routePath, body) => {
    await request(app).post(routePath).send(body).expect(403);
    await request(app).post(routePath).set('Origin', 'https://evil.example').send(body).expect(403);
  });

  test('uses direct session cookies and rejects cross-origin private requests', async () => {
    const registration = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'http://localhost')
      .send({ username: 'alice', password: 'secret123' })
      .expect(201);
    const cookie = getCookiePair(registration);

    expect(getSessionCookie(registration)).toEqual(expect.stringContaining('HttpOnly'));
    expect(getSessionCookie(registration)).toEqual(expect.stringContaining('SameSite=Strict'));
    expect(getSessionCookie(registration)).toEqual(expect.stringContaining('Path=/'));
    expect(registration.body).not.toHaveProperty('token');

    const currentUser = await request(app).get('/api/me').set('Cookie', cookie).expect(200);
    expect(currentUser.body.user.username).toBe('alice');
    expect(currentUser.headers).not.toHaveProperty('access-control-allow-origin');

    await request(app)
      .get('/api/me')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(app)
      .patch('/api/me/settings')
      .set('Cookie', cookie)
      .send({ themeMode: 'dark' })
      .expect(403);
  });

  test('emits a secure session cookie behind the trusted HTTPS proxy', async () => {
    process.env.APP_BASE_URL = 'https://news.example';
    process.env.TRUST_PROXY = '1';
    const secureApp = require('./app').createApp({ frontendDistDir: path.join(tempDir, 'frontend') });

    const response = await request(secureApp)
      .post('/api/auth/register')
      .set('Origin', 'https://news.example')
      .set('X-Forwarded-Proto', 'https')
      .send({ username: 'secure-cookie-user', password: 'secret123' })
      .expect(201);

    expect(getSessionCookie(response)).toEqual(expect.stringContaining('Secure'));
  });

  test('returns structured malformed JSON errors and keeps logout idempotent', async () => {
    const malformed = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'http://localhost')
      .expect(200);
    expect(logout.body).toEqual({ success: true });
    expect(getSessionCookie(logout)).toContain('newsflow_session=;');
  });

  test('clears rejected cookies and rotates a presented session after login', async () => {
    const registration = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'http://localhost')
      .send({ username: 'rotation-user', password: 'secret123' })
      .expect(201);
    const oldCookie = getCookiePair(registration);

    const login = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost')
      .set('Cookie', oldCookie)
      .send({ username: 'rotation-user', password: 'secret123' })
      .expect(200);
    const newCookie = getCookiePair(login);

    expect(newCookie).not.toBe(oldCookie);
    const rejected = await request(app).get('/api/me').set('Cookie', oldCookie).expect(401);
    expect(getSessionCookie(rejected)).toContain('newsflow_session=;');
    await request(app).get('/api/me').set('Cookie', newCookie).expect(200);
  });

  test('renews the browser cookie with the persisted session expiry', async () => {
    const registration = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'http://localhost')
      .send({ username: 'renewal-user', password: 'secret123' })
      .expect(201);
    const cookie = getCookiePair(registration);
    const token = cookie.slice(cookie.indexOf('=') + 1);
    const { hashSessionToken } = require('./utils/auth');

    database.refreshSessionExpiry(
      hashSessionToken(token),
      new Date(Date.now() + (12 * 60 * 60 * 1000)).toISOString(),
    );

    const response = await request(app).get('/api/me').set('Cookie', cookie).expect(200);
    expect(getSessionCookie(response)).toContain('newsflow_session=');
    expect(Date.parse(database.findSessionByTokenHash(hashSessionToken(token)).expiresAt))
      .toBeGreaterThan(Date.now() + (29 * 24 * 60 * 60 * 1000));
  });

  test('keeps the public API session-free with explicit CORS', async () => {
    const response = await request(app)
      .get('/api/public/news')
      .set('Origin', 'http://localhost')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost');
    expect(getSessionCookie(response)).toBe('');
    expect(response.body.access).toEqual({ mode: 'anonymous', cachedOnly: true });
  });

  test('keeps liveness available when database readiness fails', async () => {
    const writeCheck = jest.spyOn(database, 'verifyWriteAccess').mockImplementation(() => {
      throw new Error('database unavailable');
    });

    await request(app).get('/health').expect(200, { status: 'ok' });
    await request(app).get('/ready').expect(503, { status: 'unavailable' });
    writeCheck.mockRestore();
  });

  test('authenticates direct same-origin Socket.IO polling and WebSocket connections', async () => {
    const server = http.createServer(app);
    const io = require('./services/websocketService').initialize(server);
    let websocketClient: Socket | null = null;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a listening HTTP server.');
    }

    try {
      const registration = await fetch(`http://127.0.0.1:${address.port}/api/auth/register`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({ username: 'socket-user', password: 'secret123' }),
      });
      const cookie = registration.headers.getSetCookie()[0]?.split(';')[0];
      expect(registration.status).toBe(201);
      expect(cookie).toContain('newsflow_session=');
      if (!cookie) {
        throw new Error('Expected a session cookie.');
      }

      const openResponse = await fetch(`http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling`, {
        headers: { cookie, origin: 'http://localhost' },
      });
      const openPacket = await openResponse.text();
      expect(openResponse.status).toBe(200);
      expect(openPacket).toMatch(/^0\{/u);
      const sid = JSON.parse(openPacket.slice(1)).sid;

      const connectResponse = await fetch(`http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8', cookie, origin: 'http://localhost' },
        body: '40',
      });
      expect(connectResponse.status).toBe(200);

      const connected = await fetch(`http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
        headers: { cookie, origin: 'http://localhost' },
      });
      expect(await connected.text()).toContain('40');

      const anonymousOpen = await fetch(`http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling`, {
        headers: { origin: 'http://localhost' },
      });
      const anonymousPacket = await anonymousOpen.text();
      const anonymousSid = JSON.parse(anonymousPacket.slice(1)).sid;
      await fetch(`http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling&sid=${anonymousSid}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8', origin: 'http://localhost' },
        body: '40',
      });
      const rejectedAuth = await fetch(`http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling&sid=${anonymousSid}`, {
        headers: { origin: 'http://localhost' },
      });
      expect(await rejectedAuth.text()).toContain('WebSocket auth failed');

      const { io: createSocketClient } = require('socket.io-client');
      websocketClient = createSocketClient(`http://127.0.0.1:${address.port}`, {
        autoConnect: false,
        extraHeaders: {
          Cookie: cookie,
          Origin: 'http://localhost',
        },
        reconnection: false,
        transports: ['websocket'],
      });
      await new Promise<void>((resolve, reject) => {
        websocketClient?.once('connect', resolve);
        websocketClient?.once('connect_error', reject);
        websocketClient?.connect();
      });
      expect(websocketClient.io.engine.transport.name).toBe('websocket');

      const rejected = await fetch(`http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling`, {
        headers: { cookie, origin: 'https://evil.example' },
      });
      expect(rejected.status).toBe(403);
    } finally {
      websocketClient?.disconnect();
      await new Promise<void>((resolve) => io.close(resolve));
    }
  });
});
