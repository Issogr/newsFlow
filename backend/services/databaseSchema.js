function createDatabaseSchema({ logger }) {
  const CURRENT_SCHEMA_VERSION = 15;

  function createPasswordSetupTokenTable(database) {
    database.exec(`
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
    `);
  }

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
  }

  function getCurrentSchemaVersion(database) {
    const row = database.prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'migration_version'
    `).get();

    return row ? Number(row.value) : null;
  }

  function columnExists(database, tableName, columnName) {
    return database.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
  }

  function setCurrentSchemaVersion(database) {
    database.prepare(`
      INSERT INTO app_meta (key, value)
      VALUES ('migration_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(CURRENT_SCHEMA_VERSION));
  }

  function ensureSupportedSchema(database) {
    const currentVersion = getCurrentSchemaVersion(database);

    if (currentVersion === null) {
      setCurrentSchemaVersion(database);
      logger.info(`Initialized DB schema version ${CURRENT_SCHEMA_VERSION}`);
      return;
    }

    let nextVersion = currentVersion;

    if (nextVersion === 10) {
      if (!columnExists(database, 'user_settings', 'show_news_images')) {
        database.exec(`
          ALTER TABLE user_settings
          ADD COLUMN show_news_images INTEGER NOT NULL DEFAULT 1
        `);
      }
      logger.info('Migrated DB schema from version 10 to 11: added show_news_images user setting');
      nextVersion = 11;
    }

    if (nextVersion === 11) {
      if (!columnExists(database, 'users', 'role')) {
        database.exec(`
          ALTER TABLE users
          ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
        `);
      }

      createPasswordSetupTokenTable(database);
      logger.info('Migrated DB schema from version 11 to 12: added user roles and password setup tokens');
      nextVersion = 12;
    }

    if (nextVersion === 12) {
      if (!columnExists(database, 'users', 'last_login_at')) {
        database.exec(`
          ALTER TABLE users
          ADD COLUMN last_login_at TEXT
        `);
      }

      if (!columnExists(database, 'users', 'last_activity_at')) {
        database.exec(`
          ALTER TABLE users
          ADD COLUMN last_activity_at TEXT
        `);
      }

      logger.info('Migrated DB schema from version 12 to 13: added user activity tracking');
      nextVersion = 13;
    }

    if (nextVersion === 13) {
      if (!columnExists(database, 'user_settings', 'reader_text_size')) {
        database.exec(`
          ALTER TABLE user_settings
          ADD COLUMN reader_text_size TEXT NOT NULL DEFAULT 'medium'
        `);
      }

      logger.info('Migrated DB schema from version 13 to 14: added reader text size user setting');
      nextVersion = 14;
    }

    if (nextVersion === 14) {
      if (!columnExists(database, 'user_settings', 'theme_mode')) {
        database.exec(`
          ALTER TABLE user_settings
          ADD COLUMN theme_mode TEXT NOT NULL DEFAULT 'system'
        `);
      }

      logger.info('Migrated DB schema from version 14 to 15: added theme mode user setting');
      nextVersion = 15;
    }

    if (nextVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported database schema version ${currentVersion}. Expected ${CURRENT_SCHEMA_VERSION}. Recreate the database file before starting this version of the app.`
      );
    }

    if (nextVersion !== currentVersion) {
      setCurrentSchemaVersion(database);
    }
  }

  return {
    CURRENT_SCHEMA_VERSION,
    initializeSchema,
    ensureSupportedSchema
  };
}

module.exports = createDatabaseSchema;
