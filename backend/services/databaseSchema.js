function createDatabaseSchema({ logger }) {
  const CURRENT_SCHEMA_VERSION = 20;

  function initializeSchema(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS articles (
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
        published_at TEXT NOT NULL,
        ai_topics_processed_at TEXT,
        ai_topics_status TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles (published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_articles_source_id ON articles (source_id);
      CREATE INDEX IF NOT EXISTS idx_articles_source_name ON articles (source_name);
      CREATE INDEX IF NOT EXISTS idx_articles_owner_user_id ON articles (owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_articles_canonical_url ON articles (canonical_url);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_owner_source_canonical_url
      ON articles (COALESCE(owner_user_id, ''), source_id, canonical_url)
      WHERE canonical_url != '';

      CREATE TABLE IF NOT EXISTS article_topics (
        article_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (article_id, topic),
        FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_article_topics_topic ON article_topics (topic);

      CREATE TABLE IF NOT EXISTS ingestion_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL,
        fetched_count INTEGER NOT NULL DEFAULT 0,
        inserted_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        last_login_at TEXT,
        last_activity_at TEXT,
        public_api_request_count INTEGER NOT NULL DEFAULT 0,
        public_api_last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);

      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        last_used_at TEXT,
        created_by_ip TEXT,
        last_used_ip TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens (user_id);
      CREATE INDEX IF NOT EXISTS idx_api_tokens_expires_at ON api_tokens (expires_at);
      CREATE INDEX IF NOT EXISTS idx_api_tokens_revoked_at ON api_tokens (revoked_at);

      CREATE TABLE IF NOT EXISTS password_setup_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL,
        created_by_user_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_password_setup_tokens_user_purpose
      ON password_setup_tokens (user_id, purpose, used_at);

      CREATE INDEX IF NOT EXISTS idx_password_setup_tokens_expires_at
      ON password_setup_tokens (expires_at);

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        default_language TEXT NOT NULL DEFAULT 'auto',
        theme_mode TEXT NOT NULL DEFAULT 'system',
        article_retention_hours INTEGER NOT NULL DEFAULT 24,
        recent_hours INTEGER NOT NULL DEFAULT 3,
        auto_refresh_enabled INTEGER NOT NULL DEFAULT 1,
        show_news_images INTEGER NOT NULL DEFAULT 1,
        compact_news_cards INTEGER NOT NULL DEFAULT 0,
        compact_news_cards_mode TEXT NOT NULL DEFAULT 'off',
        reader_panel_position TEXT NOT NULL DEFAULT 'right',
        reader_text_size TEXT NOT NULL DEFAULT 'medium',
        last_seen_release_notes_version TEXT NOT NULL DEFAULT '',
        default_source_ids TEXT NOT NULL DEFAULT '[]',
        excluded_sub_source_ids TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_sources (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'it',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        validated_at TEXT,
        UNIQUE(user_id, url),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_user_sources_user_id ON user_sources (user_id);

      CREATE TABLE IF NOT EXISTS reader_cache (
        article_id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        site_name TEXT,
        byline TEXT,
        language TEXT,
        excerpt TEXT,
        content_text TEXT NOT NULL,
        content_blocks TEXT,
        minutes_to_read INTEGER NOT NULL DEFAULT 1,
        fetched_at TEXT NOT NULL,
        FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(
        article_id UNINDEXED,
        title,
        description,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);

    if (getColumnNames(database, 'articles').has('ai_topics_processed_at')) {
      database.exec('CREATE INDEX IF NOT EXISTS idx_articles_ai_topics_processed_at ON articles (ai_topics_processed_at)');
    }
  }

  function getCurrentSchemaVersion(database) {
    const row = database.prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'migration_version'
    `).get();

    return row ? Number(row.value) : null;
  }

  function tableExists(database, tableName) {
    const row = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `).get(tableName);

    return Boolean(row);
  }

  function getColumnNames(database, tableName) {
    if (!tableExists(database, tableName)) {
      return new Set();
    }

    return new Set(database.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
  }

  function hasExistingApplicationSchema(database) {
    return ['articles', 'users', 'user_settings', 'user_sources'].some((tableName) => tableExists(database, tableName));
  }

  function inferLegacySchemaVersion(database) {
    if (!hasExistingApplicationSchema(database)) {
      return null;
    }

    const userSettingsColumns = getColumnNames(database, 'user_settings');
    const userColumns = getColumnNames(database, 'users');
    const articleColumns = getColumnNames(database, 'articles');

    if (!tableExists(database, 'api_tokens')) {
      return 15;
    }

    if (tableExists(database, 'user_settings') && !userSettingsColumns.has('compact_news_cards')) {
      return 16;
    }

    if (tableExists(database, 'user_settings') && !userSettingsColumns.has('compact_news_cards_mode')) {
      return 17;
    }

    if (!userColumns.has('public_api_request_count') || !userColumns.has('public_api_last_used_at')) {
      return 18;
    }

    if (!articleColumns.has('ai_topics_processed_at') || !articleColumns.has('ai_topics_status')) {
      return 19;
    }

    return CURRENT_SCHEMA_VERSION;
  }

  function setCurrentSchemaVersion(database) {
    database.prepare(`
      INSERT INTO app_meta (key, value)
      VALUES ('migration_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(CURRENT_SCHEMA_VERSION));
  }

  function migrateSchema(database, currentVersion) {
    if (currentVersion === 15) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS api_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          token_prefix TEXT NOT NULL,
          label TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          last_used_at TEXT,
          created_by_ip TEXT,
          last_used_ip TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens (user_id);
        CREATE INDEX IF NOT EXISTS idx_api_tokens_expires_at ON api_tokens (expires_at);
        CREATE INDEX IF NOT EXISTS idx_api_tokens_revoked_at ON api_tokens (revoked_at);
      `);

      database.prepare(`
        INSERT INTO app_meta (key, value)
        VALUES ('migration_version', '16')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run();

      logger.info('Migrated DB schema from version 15 to 16');
      migrateSchema(database, 16);
      return;
    }

    if (currentVersion === 16) {
      database.exec(`
        ALTER TABLE user_settings
        ADD COLUMN compact_news_cards INTEGER NOT NULL DEFAULT 0
      `);

      logger.info('Migrated DB schema from version 16 to 17');
      migrateSchema(database, 17);
      return;
    }

    if (currentVersion === 17) {
      database.exec(`
        ALTER TABLE user_settings
        ADD COLUMN compact_news_cards_mode TEXT NOT NULL DEFAULT 'off'
      `);
      database.exec(`
        UPDATE user_settings
        SET compact_news_cards_mode = CASE
          WHEN compact_news_cards = 1 THEN 'everywhere'
          ELSE 'off'
        END
      `);

      database.prepare(`
        INSERT INTO app_meta (key, value)
        VALUES ('migration_version', '18')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run();
      logger.info('Migrated DB schema from version 17 to 18');
      migrateSchema(database, 18);
      return;
    }

    if (currentVersion === 18) {
      database.exec(`
        ALTER TABLE users
        ADD COLUMN public_api_request_count INTEGER NOT NULL DEFAULT 0
      `);
      database.exec(`
        ALTER TABLE users
        ADD COLUMN public_api_last_used_at TEXT
      `);
      database.exec(`
        UPDATE api_tokens
        SET created_by_ip = NULL,
            last_used_ip = NULL
      `);

      database.prepare(`
        INSERT INTO app_meta (key, value)
        VALUES ('migration_version', '19')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run();
      logger.info('Migrated DB schema from version 18 to 19');
      migrateSchema(database, 19);
      return;
    }

    if (currentVersion === 19) {
      const articleColumns = getColumnNames(database, 'articles');
      if (!articleColumns.has('ai_topics_processed_at')) {
        database.exec(`
          ALTER TABLE articles
          ADD COLUMN ai_topics_processed_at TEXT
        `);
      }
      if (!articleColumns.has('ai_topics_status')) {
        database.exec(`
          ALTER TABLE articles
          ADD COLUMN ai_topics_status TEXT
        `);
      }
      database.exec(`
        UPDATE articles
        SET ai_topics_processed_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP),
            ai_topics_status = 'legacy'
        WHERE ai_topics_processed_at IS NULL
      `);
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_articles_ai_topics_processed_at ON articles (ai_topics_processed_at)
      `);

      setCurrentSchemaVersion(database);
      logger.info('Migrated DB schema from version 19 to 20');
      return;
    }

    throw new Error(
      `Unsupported database schema version ${currentVersion}. Expected ${CURRENT_SCHEMA_VERSION}. Recreate the database file before starting this version of the app.`
    );
  }

  function ensureSupportedSchema(database, options = {}) {
    const currentVersion = getCurrentSchemaVersion(database);

    if (currentVersion === null) {
      if (options.legacySchemaVersion && options.legacySchemaVersion !== CURRENT_SCHEMA_VERSION) {
        database.prepare(`
          INSERT INTO app_meta (key, value)
          VALUES ('migration_version', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(String(options.legacySchemaVersion));
        migrateSchema(database, options.legacySchemaVersion);
        return;
      }

      setCurrentSchemaVersion(database);
      logger.info(`Initialized DB schema version ${CURRENT_SCHEMA_VERSION}`);
      return;
    }

    if (currentVersion !== CURRENT_SCHEMA_VERSION) {
      migrateSchema(database, currentVersion);
    }
  }

  return {
    initializeSchema,
    ensureSupportedSchema,
    inferLegacySchemaVersion
  };
}

module.exports = createDatabaseSchema;
