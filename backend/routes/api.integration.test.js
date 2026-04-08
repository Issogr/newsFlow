const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { getCanonicalSourceId } = require('../utils/sourceCatalog');

const ansaSourceId = getCanonicalSourceId('ansa_mondo', 'ANSA - Mondo');

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
  let userService;
  let feedbackService;

  beforeEach(() => {
    jest.resetModules();
    ({ tempDir, dbPath } = createTempDbPath());
    process.env.NEWS_DB_PATH = dbPath;

    jest.doMock('../services/newsAggregator', () => ({
      ingestAllNews: jest.fn().mockResolvedValue({ success: true }),
      refreshUserSources: jest.fn().mockResolvedValue({ success: true }),
      startScheduler: jest.fn(),
      stopScheduler: jest.fn()
    }));

    jest.doMock('../services/rssParser', () => ({
      validateFeedUrl: jest.fn()
    }));

    jest.doMock('../services/feedbackService', () => ({
      sendFeedback: jest.fn().mockResolvedValue({ messageId: 1 })
    }));

    app = buildApiTestApp();
    database = require('../services/database');
    newsService = require('../services/newsAggregator');
    rssParser = require('../services/rssParser');
    userService = require('../services/userService');
    feedbackService = require('../services/feedbackService');
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
      .send({ username: 'alice', password: 'secret123' })
      .expect(201);

    expect(registerResponse.body.user).toEqual({
      id: expect.any(String),
      username: 'alice',
      isAdmin: false
    });
    expect(registerResponse.body).toMatchObject({
      token: expect.any(String),
      settings: {
        defaultLanguage: 'auto',
        articleRetentionHours: 24,
        recentHours: 3,
        autoRefreshEnabled: true,
        showNewsImages: true,
        readerPanelPosition: 'right',
        readerTextSize: 'medium',
        lastSeenReleaseNotesVersion: '',
        excludedSourceIds: [],
        excludedSubSourceIds: []
      },
      limits: {
        articleRetentionHoursMax: 24,
        recentHoursMax: 3,
        feedbackTitleMaxLength: 120,
        feedbackDescriptionMaxLength: 2800,
        feedbackImageMaxBytes: 5242880,
        feedbackVideoMaxBytes: 12582912
      },
      customSources: []
    });

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);

    expect(loginResponse.body.token).toEqual(expect.any(String));
    expect(loginResponse.body.token).not.toBe(registerResponse.body.token);
  });

  test('bootstraps the admin account and allows creating password setup links', async () => {
    const bootstrap = userService.ensureAdminBootstrap();

    expect(bootstrap.required).toBe(true);
    expect(bootstrap.user).toMatchObject({ username: 'admin', isAdmin: true });

    const validateResponse = await request(app)
      .get('/api/auth/password-setup/validate')
      .query({ token: bootstrap.token })
      .expect(200);

    expect(validateResponse.body).toMatchObject({
      username: 'admin',
      isAdmin: true,
      purpose: 'admin-bootstrap'
    });

    const adminSetupResponse = await request(app)
      .post('/api/auth/password-setup/complete')
      .send({ token: bootstrap.token, password: 'secret123' })
      .expect(200);

    expect(adminSetupResponse.body.user).toMatchObject({
      username: 'admin',
      isAdmin: true
    });

    const memberResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'member-user', password: 'secret123' })
      .expect(201);

    const usersResponse = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminSetupResponse.body.token}`)
      .expect(200);

    expect(usersResponse.body.summary).toEqual(expect.objectContaining({
      totalUsers: 2,
      onlineUsers: expect.any(Number),
      activeUsers: 2,
      onlineWindowMinutes: expect.any(Number)
    }));
    expect(usersResponse.body.users).toEqual(expect.arrayContaining([
      expect.objectContaining({
        username: 'admin',
        isAdmin: true,
        passwordConfigured: true,
        lastLoginAt: expect.any(String),
        lastActivityAt: expect.any(String),
        isOnline: expect.any(Boolean)
      }),
      expect.objectContaining({
        username: 'member-user',
        isAdmin: false,
        passwordConfigured: true,
        lastLoginAt: expect.any(String),
        lastActivityAt: expect.any(String),
        isOnline: expect.any(Boolean)
      })
    ]));

    const passwordLinkResponse = await request(app)
      .post(`/api/admin/users/${memberResponse.body.user.id}/password-setup-link`)
      .set('Authorization', `Bearer ${adminSetupResponse.body.token}`)
      .expect(200);

    expect(passwordLinkResponse.body).toMatchObject({
      success: true,
      user: {
        id: memberResponse.body.user.id,
        username: 'member-user',
        isAdmin: false
      },
      setupLink: expect.stringContaining('/password/setup?token='),
      expiresAt: expect.any(String)
    });
  });

  test('rejects registration with a short password', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ username: 'short-pass-user', password: 'short' })
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: 'INVALID_PASSWORD',
      message: 'Password must contain at least 8 characters'
    });
  });

  test('rejects registration for the reserved admin username', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ username: 'admin', password: 'secret123' })
      .expect(403);

    expect(response.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'This username is reserved'
    });
  });

  test('completes a user password setup link generated by an admin', async () => {
    const bootstrap = userService.ensureAdminBootstrap();
    const adminSetupResponse = await request(app)
      .post('/api/auth/password-setup/complete')
      .send({ token: bootstrap.token, password: 'secret123' })
      .expect(200);

    const memberResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'legacy-member', password: 'secret123' })
      .expect(201);

    database.updateUserPassword(memberResponse.body.user.id, null, new Date().toISOString());

    const resetLinkResponse = await request(app)
      .post(`/api/admin/users/${memberResponse.body.user.id}/password-setup-link`)
      .set('Authorization', `Bearer ${adminSetupResponse.body.token}`)
      .expect(200);

    const resetToken = new URL(resetLinkResponse.body.setupLink).searchParams.get('token');

    const completeResetResponse = await request(app)
      .post('/api/auth/password-setup/complete')
      .send({ token: resetToken, password: 'renewed123' })
      .expect(200);

    expect(completeResetResponse.body.user).toMatchObject({
      id: memberResponse.body.user.id,
      username: 'legacy-member',
      isAdmin: false
    });

    await request(app)
      .post('/api/auth/login')
      .send({ username: 'legacy-member', password: 'renewed123' })
      .expect(200);

    await request(app)
      .post('/api/auth/password-setup/complete')
      .send({ token: resetToken, password: 'another123' })
      .expect(410);
  });

  test('updates settings and persists them for the authenticated user', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'settings-user', password: 'secret123' })
      .expect(201);

    const token = registerResponse.body.token;

    const updateResponse = await request(app)
      .patch('/api/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        defaultLanguage: 'en',
        themeMode: 'dark',
        articleRetentionHours: 999,
        recentHours: 999,
        autoRefreshEnabled: false,
        showNewsImages: false,
        readerPanelPosition: 'left',
        readerTextSize: 'large',
        lastSeenReleaseNotesVersion: '3.2.3',
        excludedSourceIds: [ansaSourceId],
        excludedSubSourceIds: ['ansa_mondo']
      })
      .expect(200);

    expect(updateResponse.body).toMatchObject({
      success: true,
      settings: {
        defaultLanguage: 'en',
        themeMode: 'dark',
        articleRetentionHours: 24,
        recentHours: 3,
        autoRefreshEnabled: false,
        showNewsImages: false,
        readerPanelPosition: 'left',
        readerTextSize: 'large',
        lastSeenReleaseNotesVersion: '3.2.3',
        excludedSourceIds: [ansaSourceId],
        excludedSubSourceIds: ['ansa_mondo']
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
      recentHoursMax: 3,
      feedbackTitleMaxLength: 120,
      feedbackDescriptionMaxLength: 2800,
      feedbackImageMaxBytes: 5242880,
      feedbackVideoMaxBytes: 12582912
    });
  });

  test('adds, updates, and removes a personal source after validation', async () => {
    rssParser.validateFeedUrl
      .mockResolvedValueOnce({ title: 'Example Feed', language: 'en', itemCount: 10 })
      .mockResolvedValueOnce({ title: 'Updated Feed', language: 'it', itemCount: 4 });

    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'source-user', password: 'secret123' })
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
    expect(newsService.refreshUserSources).toHaveBeenCalledTimes(2);
    expect(newsService.refreshUserSources).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({ sourceIds: [sourceId], broadcast: false }));
    expect(newsService.refreshUserSources).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ sourceIds: [sourceId], broadcast: false }));
  });

  test('submits authenticated feedback with an optional screenshot', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'feedback-user', password: 'secret123' })
      .expect(201);

    const imageBuffer = Buffer.from('fake-image-content');

    const response = await request(app)
      .post('/api/me/feedback')
      .set('Authorization', `Bearer ${registerResponse.body.token}`)
      .field('category', 'bug')
      .field('title', 'Reader overlap on mobile')
      .field('description', 'The reader panel overlaps the sticky header on a narrow mobile viewport.')
      .attach('attachment', imageBuffer, {
        filename: 'reader-mobile.png',
        contentType: 'image/png'
      })
      .expect(201);

    expect(response.body).toEqual({ success: true });
    expect(feedbackService.sendFeedback).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({
        id: registerResponse.body.user.id,
        username: 'feedback-user'
      }),
      category: 'bug',
      title: 'Reader overlap on mobile',
      description: 'The reader panel overlaps the sticky header on a narrow mobile viewport.',
      attachment: expect.objectContaining({
        originalname: 'reader-mobile.png',
        mimetype: 'image/png',
        size: imageBuffer.length
      })
    }));
  });

  test('submits authenticated feedback with a small video attachment', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'feedback-video-user', password: 'secret123' })
      .expect(201);

    const videoBuffer = Buffer.from('fake-video-content');

    const response = await request(app)
      .post('/api/me/feedback')
      .set('Authorization', `Bearer ${registerResponse.body.token}`)
      .field('category', 'feedback')
      .field('title', 'Animation feels abrupt')
      .field('description', 'Short clip showing the abrupt transition in the filter drawer.')
      .attach('attachment', videoBuffer, {
        filename: 'filters-transition.mp4',
        contentType: 'video/mp4'
      })
      .expect(201);

    expect(response.body).toEqual({ success: true });
    expect(feedbackService.sendFeedback).toHaveBeenLastCalledWith(expect.objectContaining({
      user: expect.objectContaining({
        id: registerResponse.body.user.id,
        username: 'feedback-video-user'
      }),
      category: 'feedback',
      title: 'Animation feels abrupt',
      description: 'Short clip showing the abrupt transition in the filter drawer.',
      attachment: expect.objectContaining({
        originalname: 'filters-transition.mp4',
        mimetype: 'video/mp4',
        size: videoBuffer.length
      })
    }));
  });

  test('rejects feedback submission with an invalid category', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'feedback-invalid', password: 'secret123' })
      .expect(201);

    const response = await request(app)
      .post('/api/me/feedback')
      .set('Authorization', `Bearer ${registerResponse.body.token}`)
      .field('category', 'question')
      .field('title', 'Bad category')
      .field('description', 'This should not be accepted.')
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: 'INVALID_FEEDBACK_PAYLOAD',
      message: 'Please choose a valid feedback category.'
    });
    expect(feedbackService.sendFeedback).not.toHaveBeenCalled();
  });

  test('imports settings atomically and refreshes only the current user sources', async () => {
    rssParser.validateFeedUrl
      .mockResolvedValueOnce({ title: 'Existing Feed', language: 'en', itemCount: 1 })
      .mockResolvedValueOnce({ title: 'Imported Feed', language: 'it', itemCount: 4 });

    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'import-user', password: 'secret123' })
      .expect(201);

    const token = registerResponse.body.token;

    await request(app)
      .post('/api/me/sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://example.com/existing.xml' })
      .expect(201);

    const importResponse = await request(app)
      .post('/api/me/settings/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        settings: {
          defaultLanguage: 'en',
          articleRetentionHours: 12,
          recentHours: 2,
          autoRefreshEnabled: false,
          showNewsImages: false,
          readerPanelPosition: 'center',
          readerTextSize: 'small',
          lastSeenReleaseNotesVersion: '3.2.3',
          excludedSourceIds: [ansaSourceId],
          excludedSubSourceIds: []
        },
        customSources: [
          {
            name: 'Imported Feed',
            url: 'https://example.com/imported.xml',
            language: 'it',
            isExcluded: true
          }
        ]
      })
      .expect(200);

    expect(importResponse.body).toMatchObject({
      success: true,
        settings: expect.objectContaining({
          defaultLanguage: 'en',
          articleRetentionHours: 12,
          recentHours: 2,
          autoRefreshEnabled: false,
          showNewsImages: false,
          readerPanelPosition: 'center',
          readerTextSize: 'small',
          lastSeenReleaseNotesVersion: '3.2.3',
          excludedSourceIds: expect.arrayContaining([ansaSourceId])
        }),
      customSources: [
        expect.objectContaining({
          name: 'Imported Feed',
          url: 'https://example.com/imported.xml',
          language: 'it'
        })
      ]
    });
    expect(newsService.refreshUserSources).toHaveBeenLastCalledWith(expect.any(String), { broadcast: false });
  });

  test('logs out the current session and rejects it afterward', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'logout-user', password: 'secret123' })
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
