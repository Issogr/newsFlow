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
  const publicApiRoutes = require('./publicApi');
  const { createError, errorMiddleware } = require('../utils/errorHandler');

  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
   app.use('/internal-api', apiRoutes);
   app.use('/api/public', publicApiRoutes);
  app.use((req, res, next) => {
    next(createError(404, `Resource not found: ${req.originalUrl}`, 'RESOURCE_NOT_FOUND'));
  });
  app.use(errorMiddleware);
  return app;
}

function getSessionCookie(response) {
  return response.headers['set-cookie']?.find((value) => value.startsWith('newsflow_session=')) || '';
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
      getCachedNewsFeed: jest.fn().mockResolvedValue({ items: [], meta: {}, filters: {} }),
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
      settings: {
        defaultLanguage: 'auto',
        articleRetentionHours: 24,
        recentHours: 3,
        autoRefreshEnabled: true,
        showNewsImages: true,
        compactNewsCards: false,
        compactNewsCardsMode: 'off',
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
        feedbackVideoMaxBytes: 12582912,
        apiTokenTtlDays: 30
      },
      customSources: []
    });
    expect(registerResponse.body.token).toBeUndefined();
    expect(getSessionCookie(registerResponse)).toContain('newsflow_session=');

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'secret123' })
      .expect(200);

    expect(loginResponse.body.token).toBeUndefined();
    expect(getSessionCookie(loginResponse)).toContain('newsflow_session=');
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
    const adminSessionCookie = getSessionCookie(adminSetupResponse);

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
      .set('Cookie', adminSessionCookie)
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
      .set('Cookie', adminSessionCookie)
      .expect(200);

    expect(passwordLinkResponse.body).toMatchObject({
      success: true,
      user: {
        id: memberResponse.body.user.id,
        username: 'member-user',
        isAdmin: false
      },
      setupLink: expect.stringContaining('/password/setup#token='),
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
    const adminSessionCookie = getSessionCookie(adminSetupResponse);

    const memberResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'legacy-member', password: 'secret123' })
      .expect(201);

    database.updateUserPassword(memberResponse.body.user.id, null, new Date().toISOString());

    const resetLinkResponse = await request(app)
      .post(`/api/admin/users/${memberResponse.body.user.id}/password-setup-link`)
      .set('Cookie', adminSessionCookie)
      .expect(200);

    const resetToken = new URL(resetLinkResponse.body.setupLink).hash.replace(/^#/, '').replace(/^token=/, '');

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

  test('allows an admin to delete a non-admin user', async () => {
    const bootstrap = userService.ensureAdminBootstrap();
    const adminSetupResponse = await request(app)
      .post('/api/auth/password-setup/complete')
      .send({ token: bootstrap.token, password: 'secret123' })
      .expect(200);
    const adminSessionCookie = getSessionCookie(adminSetupResponse);

    const memberResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'delete-me', password: 'secret123' })
      .expect(201);

    const deleteResponse = await request(app)
      .delete(`/api/admin/users/${memberResponse.body.user.id}`)
      .set('Cookie', adminSessionCookie)
      .expect(200);

    expect(deleteResponse.body).toMatchObject({
      success: true,
      user: {
        id: memberResponse.body.user.id,
        username: 'delete-me',
        isAdmin: false
      }
    });

    const usersResponse = await request(app)
      .get('/api/admin/users')
      .set('Cookie', adminSessionCookie)
      .expect(200);

    expect(usersResponse.body.users).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ username: 'delete-me' })
    ]));

    await request(app)
      .post('/api/auth/login')
      .send({ username: 'delete-me', password: 'secret123' })
      .expect(401);
  });

  test('updates settings and persists them for the authenticated user', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'settings-user', password: 'secret123' })
      .expect(201);

    const sessionCookie = getSessionCookie(registerResponse);

    const updateResponse = await request(app)
      .patch('/api/me/settings')
      .set('Cookie', sessionCookie)
      .send({
        defaultLanguage: 'en',
        themeMode: 'dark',
        articleRetentionHours: 999,
        recentHours: 999,
        autoRefreshEnabled: false,
        showNewsImages: false,
        compactNewsCardsMode: 'desktop',
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
        compactNewsCards: true,
        compactNewsCardsMode: 'desktop',
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
      .set('Cookie', sessionCookie)
      .expect(200);

    expect(currentUserResponse.body.settings).toEqual(updateResponse.body.settings);
    expect(currentUserResponse.body.limits).toEqual({
      articleRetentionHoursMax: 24,
      recentHoursMax: 3,
      feedbackTitleMaxLength: 120,
      feedbackDescriptionMaxLength: 2800,
      feedbackImageMaxBytes: 5242880,
      feedbackVideoMaxBytes: 12582912,
      apiTokenTtlDays: 30
    });
  });

  test('serves public cached news anonymously without user context', async () => {
    newsService.getCachedNewsFeed.mockResolvedValueOnce({
      items: [],
      meta: { hasMore: false },
      filters: { sources: [], topics: [] }
    });

    const response = await request(app)
      .get('/api/public/news')
      .expect(200);

    expect(newsService.getCachedNewsFeed).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      userId: null,
      excludedSourceIds: [],
      excludedSubSourceIds: []
    }));
    expect(response.body.access).toEqual({
      mode: 'anonymous',
      cachedOnly: true
    });
  });

  test('serves public cached news with user-scoped context for valid API tokens', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'api-user', password: 'secret123' })
      .expect(201);

    const tokenResult = userService.createUserApiToken(registerResponse.body.user.id);
    newsService.getCachedNewsFeed.mockResolvedValueOnce({
      items: [],
      meta: { hasMore: false },
      filters: { sources: [], topics: [] }
    });

    const response = await request(app)
      .get('/api/public/news')
      .set('Authorization', `Bearer ${tokenResult.token}`)
      .expect(200);

    expect(newsService.getCachedNewsFeed).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      userId: registerResponse.body.user.id,
      excludedSourceIds: [],
      excludedSubSourceIds: []
    }));
    expect(response.body.access).toEqual({
      mode: 'token',
      cachedOnly: true
    });

    const usageRow = database.getDb().prepare(`
      SELECT public_api_request_count AS publicApiRequestCount,
             public_api_last_used_at AS publicApiLastUsedAt
      FROM users
      WHERE id = ?
    `).get(registerResponse.body.user.id);

    expect(usageRow.publicApiRequestCount).toBe(1);
    expect(usageRow.publicApiLastUsedAt).toEqual(expect.any(String));

    const tokenRow = database.getDb().prepare(`
      SELECT created_by_ip AS createdByIp,
             last_used_ip AS lastUsedIp,
             last_used_at AS lastUsedAt
      FROM api_tokens
      WHERE user_id = ?
    `).get(registerResponse.body.user.id);

    expect(tokenRow.createdByIp).toBeNull();
    expect(tokenRow.lastUsedIp).toBeNull();
    expect(tokenRow.lastUsedAt).toEqual(expect.any(String));
  });

  test('counts anonymous public API requests globally', async () => {
    await request(app)
      .get('/api/public/news')
      .expect(200);

    await request(app)
      .get('/api/public/news')
      .expect(200);

    const count = database.getDb().prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'anonymous_public_api_request_count'
    `).get()?.value;

    expect(Number(count)).toBe(2);
  });

  test('revokes api tokens immediately and records revocation in the database', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'revoke-user', password: 'secret123' })
      .expect(201);

    const sessionCookie = getSessionCookie(registerResponse);

    const createResponse = await request(app)
      .post('/api/me/api-token')
      .set('Cookie', sessionCookie)
      .send({})
      .expect(201);

    const apiToken = createResponse.body.token;
    const userId = registerResponse.body.user.id;

    expect(database.getDb().prepare('SELECT COUNT(*) AS count FROM api_tokens WHERE user_id = ?').get(userId).count).toBe(1);

    await request(app)
      .delete('/api/me/api-token')
      .set('Cookie', sessionCookie)
      .expect(200);

    await request(app)
      .get('/api/public/news')
      .set('Authorization', `Bearer ${apiToken}`)
      .expect(401);

    const revokedRow = database.getDb().prepare('SELECT revoked_at AS revokedAt FROM api_tokens WHERE user_id = ?').get(userId);
    expect(revokedRow.revokedAt).toEqual(expect.any(String));
  });

  test('regenerates api tokens immediately and revokes the previous token row', async () => {
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'regen-user', password: 'secret123' })
      .expect(201);

    const sessionCookie = getSessionCookie(registerResponse);
    const userId = registerResponse.body.user.id;

    const firstTokenResponse = await request(app)
      .post('/api/me/api-token')
      .set('Cookie', sessionCookie)
      .send({})
      .expect(201);

    const firstToken = firstTokenResponse.body.token;

    const secondTokenResponse = await request(app)
      .post('/api/me/api-token')
      .set('Cookie', sessionCookie)
      .send({})
      .expect(201);

    const secondToken = secondTokenResponse.body.token;

    expect(secondToken).not.toBe(firstToken);

    await request(app)
      .get('/api/public/news')
      .set('Authorization', `Bearer ${firstToken}`)
      .expect(401);

    await request(app)
      .get('/api/public/news')
      .set('Authorization', `Bearer ${secondToken}`)
      .expect(200);

    const tokenRows = database.getDb().prepare(`
      SELECT token_prefix AS tokenPrefix, revoked_at AS revokedAt
      FROM api_tokens
      WHERE user_id = ?
      ORDER BY datetime(created_at) ASC
    `).all(userId);

    expect(tokenRows).toHaveLength(2);
    expect(tokenRows[0].tokenPrefix).toBe(firstToken.slice(0, 12));
    expect(tokenRows[0].revokedAt).toEqual(expect.any(String));
    expect(tokenRows[1].tokenPrefix).toBe(secondToken.slice(0, 12));
    expect(tokenRows[1].revokedAt).toBeNull();
  });

  test('adds, updates, and removes a personal source after validation', async () => {
    rssParser.validateFeedUrl
      .mockResolvedValueOnce({ title: 'Example Feed', language: 'en', itemCount: 10 })
      .mockResolvedValueOnce({ title: 'Updated Feed', language: 'it', itemCount: 4 });

    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username: 'source-user', password: 'secret123' })
      .expect(201);

    const sessionCookie = getSessionCookie(registerResponse);

    const addResponse = await request(app)
      .post('/api/me/sources')
      .set('Cookie', sessionCookie)
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
      .set('Cookie', sessionCookie)
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
      .set('Cookie', sessionCookie)
      .expect(200, { success: true });

    const currentUserResponse = await request(app)
      .get('/api/me')
      .set('Cookie', sessionCookie)
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
      .set('Cookie', getSessionCookie(registerResponse))
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
      .set('Cookie', getSessionCookie(registerResponse))
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
      .set('Cookie', getSessionCookie(registerResponse))
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

    const sessionCookie = getSessionCookie(registerResponse);

    await request(app)
      .post('/api/me/sources')
      .set('Cookie', sessionCookie)
      .send({ url: 'https://example.com/existing.xml' })
      .expect(201);

    const importResponse = await request(app)
      .post('/api/me/settings/import')
      .set('Cookie', sessionCookie)
      .send({
        settings: {
          defaultLanguage: 'en',
          articleRetentionHours: 12,
          recentHours: 2,
          autoRefreshEnabled: false,
          showNewsImages: false,
          compactNewsCards: true,
          compactNewsCardsMode: 'desktop',
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
          compactNewsCards: true,
          compactNewsCardsMode: 'desktop',
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

    const sessionCookie = getSessionCookie(registerResponse);

    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', sessionCookie)
      .expect(200, { success: true });

    const meResponse = await request(app)
      .get('/api/me')
      .set('Cookie', sessionCookie)
      .expect(401);

    expect(meResponse.body.error.code).toBe('UNAUTHORIZED');
  });
});
