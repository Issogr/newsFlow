const fs = require('fs');
const os = require('os');
const path = require('path');

function createTempDbPath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-user-service-test-'));
  return {
    tempDir,
    dbPath: path.join(tempDir, 'news.db')
  };
}

describe('userService imports', () => {
  let tempDir;
  let dbPath;
  let userService;
  let database;
  let rssParser;

  beforeEach(() => {
    jest.resetModules();
    ({ tempDir, dbPath } = createTempDbPath());
    process.env.NEWS_DB_PATH = dbPath;

    jest.doMock('./rssParser', () => ({
      validateFeedUrl: jest.fn()
    }));

    userService = require('./userService');
    database = require('./database');
    rssParser = require('./rssParser');
  });

  afterEach(() => {
    if (database?.closeDb) {
      database.closeDb();
    }

    delete process.env.NEWS_DB_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('imports settings for a passwordless user and returns the recreated sources', async () => {
    const authPayload = userService.registerUser({ username: 'alice', password: '' });
    const userId = authPayload.user.id;

    rssParser.validateFeedUrl.mockResolvedValue({ title: 'Imported Feed', language: 'it', itemCount: 4 });
    const result = await userService.importUserSettings(userId, {
      settings: {
        defaultLanguage: 'it',
        articleRetentionHours: 12,
        recentHours: 2,
        autoRefreshEnabled: false,
        readerPanelPosition: 'left',
        lastSeenReleaseNotesVersion: '3.2.0',
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
        articleRetentionHours: 12,
        recentHours: 2,
        autoRefreshEnabled: false,
        readerPanelPosition: 'left',
        lastSeenReleaseNotesVersion: '3.2.0',
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
    expect(database.getUserSettings(userId)).toMatchObject({
      defaultLanguage: 'it',
      articleRetentionHours: 12,
      recentHours: 2,
      autoRefreshEnabled: false,
      readerPanelPosition: 'left',
      lastSeenReleaseNotesVersion: '3.2.0',
      excludedSourceIds: []
    });
  });
});
