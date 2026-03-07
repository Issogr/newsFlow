const fs = require('fs');
const os = require('os');
const path = require('path');
const SqliteDatabase = require('better-sqlite3');
const configuredSources = require('../config/newsSources');

const primarySource = configuredSources.find((source) => !source.groupId) || configuredSources[0] || { id: 'source-a', name: 'Source A' };
const secondarySource = configuredSources.find((source) => !source.groupId && source.id !== primarySource.id) || configuredSources[1] || { id: 'source-b', name: 'Source B' };
const groupedSource = configuredSources.find((source) => source.groupId) || null;
const groupedSourceFamilyId = groupedSource?.groupId || groupedSource?.id || 'grouped-source';
const groupedSourceFamilyName = groupedSource?.groupName || groupedSource?.name || 'Grouped Source';

function createTempDbPath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-db-test-'));
  return {
    tempDir,
    dbPath: path.join(tempDir, 'news.db')
  };
}

describe('database migrations', () => {
  let tempDir;
  let dbPath;
  let database;

  beforeEach(() => {
    jest.resetModules();
    ({ tempDir, dbPath } = createTempDbPath());
    process.env.NEWS_DB_PATH = dbPath;
  });

  afterEach(() => {
    if (database?.closeDb) {
      database.closeDb();
    }

    delete process.env.NEWS_DB_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('initializes a fresh database at the latest migration version', () => {
    database = require('./database');
    database.getDb();

    const sqlite = new SqliteDatabase(dbPath, { readonly: true });
    const migrationVersion = sqlite.prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'migration_version'
    `).get()?.value;
    const topicColumns = sqlite.prepare('PRAGMA table_info(article_topics)').all().map((column) => column.name);
    const settingsColumns = sqlite.prepare('PRAGMA table_info(user_settings)').all().map((column) => column.name);

    sqlite.close();

    expect(migrationVersion).toBe('5');
    expect(topicColumns).toEqual(expect.arrayContaining(['article_id', 'topic', 'created_at']));
    expect(topicColumns).not.toContain('is_ai_generated');
    expect(settingsColumns).toContain('excluded_sub_source_ids');
  });

  test('migrates legacy topic metadata without losing topics', () => {
    const sqlite = new SqliteDatabase(dbPath);

    sqlite.exec(`
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE articles (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL DEFAULT 'legacy-source',
        source_name TEXT NOT NULL DEFAULT 'Legacy Source',
        owner_user_id TEXT,
        title TEXT NOT NULL DEFAULT 'Legacy title',
        description TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        image TEXT,
        author TEXT,
        language TEXT NOT NULL DEFAULT 'it',
        published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE article_topics (
        article_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        is_ai_generated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (article_id, topic)
      );

      INSERT INTO app_meta (key, value) VALUES ('migration_version', '3');
      INSERT INTO articles (id) VALUES ('article-1');
      INSERT INTO article_topics (article_id, topic, is_ai_generated) VALUES ('article-1', 'economy', 1);
    `);

    sqlite.close();

    database = require('./database');
    database.getDb();

    const migratedDb = new SqliteDatabase(dbPath, { readonly: true });
    const topicColumns = migratedDb.prepare('PRAGMA table_info(article_topics)').all().map((column) => column.name);
    const topicRows = migratedDb.prepare(`
      SELECT article_id AS articleId, topic
      FROM article_topics
    `).all();

    migratedDb.close();

    expect(topicColumns).toEqual(['article_id', 'topic', 'created_at']);
    expect(topicRows).toEqual([{ articleId: 'article-1', topic: 'economy' }]);
  });
});

describe('database queries and user data', () => {
  let tempDir;
  let dbPath;
  let database;

  beforeEach(() => {
    jest.resetModules();
    ({ tempDir, dbPath } = createTempDbPath());
    process.env.NEWS_DB_PATH = dbPath;
    database = require('./database');
    database.getDb();
  });

  afterEach(() => {
    database.closeDb();
    delete process.env.NEWS_DB_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('stores articles and applies scope, excluded-source, search, topic, and recency filters', () => {
    const now = Date.now();
    const recentIso = new Date(now - (45 * 60 * 1000)).toISOString();
    const recentIsoTwo = new Date(now - (20 * 60 * 1000)).toISOString();
    const oldIso = new Date(now - (48 * 60 * 60 * 1000)).toISOString();

    database.upsertArticles([
      {
        id: 'global-1',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Economy outlook improves',
        description: 'Global market coverage',
        content: 'Economy content body',
        url: 'https://example.com/global-1',
        language: 'en',
        pubDate: recentIso
      },
      {
        id: 'global-2',
        sourceId: secondarySource.id,
        source: secondarySource.name,
        title: 'Science mission launches',
        description: 'Space coverage',
        content: 'Science content body',
        url: 'https://example.com/global-2',
        language: 'en',
        pubDate: recentIsoTwo
      },
      {
        id: 'private-1',
        sourceId: 'custom-1',
        source: 'Private Feed',
        ownerUserId: 'user-1',
        title: 'Portfolio update',
        description: 'Private note for one user',
        content: 'Private body',
        url: 'https://example.com/private-1',
        language: 'en',
        pubDate: recentIsoTwo
      },
      {
        id: 'private-2',
        sourceId: 'custom-2',
        source: 'Other Feed',
        ownerUserId: 'user-2',
        title: 'Other user note',
        description: 'Should stay hidden',
        content: 'Other body',
        url: 'https://example.com/private-2',
        language: 'en',
        pubDate: recentIsoTwo
      },
      {
        id: 'old-1',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Old economy article',
        description: 'Outdated coverage',
        content: 'Old body',
        url: 'https://example.com/old-1',
        language: 'en',
        pubDate: oldIso
      }
    ]);

    database.mergeTopicsForArticle('global-1', ['Economy', 'Markets']);
    database.mergeTopicsForArticle('global-2', ['Science']);
    database.mergeTopicsForArticle('private-1', ['Economia']);
    database.mergeTopicsForArticle('old-1', ['Economy']);

    const visibleForUser = database.getArticles({}, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(visibleForUser.map((article) => article.id)).toEqual(['private-1', 'global-2', 'global-1']);
    expect(visibleForUser[0]).toEqual(expect.objectContaining({
      rawSourceId: 'custom-1',
      rawSource: 'Private Feed'
    }));

    const excludedFiltered = database.getArticles({}, { userId: 'user-1', excludedSourceIds: [secondarySource.id], maxArticleAgeHours: 24 });
    expect(excludedFiltered.map((article) => article.id)).toEqual(['private-1', 'global-1']);

    const searchFiltered = database.getArticles({ search: 'outlook' }, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(searchFiltered.map((article) => article.id)).toEqual(['global-1']);

    const topicFiltered = database.getArticles({ topics: ['Economia'] }, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(topicFiltered.map((article) => article.id)).toEqual(['private-1', 'global-1']);

    const recentFiltered = database.getArticles({ recentHours: 1 }, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(recentFiltered.map((article) => article.id)).toEqual(['private-1', 'global-2', 'global-1']);
  });

  test('persists settings and removes user-source articles when the source is deleted', () => {
    const now = new Date().toISOString();

    database.createUser({
      id: 'user-1',
      username: 'alice',
      passwordHash: null,
      createdAt: now,
      updatedAt: now
    });

    const settings = database.upsertUserSettings('user-1', {
      defaultLanguage: 'en',
      articleRetentionHours: 12,
      recentHours: 2,
      excludedSourceIds: [primarySource.id],
      excludedSubSourceIds: groupedSource ? [groupedSource.id] : []
    });

    expect(settings).toMatchObject({
      userId: 'user-1',
      defaultLanguage: 'en',
      articleRetentionHours: 12,
      recentHours: 2,
      excludedSourceIds: [primarySource.id],
      excludedSubSourceIds: groupedSource ? [groupedSource.id] : []
    });

    database.createUserSource({
      id: 'custom-1',
      userId: 'user-1',
      name: 'Private Feed',
      url: 'https://example.com/private.xml',
      language: 'en',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      validatedAt: now
    });

    database.updateUserSource('user-1', 'custom-1', {
      name: 'Updated Feed',
      url: 'https://example.com/updated.xml',
      language: 'it',
      updatedAt: now,
      validatedAt: now
    });

    database.upsertArticles([
      {
        id: 'private-article',
        sourceId: 'custom-1',
        source: 'Updated Feed',
        ownerUserId: 'user-1',
        title: 'Private story',
        description: 'Private description',
        content: 'Private content',
        url: 'https://example.com/private-story',
        language: 'it',
        pubDate: now
      }
    ]);

    expect(database.listUserSources('user-1')).toEqual([
      expect.objectContaining({ id: 'custom-1', name: 'Updated Feed', language: 'it', isActive: true })
    ]);
    expect(database.listAllActiveUserSources()).toEqual([
      expect.objectContaining({ id: 'custom-1', userId: 'user-1' })
    ]);

    expect(database.deleteUserSource('user-1', 'custom-1')).toBe(1);
    expect(database.listUserSources('user-1')).toEqual([]);
    expect(database.getArticles({}, { userId: 'user-1' })).toEqual([]);
  });

  test('builds source and topic stats with canonical source ids and search filters', () => {
    const now = Date.now();
    const recentIso = new Date(now - (30 * 60 * 1000)).toISOString();

    database.upsertArticles([
      {
        id: 'global-1',
        sourceId: groupedSource?.id || primarySource.id,
        source: groupedSource?.name || primarySource.name,
        title: 'Economy briefing',
        description: 'Markets and finance',
        content: 'Economy body',
        url: 'https://example.com/briefing',
        language: 'en',
        pubDate: recentIso
      },
      {
        id: 'global-2',
        sourceId: secondarySource.id,
        source: secondarySource.name,
        title: 'Science briefing',
        description: 'Science and space',
        content: 'Science body',
        url: 'https://example.com/science',
        language: 'en',
        pubDate: recentIso
      }
    ]);

    database.mergeTopicsForArticle('global-1', ['Economy', 'Markets']);
    database.mergeTopicsForArticle('global-2', ['Science']);

    const sourceStats = database.getSourceStats([
      { id: groupedSourceFamilyId, name: groupedSourceFamilyName, language: 'it' },
      { id: secondarySource.id, name: secondarySource.name, language: 'en' }
    ]);
    const groupedArticles = database.getArticles({ sourceIds: [groupedSourceFamilyId] });
    const groupedArticlesWithExcludedSubFeed = groupedSource
      ? database.getArticles({ sourceIds: [groupedSourceFamilyId] }, { excludedSubSourceIds: [groupedSource.id] })
      : groupedArticles;

    expect(sourceStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: groupedSourceFamilyId, name: groupedSourceFamilyName, count: 1 }),
      expect.objectContaining({ id: secondarySource.id, name: secondarySource.name, count: 1 })
    ]));
    expect(groupedArticles[0]).toEqual(expect.objectContaining({
      sourceId: groupedSourceFamilyId,
      source: groupedSourceFamilyName,
      rawSourceId: groupedSource?.id || primarySource.id,
      rawSource: groupedSource?.name || primarySource.name,
      subSource: groupedSource?.subSource || null
    }));
    if (groupedSource) {
      expect(groupedArticlesWithExcludedSubFeed).toEqual([]);
    }

    const searchTopics = database.getTopicStatsByFilters({ search: 'briefing', sourceIds: [groupedSourceFamilyId] }, 10);
    expect(searchTopics).toEqual([
      { topic: 'Economia', count: 1 }
    ]);

    const excludedTopics = database.getTopicStatsByFilters({}, 10, { excludedSourceIds: [groupedSourceFamilyId] });
    expect(excludedTopics).toEqual([{ topic: 'Scienza', count: 1 }]);
  });

  test('removes stale default-source articles and cleans excluded ids on restart cleanup', () => {
    const now = new Date().toISOString();

    database.createUser({
      id: 'user-1',
      username: 'alice',
      passwordHash: null,
      createdAt: now,
      updatedAt: now
    });

    database.upsertUserSettings('user-1', {
      defaultLanguage: 'en',
      articleRetentionHours: 24,
      recentHours: 3,
      excludedSourceIds: ['retired-source', primarySource.id, 'custom-1'],
      excludedSubSourceIds: ['retired-sub-source', groupedSource?.id || 'missing-sub-source']
    });

    database.createUserSource({
      id: 'custom-1',
      userId: 'user-1',
      name: 'Private Feed',
      url: 'https://example.com/private.xml',
      language: 'en',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      validatedAt: now
    });

    database.upsertArticles([
      {
        id: 'kept-global',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Keep me',
        description: 'Current default source article',
        content: 'Current body',
        url: 'https://example.com/keep',
        language: 'en',
        pubDate: now
      },
      {
        id: 'stale-global',
        sourceId: 'retired-source',
        source: 'Retired Source',
        title: 'Remove me',
        description: 'Removed default source article',
        content: 'Retired body',
        url: 'https://example.com/remove',
        language: 'en',
        pubDate: now
      },
      {
        id: 'private-article',
        sourceId: 'custom-1',
        source: 'Private Feed',
        ownerUserId: 'user-1',
        title: 'Private stays',
        description: 'Private article',
        content: 'Private body',
        url: 'https://example.com/private',
        language: 'en',
        pubDate: now
      }
    ]);

    const cleanupResult = database.cleanupRemovedConfiguredSourceData();

    expect(cleanupResult).toEqual({ removedArticles: 1, updatedSettings: 1 });
    expect(database.getArticles({}, { userId: 'user-1' }).map((article) => article.id)).toEqual(['private-article', 'kept-global']);
    expect(database.getUserSettings('user-1')).toEqual(expect.objectContaining({
      excludedSourceIds: [primarySource.id, 'custom-1'],
      excludedSubSourceIds: groupedSource ? [groupedSource.id] : []
    }));
  });
});
