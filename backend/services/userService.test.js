const { cleanupTempNewsDb, setupTempNewsDb } = require('../test-utils/tempNewsDb');

describe('userService imports', () => {
  let tempDir;
  let userService;
  let database;
  let rssParser;

  beforeEach(() => {
    jest.resetModules();
    ({ tempDir } = setupTempNewsDb('news-user-service-test-'));

    jest.doMock('./rssParser', () => ({
      validateFeedUrl: jest.fn()
    }));

    userService = require('./userService');
    database = require('./database');
    rssParser = require('./rssParser');
  });

  afterEach(() => {
    cleanupTempNewsDb({ tempDir }, database);
    jest.clearAllMocks();
  });

  test('imports settings for a user and returns the recreated sources', async () => {
    const authPayload = await userService.registerUser({ username: 'alice', password: 'secret123' });
    const userId = authPayload.user.id;

    rssParser.validateFeedUrl.mockResolvedValue({ title: 'Imported Feed', language: 'it', itemCount: 4 });
    const result = await userService.importUserSettings(userId, {
      settings: {
        defaultLanguage: 'it',
        themeMode: 'dark',
        articleRetentionHours: 12,
        recentHours: 2,
        showNewsImages: false,
        compactNewsCards: true,
        compactNewsCardsMode: 'everywhere',
        readerPanelPosition: 'left',
        readerTextSize: 'large',
        lastSeenReleaseNotesVersion: '3.2.3',
        excludedSourceIds: ['bbc'],
        excludedSubSourceIds: []
      },
      customSources: [
        {
          name: 'Imported Feed',
          url: 'https://example.com/imported.xml',
          language: 'it'
        }
      ]
    });

    expect(result).toMatchObject({
      settings: expect.objectContaining({
        defaultLanguage: 'it',
        themeMode: 'dark',
        showNewsImages: false,
        compactNewsCards: true,
        compactNewsCardsMode: 'everywhere',
        readerPanelPosition: 'left',
        readerTextSize: 'large',
        lastSeenReleaseNotesVersion: '3.2.3',
        excludedSourceIds: []
      }),
      customSources: [
        expect.objectContaining({
          userId,
          name: 'Imported Feed',
          url: 'https://example.com/imported.xml',
          language: 'it'
        })
      ]
    });
    expect(result.settings).not.toHaveProperty('articleRetentionHours');
    expect(result.settings).not.toHaveProperty('recentHours');
    expect(database.getUserSettings(userId)).toMatchObject({
      defaultLanguage: 'it',
      themeMode: 'dark',
      showNewsImages: false,
      readerPanelPosition: 'left',
      readerTextSize: 'large',
      lastSeenReleaseNotesVersion: '3.2.3',
      excludedSourceIds: []
    });
    expect(database.getUserSettings(userId)).not.toHaveProperty('articleRetentionHours');
    expect(database.getUserSettings(userId)).not.toHaveProperty('recentHours');
  });

  test('exported settings preserve showNewsImages across import', async () => {
    const sourceAuthPayload = await userService.registerUser({ username: 'source-user', password: 'secret123' });
    const targetAuthPayload = await userService.registerUser({ username: 'target-user', password: 'secret123' });

    userService.updateUserSettings(sourceAuthPayload.user.id, {
      themeMode: 'dark',
      showNewsImages: false,
      compactNewsCards: true,
      compactNewsCardsMode: 'desktop',
      readerTextSize: 'small'
    });

    const exportedSettings = userService.exportUserSettings(sourceAuthPayload.user.id);

    expect(exportedSettings.settings).toMatchObject({
      themeMode: 'dark',
      showNewsImages: false,
      compactNewsCards: true,
      compactNewsCardsMode: 'desktop',
      readerTextSize: 'small'
    });
    expect(exportedSettings.settings).not.toHaveProperty('articleRetentionHours');
    expect(exportedSettings.settings).not.toHaveProperty('recentHours');

    const importedState = await userService.importUserSettings(targetAuthPayload.user.id, exportedSettings);

    expect(importedState.settings).toMatchObject({
      themeMode: 'dark',
      showNewsImages: false,
      readerTextSize: 'small'
    });
    expect(database.getUserSettings(targetAuthPayload.user.id)).toMatchObject({
      themeMode: 'dark',
      showNewsImages: false,
      compactNewsCards: true,
      compactNewsCardsMode: 'desktop',
      readerTextSize: 'small'
    });
  });

  test('requires a password during registration', async () => {
    await expect(userService.registerUser({ username: 'bob', password: '' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PASSWORD'
    });
  });

  test('marks newly registered users for one-time source setup', async () => {
    const authPayload = await userService.registerUser({ username: 'setup-user', password: 'secret123' });

    expect(authPayload.settings).toMatchObject({
      sourceSetupCompleted: false,
      excludedSourceIds: [],
      excludedSubSourceIds: []
    });
    expect(authPayload.sourceCatalog.length).toBeGreaterThan(0);

    const updated = userService.updateUserSettings(authPayload.user.id, {
      sourceSetupCompleted: true,
      excludedSourceIds: [authPayload.sourceCatalog[0].id]
    });

    expect(updated).toMatchObject({
      sourceSetupCompleted: true,
      excludedSourceIds: [authPayload.sourceCatalog[0].id]
    });
  });

  test('removes a deleted custom source from persisted exclusions', async () => {
    const authPayload = await userService.registerUser({ username: 'source-owner', password: 'secret123' });
    const sourceId = 'custom-source-1';
    const now = new Date().toISOString();
    database.createUserSource({
      id: sourceId,
      userId: authPayload.user.id,
      name: 'Custom feed',
      url: 'https://example.com/feed.xml',
      language: 'en',
      isActive: true,
      createdAt: now,
      updatedAt: now
    });
    userService.updateUserSettings(authPayload.user.id, { excludedSourceIds: [sourceId] });

    userService.removeUserSource(authPayload.user.id, sourceId);

    expect(database.getUserSettings(authPayload.user.id).excludedSourceIds).toEqual([]);
  });

  test('requires a minimum password length during registration', async () => {
    await expect(userService.registerUser({ username: 'carol', password: 'short' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PASSWORD'
    });
  });

  test('rejects case-insensitive duplicate usernames during registration', async () => {
    await userService.registerUser({ username: 'CaseUser', password: 'secret123' });

    await expect(userService.registerUser({ username: 'caseuser', password: 'secret123' })).rejects.toMatchObject({
      status: 409,
      code: 'USER_ALREADY_EXISTS'
    });
  });

  test('allows only one concurrent case-insensitive username variant', async () => {
    const results = await Promise.allSettled([
      userService.registerUser({ username: 'RaceUser', password: 'secret123' }),
      userService.registerUser({ username: 'raceuser', password: 'secret123' })
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason).toMatchObject({
      status: 409,
      code: 'USER_ALREADY_EXISTS'
    });
  });

  test('does not authenticate users without a stored password hash', async () => {
    const now = new Date().toISOString();

    database.createUser({
      id: 'legacy-user',
      username: 'legacy-user',
      passwordHash: null,
      createdAt: now,
      updatedAt: now
    });

    await expect(userService.loginUser({ username: 'legacy-user', password: 'anything' })).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED'
    });
  });

  test('updates custom-source metadata without revalidating the unchanged RSS URL', async () => {
    const authPayload = await userService.registerUser({ username: 'source-owner', password: 'secret123' });

    rssParser.validateFeedUrl.mockResolvedValueOnce({ title: 'Original Feed', siteUrl: 'https://example.com', language: 'en', itemCount: 4 });
    const source = await userService.addUserSource(authPayload.user.id, {
      url: 'https://example.com/feed.xml'
    });

    expect(rssParser.validateFeedUrl).toHaveBeenCalledWith('https://example.com/feed.xml', expect.objectContaining({
      maxRetries: 2,
      timeout: 8000
    }));
    expect(source.iconUrl).toBe('https://example.com/favicon.ico');

    database.upsertArticles([{
      id: 'custom-article-1',
      sourceId: source.id,
      source: source.name,
      ownerUserId: authPayload.user.id,
      title: 'Custom article',
      description: 'Source article',
      content: 'Article body',
      url: 'https://example.com/article-1',
      language: 'en',
      pubDate: new Date().toISOString()
    }]);
    database.saveReadLaterArticles(authPayload.user.id, ['custom-article-1'], { userId: authPayload.user.id });
    database.upsertReaderCache('custom-article-1', {
      url: 'https://example.com/article-1',
      title: 'Custom article',
      siteName: 'Example',
      byline: '',
      language: 'en',
      excerpt: 'Source article',
      contentText: 'Reader body',
      contentBlocks: [{ type: 'paragraph', text: 'Reader body' }],
      minutesToRead: 1,
      fetchedAt: new Date().toISOString()
    });

    rssParser.validateFeedUrl.mockClear();
    rssParser.validateFeedUrl.mockRejectedValue(new Error('upstream offline'));

    const updated = await userService.updateUserSource(authPayload.user.id, source.id, {
      name: 'Renamed Feed',
      isActive: false
    });

    expect(rssParser.validateFeedUrl).not.toHaveBeenCalled();
    expect(updated).toMatchObject({
      name: 'Renamed Feed',
      url: 'https://example.com/feed.xml',
      iconUrl: 'https://example.com/favicon.ico',
      isActive: false
    });
    expect(database.getArticles({}, { userId: authPayload.user.id, maxArticleAgeHours: 9999 }).map((article) => article.id)).toContain('custom-article-1');
    expect(database.isReadLaterArticle(authPayload.user.id, 'custom-article-1')).toBe(true);
    expect(database.getReaderCache('custom-article-1', 60 * 60 * 1000)?.contentText).toBe('Reader body');
  });

  test('batches authenticated public API usage until an explicit flush', async () => {
    const authPayload = await userService.registerUser({ username: 'api-user', password: 'secret123' });
    const userId = authPayload.user.id;

    userService.recordPublicApiRequestUsage({ authenticated: true, userId, usedAt: '2026-03-07T10:00:00.000Z' });
    userService.recordPublicApiRequestUsage({ authenticated: true, userId, usedAt: '2026-03-07T10:01:00.000Z' });

    expect(database.findUserById(userId).publicApiRequestCount).toBe(0);

    userService.flushAnonymousPublicApiUsage({ force: true });

    expect(database.findUserById(userId)).toMatchObject({
      publicApiRequestCount: 2,
      publicApiLastUsedAt: '2026-03-07T10:01:00.000Z'
    });
  });

  test('periodically flushes low-volume authenticated public API usage', async () => {
    jest.useFakeTimers();

    try {
      const authPayload = await userService.registerUser({ username: 'timed-api-user', password: 'secret123' });
      const userId = authPayload.user.id;

      userService.recordPublicApiRequestUsage({ authenticated: true, userId, usedAt: '2026-03-07T10:00:00.000Z' });

      expect(database.findUserById(userId).publicApiRequestCount).toBe(0);

      userService.startPublicApiUsageFlushTimer();
      jest.advanceTimersByTime(5000);

      expect(database.findUserById(userId)).toMatchObject({
        publicApiRequestCount: 1,
        publicApiLastUsedAt: '2026-03-07T10:00:00.000Z'
      });
    } finally {
      userService.stopPublicApiUsageFlushTimer();
      jest.useRealTimers();
    }
  });

  test('rolls back authenticated public API usage flush on partial failure', async () => {
    const firstUser = await userService.registerUser({ username: 'api-user-one', password: 'secret123' });
    const secondUser = await userService.registerUser({ username: 'api-user-two', password: 'secret123' });
    const originalIncrement = database.incrementUserPublicApiUsage;
    const incrementSpy = jest.spyOn(database, 'incrementUserPublicApiUsage')
      .mockImplementation((userId, usedAt, count) => {
        if (userId === secondUser.user.id) {
          throw new Error('simulated write failure');
        }
        return originalIncrement(userId, usedAt, count);
      });

    userService.recordPublicApiRequestUsage({ authenticated: true, userId: firstUser.user.id, usedAt: '2026-03-07T10:00:00.000Z' });
    userService.recordPublicApiRequestUsage({ authenticated: true, userId: secondUser.user.id, usedAt: '2026-03-07T10:01:00.000Z' });

    expect(() => userService.flushAnonymousPublicApiUsage({ force: true })).toThrow('simulated write failure');
    expect(database.findUserById(firstUser.user.id).publicApiRequestCount).toBe(0);
    expect(database.findUserById(secondUser.user.id).publicApiRequestCount).toBe(0);

    incrementSpy.mockRestore();
    userService.flushAnonymousPublicApiUsage({ force: true });

    expect(database.findUserById(firstUser.user.id).publicApiRequestCount).toBe(1);
    expect(database.findUserById(secondUser.user.id).publicApiRequestCount).toBe(1);
  });
});
