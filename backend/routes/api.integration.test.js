const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

function createTempDbPath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-api-test-'));
  return {
    tempDir,
    dbPath: path.join(tempDir, 'news.db')
  };
}

function buildApiTestApp() {
  const express = require('express');
  const apiRoutes = require('./api');
  const { createError, errorMiddleware } = require('../utils/errorHandler');

  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
  app.use((req, res, next) => {
    next(createError(404, `Risorsa non trovata: ${req.originalUrl}`, 'RESOURCE_NOT_FOUND'));
  });
  app.use(errorMiddleware);
  return app;
}

describe('API auth and user flows', () => {
  let tempDir;
  let dbPath;
  let app;
  let database;
  let newsService;
  let rssParser;

  beforeEach(() => {
    jest.resetModules();
    ({ tempDir, dbPath } = createTempDbPath());
    process.env.NEWS_DB_PATH = dbPath;

    jest.doMock('../services/newsAggregator', () => ({
      ingestAllNews: jest.fn().mockResolvedValue({ success: true }),
      forceRefresh: jest.fn().mockResolvedValue({ success: true }),
      startScheduler: jest.fn(),
      stopScheduler: jest.fn()
    }));

    jest.doMock('../services/rssParser', () => ({
      validateFeedUrl: jest.fn()
    }));

    app = buildApiTestApp();
    database = require('../services/database');
    newsService = require('../services/newsAggregator');
    rssParser = require('../services/rssParser');
  });

  afterEach(() => {
    if (database?.closeDb) {
      database.closeDb();
    }

    delete process.env.NEWS_DB_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('registers and logs in a user with independent sessions', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'secret' })
      .expect(201);

    expect(registerResponse.body.user).toEqual({
      id: expect.any(String),
      username: 'alice'
    });
    expect(registerResponse.body).toMatchObject({
      token: expect.any(String),
      settings: {
        defaultLanguage: 'auto',
        articleRetentionHours: 24,
        recentHours: 3,
        hiddenSourceIds: []
      },
      limits: {
        articleRetentionHoursMax: 24,
        recentHoursMax: 3
      },
      customSources: []
    });

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret' })
      .expect(200);

    expect(loginResponse.body.token).toEqual(expect.any(String));
    expect(loginResponse.body.token).not.toBe(registerResponse.body.token);
  });

  test('updates settings and persists them for the authenticated user', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'settings-user', password: 'secret' })
      .expect(201);

    const token = registerResponse.body.token;

    const updateResponse = await request(app)
      .patch('/api/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        defaultLanguage: 'en',
        articleRetentionHours: 999,
        recentHours: 999,
        hiddenSourceIds: ['ansa']
      })
      .expect(200);

    expect(updateResponse.body).toMatchObject({
      success: true,
      settings: {
        defaultLanguage: 'en',
        articleRetentionHours: 24,
        recentHours: 3,
        hiddenSourceIds: ['ansa']
      }
    });
    expect(updateResponse.body.settings).toMatchObject({
      userId: expect.any(String),
      updatedAt: expect.any(String)
    });

    const currentUserResponse = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(currentUserResponse.body.settings).toEqual(updateResponse.body.settings);
    expect(currentUserResponse.body.limits).toEqual({
      articleRetentionHoursMax: 24,
      recentHoursMax: 3
    });
  });

  test('adds, updates, and removes a personal source after validation', async () => {
    rssParser.validateFeedUrl
      .mockResolvedValueOnce({ title: 'Example Feed', language: 'en', itemCount: 10 })
      .mockResolvedValueOnce({ title: 'Updated Feed', language: 'it', itemCount: 4 });

    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'source-user', password: 'secret' })
      .expect(201);

    const token = registerResponse.body.token;

    const addResponse = await request(app)
      .post('/api/me/sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://example.com/feed.xml' })
      .expect(201);

    expect(addResponse.body).toMatchObject({
      success: true,
      source: {
        id: expect.any(String),
        name: 'Example Feed',
        url: 'https://example.com/feed.xml',
        language: 'en'
      }
    });

    const sourceId = addResponse.body.source.id;

    const updateResponse = await request(app)
      .patch(`/api/me/sources/${sourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://example.com/updated.xml' })
      .expect(200);

    expect(updateResponse.body).toMatchObject({
      success: true,
      source: {
        id: sourceId,
        name: 'Updated Feed',
        url: 'https://example.com/updated.xml',
        language: 'it'
      }
    });

    await request(app)
      .delete(`/api/me/sources/${sourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { success: true });

    const currentUserResponse = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(currentUserResponse.body.customSources).toEqual([]);
    expect(rssParser.validateFeedUrl).toHaveBeenCalledTimes(2);
    expect(newsService.ingestAllNews).toHaveBeenCalledTimes(2);
  });

  test('logs out the current session and rejects it afterward', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'logout-user', password: 'secret' })
      .expect(201);

    const token = registerResponse.body.token;

    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { success: true });

    const meResponse = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(meResponse.body.error.code).toBe('UNAUTHORIZED');
  });
});
