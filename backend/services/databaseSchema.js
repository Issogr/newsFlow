function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createDatabaseSchema({
  logger,
  configuredSources,
  topicNormalizer,
  normalizeArticleUrl,
  getConfiguredSourceGroupIds,
  getLegacyConfiguredSourceGroupIds,
  getCustomSourceGroups,
  getResolvedSourceMetadata
}) {
  const LATEST_MIGRATION_VERSION = 10;

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

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        default_language TEXT NOT NULL DEFAULT 'auto',
        article_retention_hours INTEGER NOT NULL DEFAULT 24,
        recent_hours INTEGER NOT NULL DEFAULT 3,
        auto_refresh_enabled INTEGER NOT NULL DEFAULT 1,
        reader_panel_position TEXT NOT NULL DEFAULT 'right',
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

  function getCurrentMigrationVersion(database) {
    const row = database.prepare(`
      SELECT value
      FROM app_meta
      WHERE key = 'migration_version'
    `).get();

    return Number(row?.value || 0);
  }

  function setCurrentMigrationVersion(database, version) {
    database.prepare(`
      INSERT INTO app_meta (key, value)
      VALUES ('migration_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(version));
  }

  function runMigrations(database) {
    let currentVersion = getCurrentMigrationVersion(database);

    if (currentVersion >= LATEST_MIGRATION_VERSION) {
      return;
    }

    if (currentVersion < 1) {
      migrateToV1(database);
      currentVersion = 1;
      setCurrentMigrationVersion(database, currentVersion);
    }

    if (currentVersion < 2) {
      migrateToV2(database);
      currentVersion = 2;
      setCurrentMigrationVersion(database, currentVersion);
    }

    if (currentVersion < 3) {
      migrateToV3(database);
      currentVersion = 3;
      setCurrentMigrationVersion(database, currentVersion);
    }

    if (currentVersion < 4) {
      migrateToV4(database);
      currentVersion = 4;
      setCurrentMigrationVersion(database, currentVersion);
    }

    if (currentVersion < 5) {
      migrateToV5(database);
      currentVersion = 5;
      setCurrentMigrationVersion(database, currentVersion);
    }

    if (currentVersion < 6) {
      migrateToV6(database);
      currentVersion = 6;
      setCurrentMigrationVersion(database, currentVersion);
    }

    if (currentVersion < 7) {
      migrateToV7(database);
      currentVersion = 7;
      setCurrentMigrationVersion(database, currentVersion);
    }

    if (currentVersion < 8) {
      migrateToV8(database);
      currentVersion = 8;
      setCurrentMigrationVersion(database, currentVersion);
    }

    if (currentVersion < 9) {
      migrateToV9(database);
      currentVersion = 9;
      setCurrentMigrationVersion(database, currentVersion);
    }

    if (currentVersion < 10) {
      migrateToV10(database);
      currentVersion = 10;
      setCurrentMigrationVersion(database, currentVersion);
    }
  }

  function columnExists(database, tableName, columnName) {
    const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some((column) => column.name === columnName);
  }

  function getArticleScopeValue(ownerUserId) {
    return ownerUserId || '';
  }

  function buildCanonicalArticleKey(sourceId, ownerUserId, canonicalUrl) {
    const normalizedCanonicalUrl = normalizeArticleUrl(canonicalUrl);
    if (!sourceId || !normalizedCanonicalUrl) {
      return '';
    }

    return [getArticleScopeValue(ownerUserId), sourceId, normalizedCanonicalUrl].join('|');
  }

  function migrateToV1(database) {
    const hasLegacyTopicMetadataColumn = columnExists(database, 'article_topics', 'is_ai_generated');
    const selectTopics = database.prepare(`
      SELECT article_id AS articleId, topic
      FROM article_topics
      ORDER BY article_id ASC, topic ASC
    `);
    const upsertTopic = database.prepare(`
      INSERT OR IGNORE INTO article_topics (article_id, topic)
      VALUES (?, ?)
    `);
    const deleteTopic = database.prepare(`
      DELETE FROM article_topics
      WHERE article_id = ? AND topic = ?
    `);
    const updateArticleSource = database.prepare(`
      UPDATE articles
      SET source_id = ?, source_name = ?
      WHERE (source_id = ? OR source_id LIKE ? OR source_name = ?)
        AND (source_id != ? OR source_name != ?)
    `);

    const migrate = database.transaction(() => {
      let updatedSourceRows = 0;
      let removedTopicRows = 0;
      let normalizedTopicRows = 0;

      configuredSources.forEach((source) => {
        const result = updateArticleSource.run(
          source.id,
          source.name,
          source.id,
          `${source.id}-%`,
          source.name,
          source.id,
          source.name
        );

        updatedSourceRows += result.changes;
      });

      selectTopics.all().forEach((row) => {
        const normalizedTopic = topicNormalizer.normalizeTopic(row.topic);

        if (!normalizedTopic || !topicNormalizer.isCanonicalTopic(normalizedTopic)) {
          const deletion = deleteTopic.run(row.articleId, row.topic);
          removedTopicRows += deletion.changes;
          return;
        }

        if (normalizedTopic !== row.topic) {
          upsertTopic.run(row.articleId, normalizedTopic);
          const deletion = deleteTopic.run(row.articleId, row.topic);
          removedTopicRows += deletion.changes;
          normalizedTopicRows += 1;
        }
      });

      return {
        updatedSourceRows,
        removedTopicRows,
        normalizedTopicRows
      };
    });

    const result = migrate();
    logger.info(`Applied DB migration v1: ${result.updatedSourceRows} source rows updated, ${result.removedTopicRows} topic rows removed, ${result.normalizedTopicRows} topic rows normalized${hasLegacyTopicMetadataColumn ? ' (legacy topic metadata ignored)' : ''}`);
  }

  function migrateToV2(database) {
    if (!columnExists(database, 'reader_cache', 'content_blocks')) {
      database.exec('ALTER TABLE reader_cache ADD COLUMN content_blocks TEXT');
      logger.info('Applied DB migration v2: added reader_cache.content_blocks');
      return;
    }

    logger.info('DB migration v2 skipped: reader_cache.content_blocks already exists');
  }

  function migrateToV3(database) {
    if (!columnExists(database, 'articles', 'owner_user_id')) {
      database.exec('ALTER TABLE articles ADD COLUMN owner_user_id TEXT');
    }

    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_articles_owner_user_id ON articles (owner_user_id);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT,
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

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        default_language TEXT NOT NULL DEFAULT 'auto',
        article_retention_hours INTEGER NOT NULL DEFAULT 24,
        recent_hours INTEGER NOT NULL DEFAULT 3,
        auto_refresh_enabled INTEGER NOT NULL DEFAULT 1,
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
    `);

    logger.info('Applied DB migration v3: added user accounts, sessions, settings, sources, and article ownership');
  }

  function migrateToV4(database) {
    if (!columnExists(database, 'article_topics', 'is_ai_generated')) {
      logger.info('DB migration v4 skipped: article_topics already clean');
      return;
    }

    const previousForeignKeyState = database.pragma('foreign_keys', { simple: true });
    database.pragma('foreign_keys = OFF');

    try {
      database.transaction(() => {
        database.exec(`
          ALTER TABLE article_topics RENAME TO article_topics_legacy;

          CREATE TABLE article_topics (
            article_id TEXT NOT NULL,
            topic TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (article_id, topic),
            FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE
          );

          INSERT INTO article_topics (article_id, topic, created_at)
          SELECT article_id, topic, created_at
          FROM article_topics_legacy;

          DROP TABLE article_topics_legacy;

          CREATE INDEX IF NOT EXISTS idx_article_topics_topic ON article_topics (topic);
        `);
      })();
    } finally {
      database.pragma(`foreign_keys = ${previousForeignKeyState ? 'ON' : 'OFF'}`);
    }

    logger.info('Applied DB migration v4: removed legacy topic metadata column');
  }

  function migrateToV5(database) {
    if (columnExists(database, 'user_settings', 'excluded_sub_source_ids')) {
      logger.info('DB migration v5 skipped: user_settings already has excluded_sub_source_ids');
      return;
    }

    database.exec(`
      ALTER TABLE user_settings
      ADD COLUMN excluded_sub_source_ids TEXT NOT NULL DEFAULT '[]'
    `);

    logger.info('Applied DB migration v5: added excluded sub-source settings');
  }

  function migrateToV6(database) {
    const configuredSourceGroupIds = getConfiguredSourceGroupIds();
    const legacyConfiguredSourceGroupIds = getLegacyConfiguredSourceGroupIds();
    const selectSettings = database.prepare(`
      SELECT user_id AS userId, default_source_ids AS excludedSourceIds
      FROM user_settings
    `);
    const updateSettings = database.prepare(`
      UPDATE user_settings
      SET default_source_ids = ?, updated_at = ?
      WHERE user_id = ?
    `);

    const migrate = database.transaction(() => {
      let updatedSettings = 0;
      const now = new Date().toISOString();

      selectSettings.all().forEach((row) => {
        const customSourceGroupIds = new Set(getCustomSourceGroups(row.userId).keys());
        const excludedSourceIds = parseJsonArray(row.excludedSourceIds);
        const nextExcludedSourceIds = [...new Set(excludedSourceIds
          .map((sourceId) => getResolvedSourceMetadata(sourceId, null, row.userId).sourceId)
          .filter((sourceId) => configuredSourceGroupIds.has(sourceId) || legacyConfiguredSourceGroupIds.has(sourceId) || customSourceGroupIds.has(sourceId)))];

        if (JSON.stringify(nextExcludedSourceIds) === JSON.stringify(excludedSourceIds)) {
          return;
        }

        updateSettings.run(JSON.stringify(nextExcludedSourceIds), now, row.userId);
        updatedSettings += 1;
      });

      return updatedSettings;
    });

    const updatedSettings = migrate();
    logger.info(`Applied DB migration v6: normalized ${updatedSettings} saved source preference sets to registrable-domain source families`);
  }

  function migrateToV7(database) {
    if (columnExists(database, 'user_settings', 'auto_refresh_enabled')) {
      logger.info('DB migration v7 skipped: user_settings already has auto_refresh_enabled');
      return;
    }

    database.exec(`
      ALTER TABLE user_settings
      ADD COLUMN auto_refresh_enabled INTEGER NOT NULL DEFAULT 1
    `);

    logger.info('Applied DB migration v7: added auto refresh user setting');
  }

  function migrateToV8(database) {
    if (columnExists(database, 'user_settings', 'reader_panel_position')) {
      logger.info('DB migration v8 skipped: user_settings already has reader_panel_position');
      return;
    }

    database.exec(`
      ALTER TABLE user_settings
      ADD COLUMN reader_panel_position TEXT NOT NULL DEFAULT 'right'
    `);

    logger.info('Applied DB migration v8: added reader panel position user setting');
  }

  function migrateToV9(database) {
    if (columnExists(database, 'user_settings', 'last_seen_release_notes_version')) {
      logger.info('DB migration v9 skipped: user_settings already has last_seen_release_notes_version');
      return;
    }

    database.exec(`
      ALTER TABLE user_settings
      ADD COLUMN last_seen_release_notes_version TEXT NOT NULL DEFAULT ''
    `);

    logger.info('Applied DB migration v9: added last seen release notes version user setting');
  }

  function migrateToV10(database) {
    if (!columnExists(database, 'articles', 'canonical_url')) {
      database.exec(`
        ALTER TABLE articles
        ADD COLUMN canonical_url TEXT NOT NULL DEFAULT ''
      `);
    }

    const selectArticles = database.prepare(`
      SELECT
        id,
        source_id AS sourceId,
        owner_user_id AS ownerUserId,
        url,
        canonical_url AS canonicalUrl,
        published_at AS pubDate,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM articles
      ORDER BY datetime(updated_at) DESC, datetime(published_at) DESC, datetime(created_at) DESC, id DESC
    `);
    const updateCanonicalUrl = database.prepare(`
      UPDATE articles
      SET canonical_url = ?
      WHERE id = ?
    `);
    const selectTopics = database.prepare(`
      SELECT topic
      FROM article_topics
      WHERE article_id = ?
      ORDER BY topic ASC
    `);
    const insertTopic = database.prepare(`
      INSERT OR IGNORE INTO article_topics (article_id, topic)
      VALUES (?, ?)
    `);
    const deleteTopics = database.prepare(`
      DELETE FROM article_topics
      WHERE article_id = ?
    `);
    const selectReaderCache = database.prepare(`
      SELECT
        url,
        title,
        site_name AS siteName,
        byline,
        language,
        excerpt,
        content_text AS contentText,
        content_blocks AS contentBlocks,
        minutes_to_read AS minutesToRead,
        fetched_at AS fetchedAt
      FROM reader_cache
      WHERE article_id = ?
    `);
    const upsertReaderCacheStmt = database.prepare(`
      INSERT INTO reader_cache (
        article_id,
        url,
        title,
        site_name,
        byline,
        language,
        excerpt,
        content_text,
        content_blocks,
        minutes_to_read,
        fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(article_id) DO UPDATE SET
        url = excluded.url,
        title = excluded.title,
        site_name = excluded.site_name,
        byline = excluded.byline,
        language = excluded.language,
        excerpt = excluded.excerpt,
        content_text = excluded.content_text,
        content_blocks = excluded.content_blocks,
        minutes_to_read = excluded.minutes_to_read,
        fetched_at = excluded.fetched_at
    `);
    const deleteSearchEntry = database.prepare(`
      DELETE FROM article_search
      WHERE article_id = ?
    `);
    const deleteReaderCacheEntry = database.prepare(`
      DELETE FROM reader_cache
      WHERE article_id = ?
    `);
    const deleteArticle = database.prepare(`
      DELETE FROM articles
      WHERE id = ?
    `);

    const migrationResult = database.transaction(() => {
      let normalizedUrlCount = 0;
      let deduplicatedArticleCount = 0;
      const retainedArticlesByKey = new Map();

      selectArticles.all().forEach((article) => {
        const canonicalUrl = normalizeArticleUrl(article.canonicalUrl || article.url || '');
        if (canonicalUrl !== (article.canonicalUrl || '')) {
          updateCanonicalUrl.run(canonicalUrl, article.id);
          normalizedUrlCount += 1;
        }

        const canonicalKey = buildCanonicalArticleKey(article.sourceId, article.ownerUserId, canonicalUrl);
        if (!canonicalKey) {
          return;
        }

        const retainedArticle = retainedArticlesByKey.get(canonicalKey);
        if (!retainedArticle) {
          retainedArticlesByKey.set(canonicalKey, {
            ...article,
            canonicalUrl
          });
          return;
        }

        selectTopics.all(article.id).forEach((row) => {
          insertTopic.run(retainedArticle.id, row.topic);
        });

        const retainedReaderCache = selectReaderCache.get(retainedArticle.id);
        const duplicateReaderCache = selectReaderCache.get(article.id);
        if (!retainedReaderCache && duplicateReaderCache?.contentText) {
          upsertReaderCacheStmt.run(
            retainedArticle.id,
            duplicateReaderCache.url || '',
            duplicateReaderCache.title || '',
            duplicateReaderCache.siteName || null,
            duplicateReaderCache.byline || null,
            duplicateReaderCache.language || null,
            duplicateReaderCache.excerpt || null,
            duplicateReaderCache.contentText,
            duplicateReaderCache.contentBlocks || null,
            duplicateReaderCache.minutesToRead || 1,
            duplicateReaderCache.fetchedAt || new Date().toISOString()
          );
        }

        deleteSearchEntry.run(article.id);
        deleteReaderCacheEntry.run(article.id);
        deleteTopics.run(article.id);
        deleteArticle.run(article.id);
        deduplicatedArticleCount += 1;
      });

      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_articles_canonical_url ON articles (canonical_url);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_owner_source_canonical_url
        ON articles (COALESCE(owner_user_id, ''), source_id, canonical_url)
        WHERE canonical_url != '';
      `);

      return {
        normalizedUrlCount,
        deduplicatedArticleCount
      };
    })();

    logger.info(`Applied DB migration v10: normalized ${migrationResult.normalizedUrlCount} canonical article URLs and removed ${migrationResult.deduplicatedArticleCount} duplicate article rows`);
  }

  return {
    initializeSchema,
    runMigrations
  };
}

module.exports = createDatabaseSchema;
