const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { createApp } = require('./server');

function createFrontendDist() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newsflow-bff-frontend-'));
  fs.writeFileSync(path.join(tempDir, 'index.html'), '<!doctype html><html><body>News Flow</body></html>');
  return tempDir;
}

describe('bff server', () => {
  let backendServer;
  let backendBaseUrl;
  let frontendDistDir;
  let app;
  let lastBackendHeaders;

  beforeEach(async () => {
    frontendDistDir = createFrontendDist();
    lastBackendHeaders = {};
    let backendSessionActive = true;

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
    app = createApp({ backendBaseUrl, frontendDistDir }).app;
  });

  afterEach(async () => {
    await new Promise((resolve) => {
      backendServer.close(resolve);
    });

    fs.rmSync(frontendDistDir, { recursive: true, force: true });
  });

  test('creates an encrypted BFF session on login and uses it for proxied app requests', async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);

    const bffSessionCookie = loginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));

    expect(bffSessionCookie).toContain('newsflow_bff_session=');
    expect(bffSessionCookie).not.toContain('newsflow_session=');
    expect(bffSessionCookie).not.toContain('backend-session-1');
    expect(lastBackendHeaders['x-newsflow-service']).toBe('bff');
    expect(lastBackendHeaders['x-newsflow-proxy']).toBeTruthy();

    const meResponse = await request(app)
      .get('/api/me')
      .set('Cookie', bffSessionCookie)
      .expect(200);

    expect(meResponse.body).toEqual({ user: { username: 'alice' } });
    expect(lastBackendHeaders.cookie).toBe('newsflow_session=backend-session-1');
    expect(meResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='))).toContain('Max-Age=2592000');
  });

  test('keeps the session valid after recreating the BFF app instance', async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);

    const bffSessionCookie = loginResponse.headers['set-cookie']?.find((value) => value.startsWith('newsflow_bff_session='));
    const restartedApp = createApp({ backendBaseUrl, frontendDistDir }).app;

    const meResponse = await request(restartedApp)
      .get('/api/me')
      .set('Cookie', bffSessionCookie)
      .expect(200);

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
});
