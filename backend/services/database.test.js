const fs = require('fs');
const os = require('os');
const path = require('path');
const SqliteDatabase = require('better-sqlite3');
const configuredSources = require('../config/newsSources');
const {
  getCanonicalSourceId,
  getCanonicalSourceName,
  getConfiguredSourceGroups
} = require('../utils/sourceCatalog');

const sourceGroups = getConfiguredSourceGroups();
const primarySource = configuredSources.find((source) => !source.groupId) || configuredSources[0] || { id: 'source-a', name: 'Source A' };
const secondarySource = configuredSources.find((source) => !source.groupId && source.id !== primarySource.id) || configuredSources[1] || { id: 'source-b', name: 'Source B' };
const groupedSource = configuredSources.find((source) => source.groupId) || null;
const groupedSourceFamily = groupedSource
  ? sourceGroups.find((group) => group.subSources.some((subSource) => subSource.id === groupedSource.id))
  : null;
const groupedSourceFamilyId = groupedSourceFamily?.id || groupedSource?.id || 'grouped-source';
const groupedSourceFamilyName = groupedSourceFamily?.name || groupedSource?.name || 'Grouped Source';
const alternateGroupedSource = groupedSourceFamily
  ? configuredSources.find((source) => source.id !== groupedSource?.id && groupedSourceFamily.subSources.some((subSource) => subSource.id === source.id))
  : null;
