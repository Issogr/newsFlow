const SqliteDatabase = require('./sqliteDatabase');
const configuredSources = require('../config/newsSources');
const { cleanupTempNewsDb, setupTempNewsDb } = require('../test-utils/tempNewsDb');
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

describe('database migrations', () => {
  let tempDir;
  let dbPath;
  let database;

  beforeEach(() => {
    jest.resetModules();
    ({ tempDir, dbPath } = setupTempNewsDb('news-db-test-'));
  });

  afterEach(() => {
    cleanupTempNewsDb({ tempDir }, database);
  });

  test('initializes a fresh database at the latest migration version', () => {
    database = require('./database');
    database.getDb();

    const sqlite = new SqliteDatabase(dbPath, { readOnly: true });
    const migrationVersion = sqlite.prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'migration_version'
    `).get()?.value;
    const topicColumns = sqlite.prepare('PRAGMA table_info(article_topics)').all().map((column) => column.name);
    const settingsColumns = sqlite.prepare('PRAGMA table_info(user_settings)').all().map((column) => column.name);
    const articleColumns = sqlite.prepare('PRAGMA table_info(articles)').all().map((column) => column.name);
    const userColumns = sqlite.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
    const userSourceColumns = sqlite.prepare('PRAGMA table_info(user_sources)').all().map((column) => column.name);
    const passwordSetupTokenColumns = sqlite.prepare('PRAGMA table_info(password_setup_tokens)').all().map((column) => column.name);
    const apiTokenColumns = sqlite.prepare('PRAGMA table_info(api_tokens)').all().map((column) => column.name);
    const readLaterColumns = sqlite.prepare('PRAGMA table_info(user_read_later_articles)').all().map((column) => column.name);
    const thematicSummaryColumns = sqlite.prepare('PRAGMA table_info(thematic_summaries)').all().map((column) => column.name);
    const podcastSummaryColumns = sqlite.prepare('PRAGMA table_info(podcast_summaries)').all().map((column) => column.name);
    const podcastSummaryAudioColumns = sqlite.prepare('PRAGMA table_info(podcast_summary_audio)').all().map((column) => column.name);
    const readThematicSummaryColumns = sqlite.prepare('PRAGMA table_info(user_read_thematic_summaries)').all().map((column) => column.name);
    const articleIndexNames = sqlite.prepare('PRAGMA index_list(articles)').all().map((index) => index.name);
    const userIndexNames = sqlite.prepare('PRAGMA index_list(users)').all().map((index) => index.name);
    const topicIndexNames = sqlite.prepare('PRAGMA index_list(article_topics)').all().map((index) => index.name);

    sqlite.close();

    expect(migrationVersion).toBe('42');
    expect(articleColumns).toContain('canonical_url');
    expect(articleColumns).toContain('ai_topics_processed_at');
    expect(articleColumns).toContain('ai_topics_status');
    expect(articleColumns).toEqual(expect.arrayContaining(['story_group_id', 'ai_story_group_processed_at', 'ai_story_group_status', 'ai_story_group_model', 'ai_story_group_match_ids', 'ai_story_group_confidence', 'ai_story_group_reason']));
    expect(articleColumns).toEqual(expect.arrayContaining(['clickbait_label', 'clickbait_score', 'clickbait_source', 'clickbait_confidence', 'clickbait_model', 'clickbait_reason_code', 'ai_clickbait_processed_at', 'ai_clickbait_status']));
    expect(topicColumns).toEqual(expect.arrayContaining(['article_id', 'topic', 'source', 'confidence', 'evidence', 'reason_code', 'created_at']));
    expect(topicColumns).not.toContain('is_ai_generated');
    expect(settingsColumns).toContain('excluded_sub_source_ids');
    expect(settingsColumns).toContain('show_news_images');
    expect(settingsColumns).toContain('compact_news_cards');
    expect(settingsColumns).toContain('compact_news_cards_mode');
    expect(settingsColumns).toContain('reader_text_size');
    expect(settingsColumns).toContain('reader_text_width');
    expect(settingsColumns).toContain('reader_panel_position');
    expect(settingsColumns).toContain('last_seen_release_notes_version');
    expect(settingsColumns).toContain('source_setup_completed');
    expect(settingsColumns).toContain('excluded_source_ids');
    expect(settingsColumns).not.toContain('article_retention_hours');
    expect(settingsColumns).not.toContain('recent_hours');
    expect(settingsColumns).not.toContain('default_source_ids');
    expect(userColumns).not.toContain('role');
    expect(userColumns).toContain('last_login_at');
    expect(userColumns).toContain('last_activity_at');
    expect(userColumns).toContain('public_api_request_count');
    expect(userColumns).toContain('public_api_last_used_at');
    expect(userSourceColumns).toContain('icon_url');
    expect(passwordSetupTokenColumns).toEqual(expect.arrayContaining(['user_id', 'token_hash', 'purpose', 'expires_at', 'used_at']));
    expect(apiTokenColumns).toEqual(expect.arrayContaining(['user_id', 'token_hash', 'token_prefix', 'expires_at', 'revoked_at', 'last_used_at']));
    expect(readLaterColumns).toEqual(expect.arrayContaining(['user_id', 'article_id', 'saved_at']));
    expect(readThematicSummaryColumns).toEqual(expect.arrayContaining(['user_id', 'summary_id', 'read_at']));
    expect(thematicSummaryColumns).toEqual(expect.arrayContaining(['topic_key', 'period_start', 'period_end', 'summary_text', 'summary_text_en', 'summary_text_it', 'sources_json', 'failure_category', 'retry_count']));
    expect(thematicSummaryColumns).toEqual(expect.not.arrayContaining(['title', 'title_en', 'title_it']));
    expect(podcastSummaryColumns).toEqual(expect.arrayContaining(['period_start', 'period_end', 'script_text', 'title_en', 'script_text_en', 'title_it', 'script_text_it', 'audio_blob', 'audio_status', 'audio_voice', 'sources_json', 'failure_category', 'retry_count', 'audio_failure_category', 'audio_retry_count', 'audio_failed_at']));
    expect(podcastSummaryAudioColumns).toEqual(expect.arrayContaining(['podcast_id', 'locale', 'audio_blob', 'audio_status', 'audio_model', 'audio_voice', 'audio_retry_count', 'audio_failed_at']));
    expect(articleIndexNames).toContain('idx_articles_owner_published_id');
    expect(userIndexNames).toContain('idx_users_username_lower');
    expect(topicIndexNames).toContain('idx_article_topics_topic_article');
  });

  test('migrates reader text width from schema version 41', () => {
    const sqlite = new SqliteDatabase(dbPath);
    sqlite.exec(`
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE user_settings (
        user_id TEXT PRIMARY KEY,
        reader_text_size TEXT NOT NULL DEFAULT 'medium'
      );
      INSERT INTO app_meta (key, value) VALUES ('migration_version', '41');
      INSERT INTO user_settings (user_id) VALUES ('user-1');
    `);
    sqlite.close();

    database = require('./database');
    database.getDb();

    const migratedDb = new SqliteDatabase(dbPath, { readOnly: true });
    const migrationVersion = migratedDb.prepare("SELECT value FROM app_meta WHERE key = 'migration_version'").get()?.value;
    const width = migratedDb.prepare('SELECT reader_text_width AS readerTextWidth FROM user_settings WHERE user_id = ?').get('user-1')?.readerTextWidth;
    migratedDb.close();

    expect(migrationVersion).toBe('42');
    expect(width).toBe('default');
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

    const migratedDb = new SqliteDatabase(dbPath, { readOnly: true });
    const migratedVersion = migratedDb.prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'migration_version'
    `).get()?.value;
    const settingsColumns = migratedDb.prepare('PRAGMA table_info(user_settings)').all().map((column) => column.name);
    const userColumns = migratedDb.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
    const articleColumns = migratedDb.prepare('PRAGMA table_info(articles)').all().map((column) => column.name);
    const apiTokenColumns = migratedDb.prepare('PRAGMA table_info(api_tokens)').all().map((column) => column.name);
    const userSourceColumns = migratedDb.prepare('PRAGMA table_info(user_sources)').all().map((column) => column.name);

    migratedDb.close();

    expect(migratedVersion).toBe('42');
    expect(settingsColumns).toEqual(expect.arrayContaining(['compact_news_cards', 'compact_news_cards_mode']));
    expect(settingsColumns).toContain('source_setup_completed');
    expect(settingsColumns).toContain('excluded_source_ids');
    expect(settingsColumns).not.toContain('article_retention_hours');
    expect(settingsColumns).not.toContain('recent_hours');
    expect(settingsColumns).not.toContain('default_source_ids');
    expect(userColumns).toEqual(expect.arrayContaining(['public_api_request_count', 'public_api_last_used_at']));
    expect(articleColumns).toEqual(expect.arrayContaining(['ai_topics_processed_at', 'ai_topics_status', 'story_group_id', 'ai_story_group_processed_at', 'ai_story_group_status', 'ai_story_group_model', 'ai_story_group_match_ids', 'ai_story_group_confidence', 'ai_story_group_reason', 'clickbait_label', 'ai_clickbait_processed_at', 'ai_clickbait_status']));
    expect(apiTokenColumns).toContain('token_hash');
    expect(userSourceColumns).toContain('icon_url');
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

    const migratedDb = new SqliteDatabase(dbPath, { readOnly: true });
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
    const articleColumns = migratedDb.prepare('PRAGMA table_info(articles)').all().map((column) => column.name);
    const articleAiState = migratedDb.prepare('SELECT ai_topics_processed_at AS processedAt, ai_topics_status AS status FROM articles WHERE id = ?').get('article-1');
    const passwordSetupTokenColumns = migratedDb.prepare('PRAGMA table_info(password_setup_tokens)').all().map((column) => column.name);
    const apiTokenColumns = migratedDb.prepare('PRAGMA table_info(api_tokens)').all().map((column) => column.name);
    const userSourceColumns = migratedDb.prepare('PRAGMA table_info(user_sources)').all().map((column) => column.name);

    migratedDb.close();

    expect(topicRows).toEqual([{ articleId: 'article-1', topic: 'economy' }]);
    expect(articleRows).toEqual([{ id: 'article-1', canonicalUrl: 'https://example.com/story' }]);
    expect(migratedVersion).toBe('42');
    expect(articleColumns).toEqual(expect.arrayContaining(['ai_topics_processed_at', 'ai_topics_status', 'story_group_id', 'ai_story_group_processed_at', 'ai_story_group_status', 'ai_story_group_model', 'ai_story_group_match_ids', 'ai_story_group_confidence', 'ai_story_group_reason', 'clickbait_label', 'ai_clickbait_processed_at', 'ai_clickbait_status']));
    expect(articleAiState).toEqual({ processedAt: expect.any(String), status: 'legacy' });
    expect(settingsColumns).toContain('show_news_images');
    expect(settingsColumns).toContain('compact_news_cards');
    expect(settingsColumns).toContain('compact_news_cards_mode');
    expect(settingsColumns).toContain('reader_text_size');
    expect(settingsColumns).toContain('reader_text_width');
    expect(settingsColumns).toContain('theme_mode');
    expect(settingsColumns).toContain('source_setup_completed');
    expect(settingsColumns).toContain('excluded_source_ids');
    expect(settingsColumns).not.toContain('article_retention_hours');
    expect(settingsColumns).not.toContain('recent_hours');
    expect(settingsColumns).not.toContain('default_source_ids');
    expect(userColumns).not.toContain('role');
    expect(userColumns).toContain('last_login_at');
    expect(userColumns).toContain('last_activity_at');
    expect(userColumns).toContain('public_api_request_count');
    expect(userColumns).toContain('public_api_last_used_at');
    expect(passwordSetupTokenColumns).toContain('token_hash');
    expect(apiTokenColumns).toContain('token_hash');
    expect(userSourceColumns).toContain('icon_url');
  });

  test('migrates version 23 by forcing source review and removing custom duplicates of built-in feeds', () => {
    const now = new Date().toISOString();
    const duplicateBuiltInSource = configuredSources.find((source) => source.id === 'ilpost') || configuredSources[0];

    database = require('./database');
    const sqlite = database.getDb();

    database.createUser({
      id: 'user-1',
      username: 'alice',
      passwordHash: null,
      createdAt: now,
      updatedAt: now
    });
    database.upsertUserSettings('user-1', {
      defaultLanguage: 'en',
      readerPanelPosition: 'right',
      readerTextSize: 'medium',
      sourceSetupCompleted: true,
      excludedSourceIds: [],
      excludedSubSourceIds: ['ansa_mondo']
    });
    database.createUserSource({
      id: 'custom-duplicate',
      userId: 'user-1',
      name: duplicateBuiltInSource.name,
      url: duplicateBuiltInSource.url,
      language: duplicateBuiltInSource.language,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      validatedAt: now
    });
    database.createUserSource({
      id: 'custom-private',
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
        id: 'duplicate-private-article',
        sourceId: 'custom-duplicate',
        source: duplicateBuiltInSource.name,
        ownerUserId: 'user-1',
        title: 'Duplicate private article',
        description: 'Duplicate custom source article',
        content: 'Duplicate body',
        url: 'https://example.com/duplicate-private',
        language: 'en',
        pubDate: now
      },
      {
        id: 'kept-private-article',
        sourceId: 'custom-private',
        source: 'Private Feed',
        ownerUserId: 'user-1',
        title: 'Private article',
        description: 'Private custom source article',
        content: 'Private body',
        url: 'https://example.com/private-article',
        language: 'en',
        pubDate: now
      }
    ]);
    sqlite.prepare(`
      UPDATE app_meta
      SET value = '23'
      WHERE key = 'migration_version'
    `).run();

    database.closeDb();
    jest.resetModules();
    database = require('./database');
    database.getDb();

    const migratedVersion = database.getDb().prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'migration_version'
    `).get()?.value;
    const settings = database.getUserSettings('user-1');
    const sourceIds = database.listUserSources('user-1').map((source) => source.id);
    const articleIds = database.getArticles({}, { userId: 'user-1' }).map((article) => article.id);

    expect(migratedVersion).toBe('42');
    expect(settings.sourceSetupCompleted).toBe(false);
    expect(settings.excludedSourceIds).toEqual(sourceGroups.map((source) => source.id));
    expect(settings.excludedSubSourceIds).toEqual([]);
    expect(sourceIds).toEqual(['custom-private']);
    expect(articleIds).toEqual(['kept-private-article']);
  });

  test('drops unused thematic summary title columns during migration', () => {
    const sqlite = new SqliteDatabase(dbPath);

    sqlite.exec(`
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE thematic_summaries (
        id TEXT PRIMARY KEY,
        topic_key TEXT NOT NULL,
        topic_label TEXT NOT NULL,
        topics_json TEXT NOT NULL DEFAULT '[]',
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        summary_text TEXT NOT NULL DEFAULT '',
        title_en TEXT NOT NULL DEFAULT '',
        summary_text_en TEXT NOT NULL DEFAULT '',
        title_it TEXT NOT NULL DEFAULT '',
        summary_text_it TEXT NOT NULL DEFAULT '',
        sources_json TEXT NOT NULL DEFAULT '[]',
        article_count INTEGER NOT NULL DEFAULT 0,
        model TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'completed',
        failure_category TEXT NOT NULL DEFAULT '',
        retry_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(topic_key, period_start, period_end)
      );

      CREATE TABLE podcast_summaries (
        id TEXT PRIMARY KEY,
        period_start TEXT NOT NULL DEFAULT '',
        period_end TEXT NOT NULL DEFAULT '',
        audio_model TEXT NOT NULL DEFAULT '',
        audio_voice TEXT NOT NULL DEFAULT '',
        audio_mime_type TEXT NOT NULL DEFAULT '',
        audio_blob BLOB,
        audio_status TEXT NOT NULL DEFAULT 'not_available',
        audio_error_message TEXT,
        audio_failure_category TEXT NOT NULL DEFAULT '',
        audio_retry_count INTEGER NOT NULL DEFAULT 0,
        audio_failed_at TEXT,
        generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO app_meta (key, value) VALUES ('migration_version', '35');
      INSERT INTO thematic_summaries (
        id, topic_key, topic_label, period_start, period_end, title, summary_text,
        title_en, summary_text_en, title_it, summary_text_it
      ) VALUES (
        'summary-1', 'technology', 'Technology', '2026-05-21T05:00:00.000Z', '2026-05-21T11:00:00.000Z',
        'Technology briefing', 'English text [1]', 'Technology briefing', 'English text [1]', 'Sintesi tecnologia', 'Testo italiano [1]'
      );
    `);
    sqlite.close();

    database = require('./database');
    database.getDb();

    const migratedDb = new SqliteDatabase(dbPath, { readOnly: true });
    const migratedVersion = migratedDb.prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'migration_version'
    `).get()?.value;
    const thematicSummaryColumns = migratedDb.prepare('PRAGMA table_info(thematic_summaries)').all().map((column) => column.name);
    const row = migratedDb.prepare(`
      SELECT summary_text AS summaryText, summary_text_en AS summaryTextEn, summary_text_it AS summaryTextIt
      FROM thematic_summaries
      WHERE id = 'summary-1'
    `).get();

    migratedDb.close();

    expect(migratedVersion).toBe('42');
    expect(thematicSummaryColumns).toEqual(expect.not.arrayContaining(['title', 'title_en', 'title_it']));
    expect(row).toEqual({
      summaryText: 'English text [1]',
      summaryTextEn: 'English text [1]',
      summaryTextIt: 'Testo italiano [1]'
    });
  });

  test('migrates legacy podcast audio into per-locale audio rows', () => {
    const sqlite = new SqliteDatabase(dbPath);
    const legacyAudio = Buffer.from('legacy-italian-audio');

    sqlite.exec(`
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE podcast_summaries (
        id TEXT PRIMARY KEY,
        period_start TEXT NOT NULL DEFAULT '',
        period_end TEXT NOT NULL DEFAULT '',
        audio_model TEXT NOT NULL DEFAULT '',
        audio_voice TEXT NOT NULL DEFAULT '',
        audio_mime_type TEXT NOT NULL DEFAULT '',
        audio_blob BLOB,
        audio_status TEXT NOT NULL DEFAULT 'not_available',
        audio_error_message TEXT,
        audio_failure_category TEXT NOT NULL DEFAULT '',
        audio_retry_count INTEGER NOT NULL DEFAULT 0,
        audio_failed_at TEXT,
        generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO app_meta (key, value) VALUES ('migration_version', '36');
    `);
    sqlite.prepare(`
      INSERT INTO podcast_summaries (
        id, audio_model, audio_voice, audio_mime_type, audio_blob, audio_status, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('legacy-podcast', 'tts-model', 'Charon', 'audio/mpeg', legacyAudio, 'completed', '2026-05-21T13:05:00.000Z');
    sqlite.close();

    database = require('./database');
    database.getDb();

    const migratedDb = new SqliteDatabase(dbPath, { readOnly: true });
    const migratedVersion = migratedDb.prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'migration_version'
    `).get()?.value;
    const audioRow = migratedDb.prepare(`
      SELECT podcast_id AS podcastId, locale, audio_blob AS audioBlob, audio_status AS audioStatus
      FROM podcast_summary_audio
      WHERE podcast_id = 'legacy-podcast'
    `).get();

    migratedDb.close();

    expect(migratedVersion).toBe('42');
    expect(audioRow).toEqual({
      podcastId: 'legacy-podcast',
      locale: 'it',
      audioBlob: legacyAudio,
      audioStatus: 'completed'
    });
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
  let database;

  beforeEach(() => {
    jest.resetModules();
    ({ tempDir } = setupTempNewsDb('news-db-test-'));
    database = require('./database');
    database.getDb();
  });

  afterEach(() => {
    cleanupTempNewsDb({ tempDir }, database);
  });

  test('stores read thematic summary ids per user', () => {
    const now = new Date().toISOString();
    database.createUser({ id: 'user-1', username: 'alice', passwordHash: null, createdAt: now, updatedAt: now });
    database.createUser({ id: 'user-2', username: 'bob', passwordHash: null, createdAt: now, updatedAt: now });

    const readSummaryIds = database.markThematicSummariesRead('user-1', ['summary-1', 'summary-2', 'summary-1', '']);

    expect(readSummaryIds).toHaveLength(2);
    expect(readSummaryIds).toEqual(expect.arrayContaining(['summary-1', 'summary-2']));
    expect(database.listReadThematicSummaryIds('user-1')).toEqual(expect.arrayContaining(['summary-1', 'summary-2']));
    expect(database.listReadThematicSummaryIds('user-2')).toEqual([]);
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
        title: 'Economy outlook improves after COVID-19',
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

    database.mergeTopicsForArticles([
      { articleId: 'global-1', topics: ['Economy', 'Markets'] },
      { articleId: 'global-2', topics: ['Science'] },
      { articleId: 'private-1', topics: ['Economia'] },
      { articleId: 'old-1', topics: ['Economy'] }
    ]);

    const visibleForUser = database.getArticles({}, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(visibleForUser.map((article) => article.id)).toEqual(['private-1', 'global-2', 'global-1']);
    expect(database.getArticleById('private-1', { userId: 'user-1', maxArticleAgeHours: 24 })).toEqual(expect.objectContaining({
      id: 'private-1',
      ownerUserId: 'user-1'
    }));
    expect(visibleForUser[0]).toEqual(expect.objectContaining({
      rawSourceId: 'custom-1',
      rawSource: 'Private Feed',
      ownerUserId: 'user-1'
    }));

    const excludedFiltered = database.getArticles({}, { userId: 'user-1', excludedSourceIds: [secondarySourceFamilyId], maxArticleAgeHours: 24 });
    expect(excludedFiltered.map((article) => article.id)).toEqual(['private-1', 'global-1']);

    const searchFiltered = database.getArticles({ search: 'outlook' }, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(searchFiltered.map((article) => article.id)).toEqual(['global-1']);

    const hyphenSearchFiltered = database.getArticles({ search: 'covid-19' }, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(hyphenSearchFiltered.map((article) => article.id)).toEqual(['global-1']);

    const topicFiltered = database.getArticles({ topics: ['Economia'] }, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(topicFiltered.map((article) => article.id)).toEqual(['private-1', 'global-1']);

    const recentFiltered = database.getArticles({ recentHours: 1 }, { userId: 'user-1', maxArticleAgeHours: 24 });
    expect(recentFiltered.map((article) => article.id)).toEqual(['private-1', 'global-2', 'global-1']);
  });

  test('uses article ids for stable same-timestamp cursor pagination', () => {
    const pubDate = new Date().toISOString();

    database.upsertArticles([
      {
        id: 'article-c',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Story C',
        description: 'Third story',
        content: 'Body C',
        url: 'https://example.com/c',
        language: 'en',
        pubDate
      },
      {
        id: 'article-b',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Story B',
        description: 'Second story',
        content: 'Body B',
        url: 'https://example.com/b',
        language: 'en',
        pubDate
      },
      {
        id: 'article-a',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Story A',
        description: 'First story',
        content: 'Body A',
        url: 'https://example.com/a',
        language: 'en',
        pubDate
      }
    ]);

    const firstPage = database.getArticles({ limit: 1 }, { maxArticleAgeHours: 9999 });
    const secondPage = database.getArticles({
      beforePubDate: firstPage[0].pubDate,
      beforeId: firstPage[0].id,
      limit: 2
    }, { maxArticleAgeHours: 9999 });

    expect(firstPage.map((article) => article.id)).toEqual(['article-c']);
    expect(secondPage.map((article) => article.id)).toEqual(['article-b', 'article-a']);
  });

  test('excludes already returned article ids from cursor pagination', () => {
    const pubDate = new Date().toISOString();

    database.upsertArticles([
      {
        id: 'exclude-article-c',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Story C',
        description: 'Third story',
        content: 'Body C',
        url: 'https://example.com/exclude-c',
        language: 'en',
        pubDate
      },
      {
        id: 'exclude-article-b',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Story B',
        description: 'Second story',
        content: 'Body B',
        url: 'https://example.com/exclude-b',
        language: 'en',
        pubDate
      },
      {
        id: 'exclude-article-a',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Story A',
        description: 'First story',
        content: 'Body A',
        url: 'https://example.com/exclude-a',
        language: 'en',
        pubDate
      }
    ]);

    const page = database.getArticles({
      beforePubDate: pubDate,
      beforeId: 'exclude-article-c',
      excludeArticleIds: ['exclude-article-b'],
      limit: 3
    }, { maxArticleAgeHours: 9999 });

    expect(page.map((article) => article.id)).toEqual(['exclude-article-a']);
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
      canonicalUrl: 'https://example.com/story',
      url: 'https://example.com/story?utm_source=homepage'
    }));
  });

  test('does not rewrite unchanged existing articles', () => {
    const pubDate = new Date().toISOString();
    const article = {
      id: 'unchanged-article',
      sourceId: primarySource.id,
      source: primarySource.name,
      title: 'Unchanged story',
      description: 'Same description',
      content: 'Same body',
      url: 'https://example.com/unchanged',
      language: 'en',
      pubDate
    };

    const firstResult = database.upsertArticles([article]);
    const firstUpdatedAt = database.getDb().prepare('SELECT updated_at AS updatedAt FROM articles WHERE id = ?').get(article.id).updatedAt;
    const secondResult = database.upsertArticles([{ ...article }]);
    const secondUpdatedAt = database.getDb().prepare('SELECT updated_at AS updatedAt FROM articles WHERE id = ?').get(article.id).updatedAt;

    expect(firstResult).toMatchObject({ insertedCount: 1, updatedCount: 0 });
    expect(secondResult).toMatchObject({ insertedCount: 0, updatedCount: 0, updatedIds: [] });
    expect(secondUpdatedAt).toBe(firstUpdatedAt);
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

  test('updates an existing grouped-source article when a sibling subfeed repeats the normalized title within a short time window', () => {
    expect(groupedSource).toBeTruthy();
    expect(alternateGroupedSource).toBeTruthy();

    const now = Date.now();
    const firstResult = database.upsertArticles([
      {
        id: 'grouped-title-article-1',
        sourceId: groupedSource.id,
        source: groupedSource.name,
        title: 'Grouped title fallback story',
        description: 'First subfeed version',
        content: 'First body',
        url: 'https://example.com/grouped-story-a',
        language: 'it',
        pubDate: new Date(now).toISOString()
      }
    ]);
    const secondResult = database.upsertArticles([
      {
        id: 'grouped-title-article-2',
        sourceId: alternateGroupedSource.id,
        source: alternateGroupedSource.name,
        title: '  grouped title fallback story  ',
        description: 'Sibling subfeed version',
        content: 'Second body',
        url: 'https://example.com/grouped-story-b',
        language: 'it',
        pubDate: new Date(now + 30 * 60 * 1000).toISOString()
      }
    ]);

    const rawRows = database.getDb().prepare('SELECT id, source_id AS sourceId FROM articles ORDER BY id ASC').all();
    const articles = database.getArticles({}, { maxArticleAgeHours: 9999 });

    expect(firstResult).toMatchObject({ insertedCount: 1, updatedCount: 0 });
    expect(secondResult).toMatchObject({ insertedCount: 0, updatedCount: 1, updatedIds: ['grouped-title-article-1'] });
    expect(rawRows).toEqual([{ id: 'grouped-title-article-1', sourceId: alternateGroupedSource.id }]);
    expect(articles).toHaveLength(1);
    expect(articles[0]).toEqual(expect.objectContaining({
      id: 'grouped-title-article-1',
      sourceId: groupedSourceFamilyId,
      source: groupedSourceFamilyName,
      rawSourceId: alternateGroupedSource.id,
      title: '  grouped title fallback story  '
    }));
  });

  test('does not create a new AI topic candidate when title fallback dedupe reuses an existing article', () => {
    expect(groupedSource).toBeTruthy();
    expect(alternateGroupedSource).toBeTruthy();

    const now = Date.now();

    database.upsertArticles([
      {
        id: 'grouped-title-ai-1',
        sourceId: groupedSource.id,
        source: groupedSource.name,
        title: 'Grouped AI fallback story',
        description: 'First version',
        content: 'First body',
        url: 'https://example.com/grouped-ai-a',
        language: 'it',
        pubDate: new Date(now).toISOString()
      }
    ]);
    database.markArticlesAiTopicProcessing(['grouped-title-ai-1'], 'completed');

    const secondResult = database.upsertArticles([
      {
        id: 'grouped-title-ai-2',
        sourceId: alternateGroupedSource.id,
        source: alternateGroupedSource.name,
        title: 'Grouped AI fallback story',
        description: 'Second version',
        content: 'Second body',
        url: 'https://example.com/grouped-ai-b',
        language: 'it',
        pubDate: new Date(now + 20 * 60 * 1000).toISOString()
      }
    ]);

    expect(secondResult).toMatchObject({ insertedCount: 0, updatedCount: 1, updatedIds: ['grouped-title-ai-1'] });
    expect(database.getArticleIdsPendingAiTopicProcessing(['grouped-title-ai-1', 'grouped-title-ai-2'])).toEqual([]);
  });

  test('does not merge same-title sibling subfeed articles when they are too far apart in time', () => {
    expect(groupedSource).toBeTruthy();
    expect(alternateGroupedSource).toBeTruthy();

    const now = Date.now();
    const firstResult = database.upsertArticles([
      {
        id: 'grouped-title-window-1',
        sourceId: groupedSource.id,
        source: groupedSource.name,
        title: 'Grouped time window story',
        description: 'Morning version',
        content: 'First body',
        url: 'https://example.com/grouped-window-a',
        language: 'it',
        pubDate: new Date(now).toISOString()
      }
    ]);
    const secondResult = database.upsertArticles([
      {
        id: 'grouped-title-window-2',
        sourceId: alternateGroupedSource.id,
        source: alternateGroupedSource.name,
        title: 'Grouped time window story',
        description: 'Evening version',
        content: 'Second body',
        url: 'https://example.com/grouped-window-b',
        language: 'it',
        pubDate: new Date(now + 4 * 60 * 60 * 1000).toISOString()
      }
    ]);

    const rawRows = database.getDb().prepare('SELECT id FROM articles ORDER BY id ASC').all();

    expect(firstResult).toMatchObject({ insertedCount: 1, updatedCount: 0 });
    expect(secondResult).toMatchObject({ insertedCount: 1, updatedCount: 0, insertedIds: ['grouped-title-window-2'] });
    expect(rawRows).toEqual([{ id: 'grouped-title-window-1' }, { id: 'grouped-title-window-2' }]);
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
    expect(database.mergeTopicsForArticles([
      { articleId: 'missing-topic-article', topics: ['Economia'] }
    ])).toBe(0);

    const articles = database.getArticles({}, { maxArticleAgeHours: 9999 });
    expect(articles).toHaveLength(1);
    expect(articles[0]).toEqual(expect.objectContaining({
      id: 'existing-topic-article',
      topics: ['Tecnologia']
    }));
  });

  test('selects built-in tagged articles for thematic summaries and persists the generated summary', () => {
    const windowStart = '2025-05-21T07:00:00.000Z';
    const windowEnd = '2025-05-21T13:00:00.000Z';

    database.upsertArticles([
      {
        id: 'summary-global-tech',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'AI chips accelerate',
        description: 'Technology update',
        content: '',
        url: 'https://example.com/tech',
        language: 'en',
        pubDate: '2025-05-21T09:00:00.000Z'
      },
      {
        id: 'summary-private-tech',
        sourceId: 'custom-tech',
        source: 'Private Tech',
        ownerUserId: 'user-1',
        title: 'Private AI note',
        description: 'Should not be summarized globally',
        content: '',
        url: 'https://example.com/private-tech',
        language: 'en',
        pubDate: '2025-05-21T10:00:00.000Z'
      },
      {
        id: 'summary-global-politics',
        sourceId: secondarySource.id,
        source: secondarySource.name,
        title: 'Election update',
        description: 'Politics update',
        content: '',
        url: 'https://example.com/politics',
        language: 'en',
        pubDate: '2025-05-21T11:00:00.000Z'
      },
      {
        id: 'summary-entertainment-crossover',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Streaming platform launches a music show',
        description: 'Entertainment update with a minor app mention',
        content: '',
        url: 'https://example.com/entertainment-crossover',
        language: 'en',
        pubDate: '2025-05-21T12:00:00.000Z'
      }
    ]);
    database.mergeTopicsForArticles([
      { articleId: 'summary-global-tech', topics: ['Tecnologia'] },
      { articleId: 'summary-private-tech', topics: ['Tecnologia'] },
      { articleId: 'summary-global-politics', topics: ['Politica'] }
    ]);
    database.replaceTopicsForArticles([
      {
        articleId: 'summary-entertainment-crossover',
        topics: [
          { topic: 'Spettacolo', source: 'ai', confidence: 0.91 },
          { topic: 'Tecnologia', source: 'ai', confidence: 0.68 }
        ]
      }
    ]);

    const articles = database.getArticlesForThematicSummary({
      topics: ['Tecnologia'],
      excludedTopics: ['Spettacolo'],
      periodStart: windowStart,
      periodEnd: windowEnd
    });
    const summary = database.upsertThematicSummary({
      topicKey: 'technology',
      topicLabel: 'Technology',
      topics: ['Tecnologia'],
      periodStart: windowStart,
      periodEnd: windowEnd,
      summaryText: 'AI chips accelerated during the window [1].',
      summaryTextByLocale: {
        en: 'AI chips accelerated during the window [1].',
        it: 'I chip AI hanno accelerato nella finestra [1].'
      },
      sources: [{ index: 1, articleId: 'summary-global-tech', title: 'AI chips accelerate', source: primarySource.name, url: 'https://example.com/tech' }],
      articleCount: 1,
      model: 'test-model'
    });

    expect(articles.map((article) => article.id)).toEqual(['summary-global-tech']);
    expect(summary).toEqual(expect.objectContaining({
      topicKey: 'technology',
      summaryTextByLocale: expect.objectContaining({ it: 'I chip AI hanno accelerato nella finestra [1].' }),
      sources: [expect.objectContaining({ articleId: 'summary-global-tech' })],
      failureCategory: '',
      retryCount: 0
    }));
    expect(summary).not.toHaveProperty('title');
    expect(summary).not.toHaveProperty('titleByLocale');
    expect(database.listLatestThematicSummaries(['technology'])).toHaveLength(1);

    const emptySummary = database.upsertThematicSummary({
      topicKey: 'technology',
      topicLabel: 'Technology',
      topics: ['Tecnologia'],
      periodStart: windowEnd,
      periodEnd: '2025-05-21T19:00:00.000Z',
      summaryText: 'No technology stories were available for this summary window.',
      summaryTextByLocale: {
        en: 'No technology stories were available for this summary window.',
        it: 'Nessuna notizia disponibile per questo topic in questa finestra di riepilogo.'
      },
      status: 'empty'
    });

    expect(emptySummary).toEqual(expect.objectContaining({ status: 'empty', articleCount: 0 }));
    expect(database.listLatestThematicSummaries(['technology'])[0]).toEqual(expect.objectContaining({ status: 'empty' }));
  });

  test('persists podcast summaries with localized scripts and audio payloads', () => {
    const windowStart = '2025-05-21T07:00:00.000Z';
    const windowEnd = '2025-05-21T13:00:00.000Z';
    const summary = database.upsertPodcastSummary({
      id: 'podcast-summary-test',
      periodStart: windowStart,
      periodEnd: windowEnd,
      titleByLocale: {
        en: 'News podcast',
        it: 'Podcast news'
      },
      scriptTextByLocale: {
        en: 'English script',
        it: 'Testo italiano'
      },
      sources: [{ index: 1, articleId: 'podcast-article-1', title: 'Podcast article', source: primarySource.name, url: 'https://example.com/podcast' }],
      articleCount: 1,
      model: 'summary-model',
      audioByLocale: {
        en: {
          audio: {
            data: Buffer.from('english-audio-data').toString('base64'),
            mimeType: 'audio/mpeg',
            model: 'tts-model',
            voice: 'Charon',
            generatedAt: '2025-05-21T13:05:00.000Z'
          },
          audioStatus: 'completed'
        },
        it: {
          audio: {
            data: Buffer.from('italian-audio-data').toString('base64'),
            mimeType: 'audio/wav',
            model: 'tts-model',
            voice: 'Charon',
            generatedAt: '2025-05-21T13:05:00.000Z'
          },
          audioStatus: 'completed'
        }
      },
      audioFailureCategory: '',
      audioRetryCount: 0,
      audioFailedAt: null,
      failureCategory: '',
      retryCount: 0,
      generatedAt: '2025-05-21T13:05:00.000Z'
    });

    expect(summary).toEqual(expect.objectContaining({
      id: 'podcast-summary-test',
      type: 'podcast',
      topicKey: 'podcast',
      titleByLocale: expect.objectContaining({ it: 'Podcast news' }),
      summaryTextByLocale: expect.objectContaining({ it: 'Testo italiano' }),
      audioStatus: 'completed',
      audioFailureCategory: '',
      audioRetryCount: 0,
      audioVoice: 'Charon',
      failureCategory: '',
      retryCount: 0,
      audioUrl: `/api/podcast-summary/podcast-summary-test/audio?locale=en&v=${encodeURIComponent('2025-05-21T13:05:00.000Z:tts-model:Charon')}`,
      availableAudioLocales: ['en', 'it'],
      audioByLocale: expect.objectContaining({
        en: expect.objectContaining({
          audioStatus: 'completed',
          audioUrl: `/api/podcast-summary/podcast-summary-test/audio?locale=en&v=${encodeURIComponent('2025-05-21T13:05:00.000Z:tts-model:Charon')}`
        }),
        it: expect.objectContaining({
          audioStatus: 'completed',
          audioUrl: `/api/podcast-summary/podcast-summary-test/audio?locale=it&v=${encodeURIComponent('2025-05-21T13:05:00.000Z:tts-model:Charon')}`
        })
      })
    }));
    expect(database.listLatestPodcastSummaries(1)).toEqual([expect.objectContaining({ id: 'podcast-summary-test' })]);
    expect(database.getPodcastSummaryAudio('podcast-summary-test')).toEqual(expect.objectContaining({
      data: Buffer.from('english-audio-data'),
      mimeType: 'audio/mpeg'
    }));
    expect(database.getPodcastSummaryAudio('podcast-summary-test', 'it')).toEqual(expect.objectContaining({
      data: Buffer.from('italian-audio-data'),
      mimeType: 'audio/wav'
    }));
    expect(database.getPodcastSummaryAudio('podcast-summary-test', 'fr')).toBeNull();
  });

  test('prunes old summary and podcast windows after replacements exist', () => {
    const oldStart = '2025-05-20T17:00:00.000Z';
    const oldEnd = '2025-05-21T05:00:00.000Z';
    const currentStart = '2025-05-21T05:00:00.000Z';
    const currentEnd = '2025-05-21T11:00:00.000Z';

    database.upsertThematicSummary({
      topicKey: 'technology',
      topicLabel: 'Technology',
      periodStart: oldStart,
      periodEnd: oldEnd,
      summaryText: 'Old technology summary'
    });
    database.upsertThematicSummary({
      topicKey: 'politics',
      topicLabel: 'Politics',
      periodStart: oldStart,
      periodEnd: oldEnd,
      summaryText: 'Old politics summary'
    });
    database.upsertThematicSummary({
      topicKey: 'technology',
      topicLabel: 'Technology',
      periodStart: currentStart,
      periodEnd: currentEnd,
      summaryText: 'Current technology summary'
    });
    database.upsertPodcastSummary({
      id: 'old-podcast-summary',
      periodStart: oldStart,
      periodEnd: oldEnd,
      title: 'Old podcast',
      scriptText: 'Old podcast script',
      audio: { data: Buffer.from('old-audio').toString('base64'), mimeType: 'audio/mpeg' },
      audioStatus: 'completed'
    });
    database.upsertPodcastSummary({
      id: 'current-podcast-summary',
      periodStart: currentStart,
      periodEnd: currentEnd,
      title: 'Current podcast',
      scriptText: 'Current podcast script',
      audio: { data: Buffer.from('current-audio').toString('base64'), mimeType: 'audio/mpeg' },
      audioStatus: 'completed'
    });

    expect(database.pruneSummaryHistory({
      periodEnd: currentEnd,
      topicKeys: ['technology'],
      podcast: true
    })).toEqual({ thematicSummaries: 1, podcastSummaries: 1 });

    expect(database.getThematicSummary('technology', oldStart, oldEnd)).toBeNull();
    expect(database.getThematicSummary('politics', oldStart, oldEnd)).toEqual(expect.objectContaining({ summaryText: 'Old politics summary' }));
    expect(database.getThematicSummary('technology', currentStart, currentEnd)).toEqual(expect.objectContaining({ summaryText: 'Current technology summary' }));
    expect(database.getPodcastSummary(oldStart, oldEnd)).toBeNull();
    expect(database.getPodcastSummaryAudio('old-podcast-summary')).toBeNull();
    expect(database.getPodcastSummary(currentStart, currentEnd)).toEqual(expect.objectContaining({ id: 'current-podcast-summary' }));
    expect(database.getPodcastSummaryAudio('current-podcast-summary')).toEqual(expect.objectContaining({ data: Buffer.from('current-audio') }));
  });

  test('lists and retains the latest two podcast windows when requested', () => {
    const firstStart = '2025-05-20T17:00:00.000Z';
    const firstEnd = '2025-05-21T05:00:00.000Z';
    const secondStart = '2025-05-21T05:00:00.000Z';
    const secondEnd = '2025-05-21T17:00:00.000Z';
    const thirdStart = '2025-05-21T17:00:00.000Z';
    const thirdEnd = '2025-05-22T05:00:00.000Z';

    [
      ['first-podcast-summary', firstStart, firstEnd],
      ['second-podcast-summary', secondStart, secondEnd],
      ['third-podcast-summary', thirdStart, thirdEnd]
    ].forEach(([id, periodStart, periodEnd]) => {
      database.upsertPodcastSummary({
        id,
        periodStart,
        periodEnd,
        title: id,
        scriptText: `${id} script`,
        audio: { data: Buffer.from(id).toString('base64'), mimeType: 'audio/mpeg' },
        audioStatus: 'completed'
      });
    });

    expect(database.listLatestPodcastSummaries(2).map((summary) => summary.id)).toEqual([
      'third-podcast-summary',
      'second-podcast-summary'
    ]);

    expect(database.pruneSummaryHistory({
      periodEnd: thirdEnd,
      podcast: true,
      podcastRetainCount: 2
    })).toEqual({ thematicSummaries: 0, podcastSummaries: 1 });

    expect(database.getPodcastSummary(firstStart, firstEnd)).toBeNull();
    expect(database.getPodcastSummary(secondStart, secondEnd)).toEqual(expect.objectContaining({ id: 'second-podcast-summary' }));
    expect(database.getPodcastSummary(thirdStart, thirdEnd)).toEqual(expect.objectContaining({ id: 'third-podcast-summary' }));
  });

  test('tracks AI topic processing and replaces fallback topics', () => {
    const now = new Date().toISOString();

    database.upsertArticles([
      {
        id: 'ai-topic-article',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'AI topic article',
        description: 'Existing description',
        content: '',
        url: 'https://example.com/ai-topic-article',
        language: 'en',
        pubDate: now
      }
    ]);
    database.mergeTopicsForArticles([
      { articleId: 'ai-topic-article', topics: ['Economy'] }
    ]);

    expect(database.getArticleIdsPendingAiTopicProcessing(['ai-topic-article'])).toEqual(['ai-topic-article']);
    expect(database.replaceTopicsForArticles([
      { articleId: 'ai-topic-article', topics: [{ topic: 'Technology', source: 'ai', confidence: 0.91, evidence: ['AI topic'], reasonCode: 'ai_confident_evidence' }] }
    ])).toBe(1);
    expect(database.markArticlesAiTopicProcessing(['ai-topic-article'], 'completed')).toBe(1);

    const articles = database.getArticles({}, { maxArticleAgeHours: 9999 });
    const aiState = database.getDb().prepare(`
      SELECT ai_topics_processed_at AS processedAt, ai_topics_status AS status
      FROM articles
      WHERE id = ?
    `).get('ai-topic-article');
    const report = database.getTopicClassificationReport('ai-topic-article');

    expect(database.getArticleIdsPendingAiTopicProcessing(['ai-topic-article'])).toEqual([]);
    expect(articles[0]).toEqual(expect.objectContaining({
      id: 'ai-topic-article',
      topics: ['Tecnologia']
    }));
    expect(aiState).toEqual({ processedAt: expect.any(String), status: 'completed' });
    expect(report.storedTopics[0]).toEqual(expect.objectContaining({
      topic: 'Tecnologia',
      source: 'ai',
      confidence: 0.91,
      evidence: ['AI topic'],
      reasonCode: 'ai_confident_evidence'
    }));
  });

  test('tracks clickbait processing and exposes stored labels on articles', () => {
    const now = new Date().toISOString();

    database.upsertArticles([
      {
        id: 'clickbait-article',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'You will not believe this update',
        description: 'Existing description',
        content: '',
        url: 'https://example.com/clickbait-article',
        language: 'en',
        pubDate: now
      }
    ]);

    expect(database.getArticleIdsPendingAiClickbaitProcessing(['clickbait-article'])).toEqual(['clickbait-article']);
    expect(database.updateArticleClickbaitClassifications([
      { articleId: 'clickbait-article', classification: { label: 'high', score: 87, source: 'ai', confidence: 0.92, reasonCode: 'ai_clickbait_label' } }
    ], 'clickbait-model')).toBe(1);

    const articles = database.getArticles({}, { maxArticleAgeHours: 9999 });
    const clickbaitState = database.getDb().prepare(`
      SELECT ai_clickbait_processed_at AS processedAt, ai_clickbait_status AS status
      FROM articles
      WHERE id = ?
    `).get('clickbait-article');

    expect(database.getArticleIdsPendingAiClickbaitProcessing(['clickbait-article'])).toEqual([]);
    expect(articles[0]).toEqual(expect.objectContaining({
      id: 'clickbait-article',
      clickbaitLabel: 'high',
      clickbaitScore: 87,
      clickbaitSource: 'ai',
      clickbaitConfidence: 0.92,
      clickbaitModel: 'clickbait-model'
    }));
    expect(clickbaitState).toEqual({ processedAt: expect.any(String), status: 'completed' });

    expect(database.updateArticleClickbaitClassifications([
      { articleId: 'clickbait-article', classification: { label: 'high', score: 87, source: 'local', confidence: 0.92, reasonCode: 'local_clear_high' } }
    ], 'clickbait-model')).toBe(1);
    expect(database.getArticles({}, { maxArticleAgeHours: 9999 })[0]).toEqual(expect.objectContaining({
      clickbaitSource: 'local',
      clickbaitModel: '',
      clickbaitReasonCode: 'local_clear_high'
    }));
  });

  test('retries failed and deferred AI topic processing statuses', () => {
    const now = new Date().toISOString();

    database.upsertArticles([
      {
        id: 'ai-failed-article',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Failed AI article',
        description: 'Existing description',
        content: '',
        url: 'https://example.com/ai-failed-article',
        language: 'en',
        pubDate: now
      },
      {
        id: 'ai-deferred-article',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Deferred AI article',
        description: 'Existing description',
        content: '',
        url: 'https://example.com/ai-deferred-article',
        language: 'en',
        pubDate: now
      },
      {
        id: 'ai-completed-article',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Completed AI article',
        description: 'Existing description',
        content: '',
        url: 'https://example.com/ai-completed-article',
        language: 'en',
        pubDate: now
      }
    ]);

    database.markArticlesAiTopicProcessing(['ai-failed-article'], 'failed');
    database.markArticlesAiTopicProcessing(['ai-deferred-article'], 'deferred');
    database.markArticlesAiTopicProcessing(['ai-completed-article'], 'completed');

    expect(database.getArticleIdsPendingAiTopicProcessing([
      'ai-failed-article',
      'ai-deferred-article',
      'ai-completed-article'
    ])).toEqual(expect.arrayContaining(['ai-failed-article', 'ai-deferred-article']));
    expect(database.getArticleIdsPendingAiTopicProcessing([
      'ai-failed-article',
      'ai-deferred-article',
      'ai-completed-article'
    ])).toHaveLength(2);
  });

  test('tracks AI story grouping assignments and candidate windows', () => {
    const now = new Date('2026-03-15T14:30:00.000Z').toISOString();
    const nearby = new Date('2026-03-15T13:45:00.000Z').toISOString();
    const old = new Date('2026-03-10T14:30:00.000Z').toISOString();

    database.upsertArticles([
      {
        id: 'story-target',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Meloni meets Trump in Rome',
        description: 'Talks focused on tariffs and Ukraine.',
        content: '',
        url: 'https://example.com/story-target',
        language: 'en',
        pubDate: now
      },
      {
        id: 'story-candidate',
        sourceId: secondarySource.id,
        source: secondarySource.name,
        title: 'Tariffs and Ukraine at Trump Meloni summit',
        description: 'The two leaders met in the Italian capital.',
        content: '',
        url: 'https://example.com/story-candidate',
        language: 'en',
        pubDate: nearby
      },
      {
        id: 'old-story-candidate',
        sourceId: secondarySource.id,
        source: secondarySource.name,
        title: 'Old unrelated story',
        description: 'Too old for the matching window.',
        content: '',
        url: 'https://example.com/old-story-candidate',
        language: 'en',
        pubDate: old
      }
    ]);

    expect(database.getArticleIdsPendingAiStoryGrouping(['story-target'])).toEqual(['story-target']);

    const candidateSet = database.getAiStoryGroupingCandidateSet('story-target', { windowHours: 2 });
    expect(candidateSet.target).toEqual(expect.objectContaining({ id: 'story-target' }));
    expect(candidateSet.candidates.map((article) => article.id)).toEqual(['story-candidate']);

    database.markArticlesAiStoryGrouping(['story-candidate'], 'no_match', 'test-model');
    expect(database.getArticleIdsForAiStoryGroupingRetry(['story-target'], { windowHours: 2, limit: 10 })).toEqual(['story-candidate']);

    expect(database.assignArticlesToStoryGroup(['story-target', 'story-candidate'], 'ai-story-test', 'test-model', [
      { articleId: 'story-candidate', confidence: 0.91, reason: 'same summit' }
    ])).toBe(2);
    expect(database.getArticleIdsForStoryGroups(['ai-story-test'])).toEqual(expect.arrayContaining(['story-target', 'story-candidate']));
    expect(database.getArticleIdsPendingAiStoryGrouping(['story-target', 'story-candidate'])).toEqual([]);
    expect(database.getAiStoryGroupingCandidateSet('story-target', { windowHours: 2 }).candidates).toEqual([]);
    expect([
      database.getArticleById('story-target', { maxArticleAgeHours: null }),
      database.getArticleById('story-candidate', { maxArticleAgeHours: null })
    ]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'story-target', storyGroupId: 'ai-story-test', aiStoryGroupStatus: 'matched', aiStoryGroupModel: 'test-model', aiStoryGroupMatchIds: ['story-candidate'], aiStoryGroupConfidence: 0.91, aiStoryGroupReason: 'same summit' }),
      expect.objectContaining({ id: 'story-candidate', storyGroupId: 'ai-story-test', aiStoryGroupStatus: 'matched', aiStoryGroupModel: 'test-model', aiStoryGroupMatchIds: ['story-candidate'], aiStoryGroupConfidence: 0.91, aiStoryGroupReason: 'same summit' })
    ]));
  });

  test('batches AI story retry lookups across many anchors', () => {
    const publishedAt = new Date().toISOString();
    const anchors = Array.from({ length: 401 }, (_, index) => ({
      id: `story-anchor-${index}`,
      sourceId: primarySource.id,
      source: primarySource.name,
      title: `Story anchor ${index}`,
      description: '',
      content: '',
      url: `https://example.com/story-anchor-${index}`,
      language: 'en',
      pubDate: publishedAt
    }));
    database.upsertArticles(anchors);
    const prepareSpy = jest.spyOn(database.getDb(), 'prepare');

    expect(database.getArticleIdsForAiStoryGroupingRetry(anchors.map((article) => article.id))).toEqual([]);
    expect(prepareSpy.mock.calls.filter(([sql]) => String(sql).includes('WITH anchors'))).toHaveLength(3);

    prepareSpy.mockRestore();
  });

  test('moves read-later state, reader cache, and topics before deleting duplicate articles', () => {
    const now = new Date('2026-03-15T14:30:00.000Z').toISOString();
    const duplicateUpdatedAt = new Date('2026-03-15T14:00:00.000Z').toISOString();
    const canonicalUrl = 'https://example.com/shared-story';

    database.createUser({ id: 'user-1', username: 'alice', passwordHash: null, createdAt: now, updatedAt: now });
    database.upsertArticles([
      {
        id: 'canonical-article',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Canonical story',
        description: 'Canonical description',
        content: '',
        url: canonicalUrl,
        language: 'en',
        pubDate: now
      }
    ]);
    database.getDb().prepare(`
      INSERT INTO articles (
        id, source_id, source_name, owner_user_id, title, description, content, url,
        canonical_url, image, author, language, published_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, '', ?, ?, NULL, NULL, 'en', ?, ?, ?)
    `).run(
      'duplicate-article',
      'duplicate-source',
      primarySource.name,
      'Duplicate story',
      'Duplicate description',
      canonicalUrl,
      canonicalUrl,
      now,
      duplicateUpdatedAt,
      duplicateUpdatedAt
    );
    database.saveReadLaterArticles('user-1', ['duplicate-article']);
    database.upsertReaderCache('duplicate-article', {
      url: canonicalUrl,
      title: 'Duplicate reader title',
      contentText: 'Duplicate reader body',
      fetchedAt: duplicateUpdatedAt
    });
    database.replaceTopicsForArticles([
      {
        articleId: 'duplicate-article',
        topics: [{ topic: 'Technology', source: 'ai', confidence: 0.86, evidence: ['Duplicate topic'], reasonCode: 'duplicate_topic' }]
      }
    ]);

    database.upsertArticles([
      {
        id: 'incoming-article',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Incoming story',
        description: 'Incoming description',
        content: '',
        url: canonicalUrl,
        language: 'en',
        pubDate: now
      }
    ]);

    expect(database.getArticleById('duplicate-article', { maxArticleAgeHours: null })).toBeNull();
    expect(database.getReadLaterArticleIdSet('user-1', ['canonical-article']).has('canonical-article')).toBe(true);
    expect(database.getReaderCache('canonical-article')).toEqual(expect.objectContaining({
      title: 'Duplicate reader title',
      contentText: 'Duplicate reader body'
    }));
    expect(database.getArticleById('canonical-article', { maxArticleAgeHours: null })).toEqual(expect.objectContaining({
      topics: ['Tecnologia']
    }));
    expect(database.getTopicClassificationReport('canonical-article').storedTopics).toEqual([
      expect.objectContaining({
        topic: 'Tecnologia',
        source: 'ai',
        confidence: 0.86,
        evidence: ['Duplicate topic'],
        reasonCode: 'duplicate_topic'
      })
    ]);
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

  test('keeps read-later articles through retention and removes expired unsaved articles', () => {
    const now = new Date('2026-03-15T14:30:00.000Z').toISOString();
    const oldIso = new Date('2026-03-10T14:30:00.000Z').toISOString();

    database.createUser({ id: 'user-1', username: 'alice', passwordHash: null, createdAt: now, updatedAt: now });
    database.upsertArticles([
      {
        id: 'old-read-later-article',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Old saved story',
        description: 'Old saved description',
        content: 'Old saved content',
        url: 'https://example.com/old-saved-story',
        language: 'en',
        pubDate: oldIso
      }
    ]);

    expect(database.saveReadLaterArticles('user-1', ['old-read-later-article']).savedArticleIds).toEqual(['old-read-later-article']);
    expect(database.deleteArticlesOlderThan(now)).toBe(0);
    expect(database.getArticleById('old-read-later-article', { maxArticleAgeHours: null })).toBeTruthy();

    const removal = database.removeReadLaterArticles('user-1', ['old-read-later-article'], { maxArticleAgeHours: 24 });

    expect(removal).toEqual(expect.objectContaining({
      removedArticleIds: ['old-read-later-article'],
      removedCount: 1,
      deletedExpiredArticleCount: 1
    }));
    expect(database.getArticleById('old-read-later-article', { maxArticleAgeHours: null })).toBeNull();
  });

  test('applies recent-hours filters to read-later articles', () => {
    const nowMs = Date.parse('2026-03-15T14:30:00.000Z');

    jest.useFakeTimers().setSystemTime(nowMs);

    try {
      database.createUser({ id: 'user-1', username: 'alice', passwordHash: null, createdAt: new Date(nowMs).toISOString(), updatedAt: new Date(nowMs).toISOString() });
      database.upsertArticles([
        {
          id: 'recent-read-later-article',
          sourceId: primarySource.id,
          source: primarySource.name,
          title: 'Recent saved story',
          description: 'Recent saved description',
          content: '',
          url: 'https://example.com/recent-saved-story',
          language: 'en',
          pubDate: new Date(nowMs - (30 * 60 * 1000)).toISOString()
        },
        {
          id: 'old-read-later-filtered-article',
          sourceId: primarySource.id,
          source: primarySource.name,
          title: 'Old saved story',
          description: 'Old saved description',
          content: '',
          url: 'https://example.com/old-saved-story-filtered',
          language: 'en',
          pubDate: new Date(nowMs - (5 * 60 * 60 * 1000)).toISOString()
        }
      ]);
      database.saveReadLaterArticles('user-1', ['recent-read-later-article', 'old-read-later-filtered-article']);

      expect(database.getReadLaterArticles('user-1', { recentHours: 1 }).map((article) => article.id)).toEqual(['recent-read-later-article']);
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
      compactNewsCards: true,
      compactNewsCardsMode: 'everywhere',
      readerPanelPosition: 'left',
      readerTextSize: 'large',
      readerTextWidth: 'widest',
      lastSeenReleaseNotesVersion: '3.2.3',
      excludedSourceIds: [primarySourceFamilyId],
      excludedSubSourceIds: groupedSource ? [groupedSource.id] : []
    });

    expect(settings).toMatchObject({
      userId: 'user-1',
      defaultLanguage: 'en',
      compactNewsCards: true,
      compactNewsCardsMode: 'everywhere',
      readerPanelPosition: 'left',
      readerTextSize: 'large',
      readerTextWidth: 'widest',
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
        reader_panel_position,
        last_seen_release_notes_version,
        excluded_source_ids,
        excluded_sub_source_ids,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'user-1',
      'en',
      'right',
      '3.2.3',
      '{bad json',
      '"oops"',
      now
    );

    expect(database.getUserSettings('user-1')).toEqual(expect.objectContaining({
      userId: 'user-1',
      defaultLanguage: 'en',
      readerTextWidth: 'default',
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

    expect(database.getReaderCache('article-1', 0)).toBeNull();
  });

  test('loads reader cache entries in batches', () => {
    const now = new Date().toISOString();

    database.upsertArticles([
      {
        id: 'reader-batch-1',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Reader batch one',
        description: 'Reader description one',
        content: 'Reader content one',
        url: 'https://example.com/reader-batch-1',
        language: 'en',
        pubDate: now
      },
      {
        id: 'reader-batch-2',
        sourceId: primarySource.id,
        source: primarySource.name,
        title: 'Reader batch two',
        description: 'Reader description two',
        content: 'Reader content two',
        url: 'https://example.com/reader-batch-2',
        language: 'en',
        pubDate: now
      }
    ]);
    database.upsertReaderCache('reader-batch-1', {
      url: 'https://example.com/reader-batch-1',
      title: 'Reader batch one',
      contentText: 'Cached reader text one',
      contentBlocks: [{ type: 'paragraph', text: 'Cached reader text one' }],
      fetchedAt: now
    });
    database.upsertReaderCache('reader-batch-2', {
      url: 'https://example.com/reader-batch-2',
      title: 'Reader batch two',
      contentText: 'Cached reader text two',
      fetchedAt: now
    });

    const cacheByArticleId = database.getReaderCaches(['reader-batch-1', 'reader-batch-2', 'missing-reader']);

    expect(cacheByArticleId.get('reader-batch-1')).toEqual(expect.objectContaining({
      articleId: 'reader-batch-1',
      contentText: 'Cached reader text one',
      contentBlocks: [{ type: 'paragraph', text: 'Cached reader text one' }]
    }));
    expect(cacheByArticleId.get('reader-batch-2')).toEqual(expect.objectContaining({
      articleId: 'reader-batch-2',
      contentText: 'Cached reader text two'
    }));
    expect(cacheByArticleId.has('missing-reader')).toBe(false);
    expect(database.getReaderCaches(['reader-batch-1'], 0).size).toBe(0);
  });

  test('builds source and topic stats with canonical source ids and search filters', () => {
    const now = Date.now();
    const recentIso = new Date(now - (30 * 60 * 1000)).toISOString();
    database.createUser({ id: 'user-1', username: 'alice', passwordHash: null, createdAt: recentIso, updatedAt: recentIso });

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

    database.mergeTopicsForArticles([
      { articleId: 'global-1', topics: ['Economy', 'Markets'] },
      { articleId: 'global-2', topics: ['Science'] }
    ]);
    database.saveReadLaterArticles('user-1', ['global-1']);

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

    const readLaterOptions = { userId: 'user-1', readLaterUserId: 'user-1' };
    expect(database.getSourceStats([
      { id: groupedSourceFamilyId, name: groupedSourceFamilyName, language: 'it' },
      { id: secondarySourceFamilyId, name: secondarySourceFamilyName, language: 'en' }
    ], readLaterOptions)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: groupedSourceFamilyId, count: 1 }),
      expect.objectContaining({ id: secondarySourceFamilyId, count: 0 })
    ]));
    expect(database.getTopicStatsByFilters({}, 10, readLaterOptions)).toEqual([{ topic: 'Economia', count: 1 }]);
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
      readerPanelPosition: 'left',
      lastSeenReleaseNotesVersion: '3.2.3',
      excludedSourceIds: [primarySourceFamilyId]
    });
  });
});