const primarySourceFamilyId = getCanonicalSourceId(primarySource.id, primarySource.name);
const secondarySourceFamilyId = getCanonicalSourceId(secondarySource.id, secondarySource.name);
const secondarySourceFamilyName = getCanonicalSourceName(secondarySource.id, secondarySource.name);

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
    const articleColumns = sqlite.prepare('PRAGMA table_info(articles)').all().map((column) => column.name);
    const userColumns = sqlite.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
    const passwordSetupTokenColumns = sqlite.prepare('PRAGMA table_info(password_setup_tokens)').all().map((column) => column.name);
    const apiTokenColumns = sqlite.prepare('PRAGMA table_info(api_tokens)').all().map((column) => column.name);

    sqlite.close();

    expect(migrationVersion).toBe('19');
    expect(articleColumns).toContain('canonical_url');
    expect(topicColumns).toEqual(expect.arrayContaining(['article_id', 'topic', 'created_at']));
    expect(topicColumns).not.toContain('is_ai_generated');
    expect(settingsColumns).toContain('excluded_sub_source_ids');
    expect(settingsColumns).toContain('auto_refresh_enabled');
    expect(settingsColumns).toContain('show_news_images');
    expect(settingsColumns).toContain('compact_news_cards');
    expect(settingsColumns).toContain('compact_news_cards_mode');
    expect(settingsColumns).toContain('reader_text_size');
    expect(settingsColumns).toContain('reader_panel_position');
    expect(settingsColumns).toContain('last_seen_release_notes_version');
    expect(userColumns).toContain('role');
    expect(userColumns).toContain('last_login_at');
    expect(userColumns).toContain('last_activity_at');
    expect(userColumns).toContain('public_api_request_count');
    expect(userColumns).toContain('public_api_last_used_at');
    expect(passwordSetupTokenColumns).toEqual(expect.arrayContaining(['user_id', 'token_hash', 'purpose', 'expires_at', 'used_at']));
    expect(apiTokenColumns).toEqual(expect.arrayContaining(['user_id', 'token_hash', 'token_prefix', 'expires_at', 'revoked_at', 'last_used_at']));
  });

  test('migrates an unversioned legacy database instead of marking it current', () => {
    const sqlite = new SqliteDatabase(dbPath);

    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        last_login_at TEXT,
        last_activity_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE user_settings (
        user_id TEXT PRIMARY KEY,
        default_language TEXT NOT NULL DEFAULT 'auto',
        theme_mode TEXT NOT NULL DEFAULT 'system',
        article_retention_hours INTEGER NOT NULL DEFAULT 24,
        recent_hours INTEGER NOT NULL DEFAULT 3,
        auto_refresh_enabled INTEGER NOT NULL DEFAULT 1,
        show_news_images INTEGER NOT NULL DEFAULT 1,
        reader_panel_position TEXT NOT NULL DEFAULT 'right',
        reader_text_size TEXT NOT NULL DEFAULT 'medium',
        last_seen_release_notes_version TEXT NOT NULL DEFAULT '',
        default_source_ids TEXT NOT NULL DEFAULT '[]',
        excluded_sub_source_ids TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    sqlite.close();

    database = require('./database');
    database.getDb();

    const migratedDb = new SqliteDatabase(dbPath, { readonly: true });
    const migratedVersion = migratedDb.prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'migration_version'
    `).get()?.value;
    const settingsColumns = migratedDb.prepare('PRAGMA table_info(user_settings)').all().map((column) => column.name);
    const userColumns = migratedDb.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
    const apiTokenColumns = migratedDb.prepare('PRAGMA table_info(api_tokens)').all().map((column) => column.name);

    migratedDb.close();

    expect(migratedVersion).toBe('19');
    expect(settingsColumns).toEqual(expect.arrayContaining(['compact_news_cards', 'compact_news_cards_mode']));
    expect(userColumns).toEqual(expect.arrayContaining(['public_api_request_count', 'public_api_last_used_at']));
    expect(apiTokenColumns).toContain('token_hash');
  });

  test('opens an existing database already on the current schema version', () => {
    const sqlite = new SqliteDatabase(dbPath);

    sqlite.exec(`
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE articles (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        owner_user_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        canonical_url TEXT NOT NULL DEFAULT '',
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
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (article_id, topic)
      );

      CREATE TABLE user_settings (
        user_id TEXT PRIMARY KEY,
        default_language TEXT NOT NULL DEFAULT 'auto',
        theme_mode TEXT NOT NULL DEFAULT 'system',
        article_retention_hours INTEGER NOT NULL DEFAULT 24,
        recent_hours INTEGER NOT NULL DEFAULT 3,
        auto_refresh_enabled INTEGER NOT NULL DEFAULT 1,
        show_news_images INTEGER NOT NULL DEFAULT 1,
        compact_news_cards INTEGER NOT NULL DEFAULT 0,
        reader_panel_position TEXT NOT NULL DEFAULT 'right',
        reader_text_size TEXT NOT NULL DEFAULT 'medium',
        last_seen_release_notes_version TEXT NOT NULL DEFAULT '',
        default_source_ids TEXT NOT NULL DEFAULT '[]',
        excluded_sub_source_ids TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        last_login_at TEXT,
        last_activity_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE password_setup_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL,
        created_by_user_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );

       INSERT INTO app_meta (key, value) VALUES ('migration_version', '17');
       INSERT INTO articles (id, source_id, source_name, title, canonical_url) VALUES ('article-1', 'ansa', 'ANSA', 'Headline', 'https://example.com/story');
       INSERT INTO article_topics (article_id, topic) VALUES ('article-1', 'economy');
    `);

    sqlite.close();

    database = require('./database');
    database.getDb();

    const migratedDb = new SqliteDatabase(dbPath, { readonly: true });
    const topicRows = migratedDb.prepare(`
      SELECT article_id AS articleId, topic
      FROM article_topics
    `).all();
    const articleRows = migratedDb.prepare(`
      SELECT id, canonical_url AS canonicalUrl
      FROM articles
    `).all();
    const migratedVersion = migratedDb.prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'migration_version'
    `).get()?.value;
    const settingsColumns = migratedDb.prepare('PRAGMA table_info(user_settings)').all().map((column) => column.name);
    const userColumns = migratedDb.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
    const passwordSetupTokenColumns = migratedDb.prepare('PRAGMA table_info(password_setup_tokens)').all().map((column) => column.name);
    const apiTokenColumns = migratedDb.prepare('PRAGMA table_info(api_tokens)').all().map((column) => column.name);

    migratedDb.close();

    expect(topicRows).toEqual([{ articleId: 'article-1', topic: 'economy' }]);
    expect(articleRows).toEqual([{ id: 'article-1', canonicalUrl: 'https://example.com/story' }]);
    expect(migratedVersion).toBe('19');
    expect(settingsColumns).toContain('show_news_images');
    expect(settingsColumns).toContain('compact_news_cards');
    expect(settingsColumns).toContain('compact_news_cards_mode');
    expect(settingsColumns).toContain('reader_text_size');
    expect(settingsColumns).toContain('theme_mode');
    expect(userColumns).toContain('role');
    expect(userColumns).toContain('last_login_at');
    expect(userColumns).toContain('last_activity_at');
    expect(userColumns).toContain('public_api_request_count');
    expect(userColumns).toContain('public_api_last_used_at');
    expect(passwordSetupTokenColumns).toContain('token_hash');
    expect(apiTokenColumns).toContain('token_hash');
  });

  test('rejects databases on an older schema version', () => {
    const sqlite = new SqliteDatabase(dbPath);

    sqlite.exec(`
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO app_meta (key, value) VALUES ('migration_version', '10');
    `);

    sqlite.close();

    database = require('./database');
    expect(() => database.getDb()).toThrow('Unsupported database schema version 10');
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

    const excludedFiltered = database.getArticles({}, { userId: 'user-1', excludedSourceIds: [secondarySourceFamilyId], maxArticleAgeHours: 24 });
    expect(excludedFiltered.map((article) => article.id)).toEqual(['private-1', 'global-1']);

    const searchFiltered = database.getArticles({ search: 'outlook' }, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(searchFiltered.map((article) => article.id)).toEqual(['global-1']);

    const topicFiltered = database.getArticles({ topics: ['Economia'] }, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(topicFiltered.map((article) => article.id)).toEqual(['private-1', 'global-1']);

    const recentFiltered = database.getArticles({ recentHours: 1 }, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(recentFiltered.map((article) => article.id)).toEqual(['private-1', 'global-2', 'global-1']);
  });

  test('updates an existing same-source article when the canonical URL matches a new id', () => {
    const now = new Date().toISOString();

    const firstResult = database.upsertArticles([
      {
        id: 'article-1',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Canonical story',
        description: 'First version',
        content: 'First body',
        url: 'https://example.com/story?utm_source=rss',
        language: 'en',
        pubDate: now
      }
    ]);
    const secondResult = database.upsertArticles([
      {
        id: 'article-2',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Canonical story updated',
        description: 'Second version',
        content: 'Second body',
        url: 'https://example.com/story?utm_source=homepage',
        language: 'en',
        pubDate: new Date(Date.now() + 60 * 1000).toISOString()
      }
    ]);

    const articles = database.getArticles({}, { maxArticleAgeHours: 9999 });

    expect(firstResult).toMatchObject({ insertedCount: 1, updatedCount: 0 });
    expect(secondResult).toMatchObject({ insertedCount: 0, updatedCount: 1, updatedIds: ['article-1'] });
    expect(articles).toHaveLength(1);
    expect(articles[0]).toEqual(expect.objectContaining({
      id: 'article-1',
      title: 'Canonical story updated',
      url: 'https://example.com/story?utm_source=homepage'
    }));
  });

  test('updates an existing grouped-source article when a sibling subfeed repeats the canonical URL', () => {
    expect(groupedSource).toBeTruthy();
    expect(alternateGroupedSource).toBeTruthy();

    const now = Date.now();
    const firstResult = database.upsertArticles([
      {
        id: 'grouped-article-1',
        sourceId: groupedSource.id,
        source: groupedSource.name,
        title: 'Grouped canonical story',
        description: 'First subfeed version',
        content: 'First body',
        url: 'https://example.com/grouped-story?utm_source=home',
        language: 'it',
        pubDate: new Date(now).toISOString()
      }
    ]);
    const secondResult = database.upsertArticles([
      {
        id: 'grouped-article-2',
        sourceId: alternateGroupedSource.id,
        source: alternateGroupedSource.name,
        title: 'Grouped canonical story updated',
        description: 'Sibling subfeed version',
        content: 'Second body',
        url: 'https://example.com/grouped-story?utm_source=mondo',
        language: 'it',
        pubDate: new Date(now + 60 * 1000).toISOString()
      }
    ]);

    const rawRows = database.getDb().prepare('SELECT id, source_id AS sourceId FROM articles ORDER BY id ASC').all();
    const articles = database.getArticles({}, { maxArticleAgeHours: 9999 });

    expect(firstResult).toMatchObject({ insertedCount: 1, updatedCount: 0 });
    expect(secondResult).toMatchObject({ insertedCount: 0, updatedCount: 1, updatedIds: ['grouped-article-1'] });
    expect(rawRows).toEqual([{ id: 'grouped-article-1', sourceId: alternateGroupedSource.id }]);
    expect(articles).toHaveLength(1);
    expect(articles[0]).toEqual(expect.objectContaining({
      id: 'grouped-article-1',
      sourceId: groupedSourceFamilyId,
      source: groupedSourceFamilyName,
      rawSourceId: alternateGroupedSource.id,
      title: 'Grouped canonical story updated'
    }));
  });

  test('ignores topic merges for article ids that are no longer present', () => {
    const now = new Date().toISOString();

    database.upsertArticles([
      {
        id: 'existing-topic-article',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Existing topic article',
        description: 'Existing description',
        content: '',
        url: 'https://example.com/existing-topic-article',
        language: 'en',
        pubDate: now
      }
    ]);

    expect(() => database.mergeTopicsForArticles([
      { articleId: 'missing-topic-article', topics: ['Economia'] },
      { articleId: 'existing-topic-article', topics: ['Technology'] }
    ])).not.toThrow();
    expect(database.mergeTopicsForArticle('missing-topic-article', ['Economia'])).toEqual([]);

    const articles = database.getArticles({}, { maxArticleAgeHours: 9999 });
    expect(articles).toHaveLength(1);
    expect(articles[0]).toEqual(expect.objectContaining({
      id: 'existing-topic-article',
      topics: ['Tecnologia']
    }));
  });

  test('normalizes future publication dates on insert and during cleanup', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-15T14:30:00.000Z'));

    try {
      database.upsertArticles([
        {
          id: 'future-article',
          sourceId: primarySource.id,
          source: primarySource.name,
          title: 'Future story',
          description: 'Future description',
          content: 'Future content',
          url: 'https://example.com/future-story',
          language: 'en',
          pubDate: '2030-04-01T12:45:00.000Z'
        }
      ]);

      let storedArticle = database.getDb().prepare(`
        SELECT published_at AS pubDate
        FROM articles
        WHERE id = ?
      `).get('future-article');

      expect(storedArticle.pubDate).toBe('2026-03-15T00:00:00.000Z');

      database.getDb().prepare(`
        UPDATE articles
        SET published_at = ?, updated_at = ?
        WHERE id = ?
      `).run('2031-01-01T09:00:00.000Z', '2026-03-15T14:30:00.000Z', 'future-article');

      expect(database.normalizeFuturePublicationDates('2026-03-15T14:30:00.000Z')).toBe(1);

      storedArticle = database.getDb().prepare(`
        SELECT published_at AS pubDate
        FROM articles
        WHERE id = ?
      `).get('future-article');

      expect(storedArticle.pubDate).toBe('2026-03-15T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
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
      autoRefreshEnabled: false,
      compactNewsCards: true,
      compactNewsCardsMode: 'everywhere',
      readerPanelPosition: 'left',
      readerTextSize: 'large',
      lastSeenReleaseNotesVersion: '3.2.3',
      excludedSourceIds: [primarySourceFamilyId],
      excludedSubSourceIds: groupedSource ? [groupedSource.id] : []
    });

    expect(settings).toMatchObject({
      userId: 'user-1',
      defaultLanguage: 'en',
      articleRetentionHours: 12,
      recentHours: 2,
      autoRefreshEnabled: false,
      compactNewsCards: true,
      compactNewsCardsMode: 'everywhere',
      readerPanelPosition: 'left',
      readerTextSize: 'large',
      lastSeenReleaseNotesVersion: '3.2.3',
      excludedSourceIds: [primarySourceFamilyId],
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

  test('deleting one user shared custom source does not remove another user shared source data', () => {
    const now = new Date().toISOString();

    database.createUser({ id: 'user-1', username: 'alice', passwordHash: null, createdAt: now, updatedAt: now });
    database.createUser({ id: 'user-2', username: 'bob', passwordHash: null, createdAt: now, updatedAt: now });
    database.createUserSource({
      id: 'custom-user-1',
      userId: 'user-1',
      name: 'Shared Feed A',
      url: 'https://example.com/shared.xml',
      language: 'en',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      validatedAt: now
    });
    database.createUserSource({
      id: 'custom-user-2',
      userId: 'user-2',
      name: 'Shared Feed B',
      url: 'https://example.com/shared.xml',
      language: 'en',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      validatedAt: now
    });
    database.upsertArticles([
      {
        id: 'user-1-shared-story',
        sourceId: 'custom-user-1',
        source: 'Shared Feed A',
        ownerUserId: 'user-1',
        title: 'Shared story',
        description: 'Private copy for user one',
        content: '',
        url: 'https://example.com/story',
        language: 'en',
        pubDate: now
      },
      {
        id: 'user-2-shared-story',
        sourceId: 'custom-user-2',
        source: 'Shared Feed B',
        ownerUserId: 'user-2',
        title: 'Shared story',
        description: 'Private copy for user two',
        content: '',
        url: 'https://example.com/story',
        language: 'en',
        pubDate: now
      }
    ]);

    expect(database.deleteUserSource('user-1', 'custom-user-1')).toBe(1);

    expect(database.listUserSources('user-1')).toEqual([]);
    expect(database.listUserSources('user-2')).toEqual([
      expect.objectContaining({ id: 'custom-user-2', url: 'https://example.com/shared.xml' })
    ]);
    expect(database.getArticles({}, { userId: 'user-1', maxArticleAgeHours: 9999 })).toEqual([]);
    expect(database.getArticles({}, { userId: 'user-2', maxArticleAgeHours: 9999 })).toEqual([
      expect.objectContaining({ id: 'user-2-shared-story', rawSourceId: 'custom-user-2' })
    ]);
  });

  test('falls back safely when stored user settings JSON is malformed', () => {
    const now = new Date().toISOString();

    database.createUser({
      id: 'user-1',
      username: 'alice',
      passwordHash: null,
      createdAt: now,
      updatedAt: now
    });

    database.getDb().prepare(`
      INSERT INTO user_settings (
        user_id,
        default_language,
        article_retention_hours,
        recent_hours,
        auto_refresh_enabled,
        reader_panel_position,
        last_seen_release_notes_version,
        default_source_ids,
        excluded_sub_source_ids,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'user-1',
      'en',
      12,
      2,
      1,
      'right',
      '3.2.3',
      '{bad json',
      '"oops"',
      now
    );

    expect(database.getUserSettings('user-1')).toEqual(expect.objectContaining({
      userId: 'user-1',
      defaultLanguage: 'en',
      excludedSourceIds: [],
      excludedSubSourceIds: []
    }));
  });

  test('falls back safely when cached reader blocks are malformed JSON', () => {
    const now = new Date().toISOString();

    database.upsertArticles([
      {
        id: 'article-1',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Readable story',
        description: 'Reader description',
        content: 'Reader content',
        url: 'https://example.com/readable-story',
        language: 'en',
        pubDate: now
      }
    ]);

    database.getDb().prepare(`
      INSERT INTO reader_cache (
        article_id,
        url,
        title,
        content_text,
        content_blocks,
        minutes_to_read,
        fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'article-1',
      'https://example.com/readable-story',
      'Readable story',
      'Reader content',
      '{bad json',
      2,
      now
    );

    expect(database.getReaderCache('article-1')).toEqual(expect.objectContaining({
      articleId: 'article-1',
      title: 'Readable story',
      contentBlocks: null,
      minutesToRead: 2
    }));
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
      { id: secondarySourceFamilyId, name: secondarySourceFamilyName, language: 'en' }
    ]);
    const groupedArticles = database.getArticles({ sourceIds: [groupedSourceFamilyId] });
    const groupedArticlesWithExcludedSubFeed = groupedSource
      ? database.getArticles({ sourceIds: [groupedSourceFamilyId] }, { excludedSubSourceIds: [groupedSource.id] })
      : groupedArticles;

    expect(sourceStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: groupedSourceFamilyId, name: groupedSourceFamilyName, count: 1 }),
      expect.objectContaining({ id: secondarySourceFamilyId, name: secondarySourceFamilyName, count: 1 })
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

  test('groups custom user feeds by registrable domain for filtering and display', () => {
    const now = new Date().toISOString();

    database.createUser({
      id: 'user-1',
      username: 'alice',
      passwordHash: null,
      createdAt: now,
      updatedAt: now
    });

    database.createUserSource({
      id: 'custom-1',
      userId: 'user-1',
      name: 'Example World',
      url: 'https://feeds.example.com/world.xml',
      language: 'en',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      validatedAt: now
    });
    database.createUserSource({
      id: 'custom-2',
      userId: 'user-1',
      name: 'Example Politics',
      url: 'https://feeds.example.com/politics.xml',
      language: 'en',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      validatedAt: now
    });

    database.upsertArticles([
      {
        id: 'custom-article-1',
        sourceId: 'custom-1',
        source: 'Example World',
        ownerUserId: 'user-1',
        title: 'World story',
        description: 'World description',
        content: 'World body',
        url: 'https://example.com/world-story',
        language: 'en',
        pubDate: now
      },
      {
        id: 'custom-article-2',
        sourceId: 'custom-2',
        source: 'Example Politics',
        ownerUserId: 'user-1',
        title: 'Politics story',
        description: 'Politics description',
        content: 'Politics body',
        url: 'https://example.com/politics-story',
        language: 'en',
        pubDate: now
      }
    ]);

    const groupedArticles = database.getArticles({ sourceIds: ['example.com'] }, { userId: 'user-1' });

    expect(groupedArticles).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'example.com', source: 'Example', subSource: 'World' }),
      expect.objectContaining({ sourceId: 'example.com', source: 'Example', subSource: 'Politics' })
    ]));
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
      autoRefreshEnabled: false,
      readerPanelPosition: 'center',
      lastSeenReleaseNotesVersion: '3.2.3',
      excludedSourceIds: ['retired-source', primarySourceFamilyId, 'custom-1'],
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
      excludedSourceIds: [primarySourceFamilyId, 'custom-1'],
      excludedSubSourceIds: groupedSource ? [groupedSource.id] : []
    }));
  });

  test('rolls back user source imports when a duplicate source would violate constraints', () => {
    const now = new Date().toISOString();

    database.createUser({
      id: 'user-1',
      username: 'alice',
      passwordHash: null,
      createdAt: now,
      updatedAt: now
    });

    database.createUserSource({
      id: 'existing-source',
      userId: 'user-1',
      name: 'Existing Feed',
      url: 'https://example.com/existing.xml',
      language: 'en',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      validatedAt: now
    });

    database.upsertUserSettings('user-1', {
      defaultLanguage: 'en',
      articleRetentionHours: 12,
      recentHours: 2,
      autoRefreshEnabled: false,
      readerPanelPosition: 'left',
      lastSeenReleaseNotesVersion: '3.2.3',
      excludedSourceIds: [primarySourceFamilyId],
      excludedSubSourceIds: []
    });

    expect(() => {
      database.importUserState('user-1', [
        {
          id: 'duplicate-1',
          userId: 'user-1',
          name: 'Duplicate Feed A',
          url: 'https://example.com/duplicate.xml',
          language: 'it',
          isActive: true,
          createdAt: now,
          updatedAt: now,
          validatedAt: now
        },
        {
          id: 'duplicate-2',
          userId: 'user-1',
          name: 'Duplicate Feed B',
          url: 'https://example.com/duplicate.xml',
          language: 'it',
          isActive: true,
          createdAt: now,
          updatedAt: now,
          validatedAt: now
        }
      ], {
        defaultLanguage: 'it',
        articleRetentionHours: 24,
        recentHours: 3,
        autoRefreshEnabled: false,
        readerPanelPosition: 'center',
        lastSeenReleaseNotesVersion: '3.2.3',
        excludedSourceIds: ['bbc'],
        excludedSubSourceIds: [],
        updatedAt: now
      });
    }).toThrow();

    expect(database.listUserSources('user-1')).toEqual([
      expect.objectContaining({
        id: 'existing-source',
        name: 'Existing Feed',
        url: 'https://example.com/existing.xml'
      })
    ]);
    expect(database.getUserSettings('user-1')).toMatchObject({
      defaultLanguage: 'en',
      articleRetentionHours: 12,
      recentHours: 2,
      autoRefreshEnabled: false,
      readerPanelPosition: 'left',
      lastSeenReleaseNotesVersion: '3.2.3',
      excludedSourceIds: [primarySourceFamilyId]
    });
  });
});
