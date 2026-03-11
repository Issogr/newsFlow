const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const logger = require('../utils/logger');
const configuredSources = require('../config/newsSources');
const topicNormalizer = require('./topicNormalizer');
const {
  buildDomainSourceGroups,
  getCanonicalSourceId,
  getCanonicalSourceName,
  getConfiguredSourceGroupIds,
  getLegacyConfiguredSourceGroupIds,
  getGroupedConfiguredSourceIds,
  getRawConfiguredSourceIds,
  getSourceAliases,
  getSourceVariantLabel
} = require('../utils/sourceCatalog');

const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = process.env.NEWS_DB_PATH || path.join(DATA_DIR, 'news.db');
const LATEST_MIGRATION_VERSION = 7;

let db;
let lastWriteCheckAt = null;

function chunkValues(values = [], size = 200) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function getSourceFilterClauses(sourceIds = [], options = {}) {
  const aliasedIds = new Set();
  const aliasedNames = new Set();

  sourceIds.forEach((sourceId) => {
    const aliases = getResolvedSourceAliases(sourceId, null, options.userId || null);
    aliases.ids.forEach((id) => aliasedIds.add(id));
    aliases.names.forEach((name) => aliasedNames.add(name));
  });

  const clauses = [];
  const params = [];

  if (aliasedIds.size > 0) {
    clauses.push(`a.source_id IN (${[...aliasedIds].map(() => '?').join(', ')})`);
    params.push(...aliasedIds);
  }

  if (aliasedNames.size > 0) {
    clauses.push(`a.source_name IN (${[...aliasedNames].map(() => '?').join(', ')})`);
    params.push(...aliasedNames);
  }

  return {
    clause: clauses.length > 1 ? `(${clauses.join(' OR ')})` : (clauses[0] || ''),
    params
  };
}

function getSourceExclusionClause(sourceIds = [], options = {}) {
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
    return null;
  }

  const sourceFilter = getSourceFilterClauses(sourceIds, options);
  if (!sourceFilter.clause) {
    return null;
  }

  return {
    clause: `NOT (${sourceFilter.clause})`,
    params: sourceFilter.params
  };
}

function getSubSourceExclusionClause(subSourceIds = []) {
  if (!Array.isArray(subSourceIds) || subSourceIds.length === 0) {
    return null;
  }

  return {
    clause: `a.source_id NOT IN (${subSourceIds.map(() => '?').join(', ')})`,
    params: subSourceIds
  };
}

function getCustomSourceGroups(userId) {
  if (!userId) {
    return new Map();
  }

  return buildDomainSourceGroups(listUserSources(userId));
}

function resolveCustomSourceGroup(sourceId, sourceName, userId) {
  if (!userId) {
    return null;
  }

  const customSourceGroups = getCustomSourceGroups(userId);

  for (const group of customSourceGroups.values()) {
    if (group.id === sourceId || group.memberIds.has(sourceId) || group.memberNames.has(sourceName)) {
      return group;
    }
  }

  return null;
}

function getResolvedSourceAliases(sourceId, sourceName, userId) {
  const configuredAliases = getSourceAliases(sourceId, sourceName);
  const customSourceGroup = resolveCustomSourceGroup(sourceId, sourceName, userId);

  if (!customSourceGroup) {
    return configuredAliases;
  }

  return {
    ids: [...new Set([...configuredAliases.ids, customSourceGroup.id, ...customSourceGroup.memberIds])],
    names: [...new Set([...configuredAliases.names, customSourceGroup.name, ...customSourceGroup.memberNames])]
  };
}

function getResolvedSourceMetadata(sourceId, sourceName, userId) {
  const configuredSourceId = getCanonicalSourceId(sourceId, sourceName);
  const configuredSourceName = getCanonicalSourceName(sourceId, sourceName);
  const configuredSubSource = getSourceVariantLabel(sourceId, sourceName);

  if (configuredSourceId !== sourceId || configuredSourceName !== sourceName || configuredSubSource) {
    return {
      sourceId: configuredSourceId,
      sourceName: configuredSourceName,
      subSource: configuredSubSource
    };
  }

  const customSourceGroup = resolveCustomSourceGroup(sourceId, sourceName, userId);
  if (!customSourceGroup) {
    return {
      sourceId,
      sourceName,
      subSource: null
    };
  }

  return {
    sourceId: customSourceGroup.id,
    sourceName: customSourceGroup.name,
    subSource: customSourceGroup.subSources.length > 1
      ? (customSourceGroup.subSources.find((subSource) => subSource.id === sourceId)?.label || null)
      : null
  };
}

function buildScopeFilter(options = {}, alias = 'a') {
  if (options.userId) {
    return {
      clause: `(${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id = ?)`,
      params: [options.userId]
    };
  }

  return {
    clause: `${alias}.owner_user_id IS NULL`,
    params: []
  };
}

function buildRetentionFilter(options = {}, alias = 'a') {
  if (!options.maxArticleAgeHours || !Number.isFinite(options.maxArticleAgeHours) || options.maxArticleAgeHours <= 0) {
    return null;
  }

  return {
    clause: `${alias}.published_at >= ?`,
    params: [new Date(Date.now() - (options.maxArticleAgeHours * 60 * 60 * 1000)).toISOString()]
  };
}

function ensureDatabaseDirectory() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function getDb() {
  if (db) {
    return db;
  }

  ensureDatabaseDirectory();
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');

  initializeSchema(db);
  runMigrations(db);
  logger.info(`SQLite database ready at ${DB_PATH}`);

  return db;
}

function closeDb() {
  if (!db) {
    lastWriteCheckAt = null;
    return;
  }

  db.close();
  db = null;
  lastWriteCheckAt = null;
}

function verifyWriteAccess() {
  const database = getDb();
  const probeValue = new Date().toISOString();
  const writeProbe = database.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES ('__write_check__', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const rollbackError = new Error('__ROLLBACK_WRITE_CHECK__');

  try {
    database.transaction(() => {
      writeProbe.run(probeValue);
      throw rollbackError;
    })();
  } catch (error) {
    if (error !== rollbackError) {
      throw error;
    }
  }

  lastWriteCheckAt = new Date().toISOString();
  return {
    writable: true,
    checkedAt: lastWriteCheckAt
  };
}

function getWriteAccessStatus() {
  return {
    writable: Boolean(lastWriteCheckAt),
    checkedAt: lastWriteCheckAt
  };
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
}

function columnExists(database, tableName, columnName) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
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
      const excludedSourceIds = row.excludedSourceIds ? JSON.parse(row.excludedSourceIds) : [];
      const nextExcludedSourceIds = [...new Set(excludedSourceIds
        .map((sourceId) => getResolvedSourceMetadata(sourceId, null, row.userId).sourceId)
        .filter((sourceId) => configuredSourceGroupIds.has(sourceId) || customSourceGroupIds.has(sourceId)))];

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

function buildFilterState(filters = {}) {
  return {
    search: typeof filters.search === 'string' ? filters.search.trim() : '',
    sourceIds: Array.isArray(filters.sourceIds) ? filters.sourceIds.filter(Boolean) : [],
    topics: Array.isArray(filters.topics) ? filters.topics.filter(Boolean) : [],
    recentHours: Number.isFinite(filters.recentHours) ? filters.recentHours : null,
    limit: Math.max(1, Math.min(Number(filters.limit) || 50, 250)),
    offset: Math.max(0, Number(filters.offset) || 0)
  };
}

function buildSearchQuery(search) {
  const tokens = String(search || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .slice(0, 8);

  if (tokens.length === 0) {
    return '';
  }

  return tokens.map((token) => `${token}*`).join(' AND ');
}

function buildArticleQuery(filters = {}, options = {}) {
  const state = buildFilterState(filters);
  const params = [];
  const joins = [];
  const where = [];
  const searchQuery = buildSearchQuery(state.search);
  const scopeFilter = buildScopeFilter(options, 'a');
  const retentionFilter = buildRetentionFilter(options, 'a');
  const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
  const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);

  where.push(scopeFilter.clause);
  params.push(...scopeFilter.params);

  if (retentionFilter) {
    where.push(retentionFilter.clause);
    params.push(...retentionFilter.params);
  }

  if (excludedSourceFilter) {
    where.push(excludedSourceFilter.clause);
    params.push(...excludedSourceFilter.params);
  }

  if (excludedSubSourceFilter) {
    where.push(excludedSubSourceFilter.clause);
    params.push(...excludedSubSourceFilter.params);
  }

  if (searchQuery) {
    joins.push('JOIN article_search ON article_search.article_id = a.id');
    where.push('article_search MATCH ?');
    params.push(searchQuery);
  }

  if (state.sourceIds.length > 0) {
    const sourceFilter = getSourceFilterClauses(state.sourceIds, options);
    where.push(`(${sourceFilter.clause})`);
    params.push(...sourceFilter.params);
  }

  if (state.topics.length > 0) {
    where.push(`a.id IN (
      SELECT article_id
      FROM article_topics
      WHERE topic IN (${state.topics.map(() => '?').join(', ')})
    )`);
    params.push(...state.topics);
  }

  if (state.recentHours) {
    const recentThreshold = new Date(Date.now() - (state.recentHours * 60 * 60 * 1000)).toISOString();
    where.push('a.published_at >= ?');
    params.push(recentThreshold);
  }

  const sql = `
    SELECT
      a.id,
      a.source_id AS sourceId,
      a.source_name AS source,
      a.title,
      a.description,
      a.content,
      a.url,
      a.image,
      a.author,
      a.language,
      a.published_at AS pubDate
    FROM articles a
    ${joins.join('\n')}
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY datetime(a.published_at) DESC, a.id DESC
    LIMIT ? OFFSET ?
  `;

  params.push(state.limit, state.offset);

  return { sql, params };
}

function getTopicsByArticleIds(articleIds) {
  if (!Array.isArray(articleIds) || articleIds.length === 0) {
    return new Map();
  }

  const database = getDb();
  const rows = database.prepare(`
    SELECT article_id AS articleId, topic
    FROM article_topics
    WHERE article_id IN (${articleIds.map(() => '?').join(', ')})
    ORDER BY topic ASC
  `).all(...articleIds);

  const topicMap = new Map();
  rows.forEach((row) => {
    const topics = topicMap.get(row.articleId) || [];
    topics.push(row.topic);
    topicMap.set(row.articleId, topics);
  });

  return topicMap;
}

function hydrateArticleRows(rows, options = {}) {
  const articleIds = rows.map((row) => row.id);
  const topicMap = getTopicsByArticleIds(articleIds);

  return rows.map((row) => {
    const sourceMetadata = getResolvedSourceMetadata(row.sourceId, row.source, options.userId || row.ownerUserId || null);

    return {
      ...row,
      rawSourceId: row.sourceId,
      rawSource: row.source,
      sourceId: sourceMetadata.sourceId,
      source: sourceMetadata.sourceName,
      subSource: sourceMetadata.subSource,
      topics: (topicMap.get(row.id) || []).filter((topic) => topicNormalizer.isCanonicalTopic(topic))
    };
  });
}

function upsertArticles(articles = []) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return {
      insertedIds: [],
      updatedIds: [],
      insertedCount: 0,
      updatedCount: 0
    };
  }

  const database = getDb();
  const now = new Date().toISOString();
  const upsertStmt = database.prepare(`
    INSERT INTO articles (
      id,
      source_id,
      source_name,
      owner_user_id,
      title,
      description,
      content,
      url,
      image,
      author,
      language,
      published_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_id = excluded.source_id,
      source_name = excluded.source_name,
      owner_user_id = excluded.owner_user_id,
      title = excluded.title,
      description = excluded.description,
      content = excluded.content,
      url = excluded.url,
      image = excluded.image,
      author = excluded.author,
      language = excluded.language,
      published_at = excluded.published_at,
      updated_at = excluded.updated_at
  `);
  const deleteSearchStmt = database.prepare('DELETE FROM article_search WHERE article_id = ?');
  const insertSearchStmt = database.prepare(`
    INSERT INTO article_search (article_id, title, description, content)
    VALUES (?, ?, ?, ?)
  `);
  const existingIdSet = new Set(
    chunkValues(articles.map((article) => article.id).filter(Boolean)).flatMap((articleIds) => {
      return database.prepare(`
        SELECT id
        FROM articles
        WHERE id IN (${articleIds.map(() => '?').join(', ')})
      `).all(...articleIds).map((row) => row.id);
    })
  );

  const transaction = database.transaction((items) => {
    const insertedIds = [];
    const updatedIds = [];

    items.forEach((article) => {
      const exists = existingIdSet.has(article.id);

      upsertStmt.run(
        article.id,
        article.rawSourceId || article.sourceId,
        article.rawSource || article.source,
        article.ownerUserId || null,
        article.title,
        article.description || '',
        article.content || '',
        article.url || '',
        article.image || null,
        article.author || null,
        article.language || 'it',
        article.pubDate,
        article.createdAt || now,
        now
      );

      deleteSearchStmt.run(article.id);
      insertSearchStmt.run(article.id, article.title, article.description || '', article.content || '');

      if (exists) {
        updatedIds.push(article.id);
      } else {
        insertedIds.push(article.id);
      }
    });

    return {
      insertedIds,
      updatedIds,
      insertedCount: insertedIds.length,
      updatedCount: updatedIds.length
    };
  });

  return transaction(articles);
}

function mergeTopicsForArticle(articleId, topics = []) {
  if (!articleId || !Array.isArray(topics) || topics.length === 0) {
    return [];
  }

  const database = getDb();
  const selectStmt = database.prepare('SELECT topic FROM article_topics WHERE article_id = ? ORDER BY topic ASC');
  const insertStmt = database.prepare(`
    INSERT OR IGNORE INTO article_topics (article_id, topic)
    VALUES (?, ?)
  `);

  const transaction = database.transaction((articleIdentifier, topicList) => {
    topicList
      .map((topic) => topicNormalizer.normalizeTopic(topic))
      .filter((topic) => topicNormalizer.isCanonicalTopic(topic))
      .forEach((topic) => {
        insertStmt.run(articleIdentifier, topic);
      });

    return selectStmt
      .all(articleIdentifier)
      .map((row) => row.topic)
      .filter((topic) => topicNormalizer.isCanonicalTopic(topic));
  });

  return transaction(articleId, topics);
}

function mergeTopicsForArticles(entries = []) {
  const normalizedEntries = Array.isArray(entries)
    ? entries.filter((entry) => entry?.articleId && Array.isArray(entry.topics) && entry.topics.length > 0)
    : [];

  if (normalizedEntries.length === 0) {
    return 0;
  }

  const database = getDb();
  const insertStmt = database.prepare(`
    INSERT OR IGNORE INTO article_topics (article_id, topic)
    VALUES (?, ?)
  `);

  const transaction = database.transaction((items) => {
    let insertedCount = 0;

    items.forEach(({ articleId, topics }) => {
      topics
        .map((topic) => topicNormalizer.normalizeTopic(topic))
        .filter((topic) => topicNormalizer.isCanonicalTopic(topic))
        .forEach((topic) => {
          insertedCount += insertStmt.run(articleId, topic).changes;
        });
    });

    return insertedCount;
  });

  return transaction(normalizedEntries);
}

function getArticles(filters = {}, options = {}) {
  const database = getDb();
  const { sql, params } = buildArticleQuery(filters, options);
  const rows = database.prepare(sql).all(...params);
  return hydrateArticleRows(rows, options);
}

function getArticleById(articleId, options = {}) {
  if (!articleId) {
    return null;
  }

  return getArticlesByIds([articleId], options)[0] || null;
}

function getArticlesByIds(articleIds = [], options = {}) {
  if (!Array.isArray(articleIds) || articleIds.length === 0) {
    return [];
  }

  const params = [...articleIds];
  const where = [`a.id IN (${articleIds.map(() => '?').join(', ')})`];
  const scopeFilter = buildScopeFilter(options, 'a');
  const retentionFilter = buildRetentionFilter(options, 'a');
  const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
  const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);

  where.push(scopeFilter.clause);
  params.push(...scopeFilter.params);

  if (retentionFilter) {
    where.push(retentionFilter.clause);
    params.push(...retentionFilter.params);
  }

  if (excludedSourceFilter) {
    where.push(excludedSourceFilter.clause);
    params.push(...excludedSourceFilter.params);
  }

  if (excludedSubSourceFilter) {
    where.push(excludedSubSourceFilter.clause);
    params.push(...excludedSubSourceFilter.params);
  }

  const rows = getDb().prepare(`
    SELECT
      a.id,
      a.source_id AS sourceId,
      a.source_name AS source,
      a.title,
      a.description,
      a.content,
      a.url,
      a.image,
      a.author,
      a.language,
      a.published_at AS pubDate
    FROM articles a
    WHERE ${where.join(' AND ')}
    ORDER BY datetime(a.published_at) DESC, a.id DESC
  `).all(...params);

  return hydrateArticleRows(rows, options);
}

function countArticles(options = {}) {
  const scopeFilter = buildScopeFilter(options, 'articles');
  const retentionFilter = buildRetentionFilter(options, 'articles');
  const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
  const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);
  const where = [scopeFilter.clause];
  const params = [...scopeFilter.params];

  if (retentionFilter) {
    where.push(retentionFilter.clause);
    params.push(...retentionFilter.params);
  }

  if (excludedSourceFilter) {
    where.push(excludedSourceFilter.clause.replaceAll('a.', 'articles.'));
    params.push(...excludedSourceFilter.params);
  }

  if (excludedSubSourceFilter) {
    where.push(excludedSubSourceFilter.clause.replaceAll('a.', 'articles.'));
    params.push(...excludedSubSourceFilter.params);
  }

  return getDb().prepare(`
    SELECT COUNT(*) AS count
    FROM articles
    WHERE ${where.join(' AND ')}
  `).get(...params).count;
}

function deleteArticlesOlderThan(isoTimestamp) {
  if (!isoTimestamp) {
    return 0;
  }

  const database = getDb();
  const selectArticleIds = database.prepare(`
    SELECT id
    FROM articles
    WHERE published_at < ?
  `);
  const deleteSearchEntries = database.prepare(`
    DELETE FROM article_search
    WHERE article_id = ?
  `);
  const deleteArticle = database.prepare(`
    DELETE FROM articles
    WHERE id = ?
  `);

  const transaction = database.transaction((threshold) => {
    const articleIds = selectArticleIds.all(threshold).map((row) => row.id);

    articleIds.forEach((articleId) => {
      deleteSearchEntries.run(articleId);
      deleteArticle.run(articleId);
    });

    return articleIds.length;
  });

  return transaction(isoTimestamp);
}

function cleanupRemovedConfiguredSourceData() {
  const database = getDb();
  const rawConfiguredSourceIds = getRawConfiguredSourceIds();
  const configuredSourceGroupIds = getConfiguredSourceGroupIds();
  const legacyConfiguredSourceGroupIds = getLegacyConfiguredSourceGroupIds();
  const groupedConfiguredSourceIds = getGroupedConfiguredSourceIds();
  const selectGlobalArticles = database.prepare(`
    SELECT id, source_id AS sourceId, source_name AS sourceName
    FROM articles
    WHERE owner_user_id IS NULL
  `);
  const deleteSearchEntries = database.prepare(`
    DELETE FROM article_search
    WHERE article_id = ?
  `);
  const deleteArticle = database.prepare(`
    DELETE FROM articles
    WHERE id = ?
  `);
  const selectSettings = database.prepare(`
    SELECT user_id AS userId,
           default_source_ids AS excludedSourceIds,
           excluded_sub_source_ids AS excludedSubSourceIds
    FROM user_settings
  `);
  const selectUserSourceIds = database.prepare(`
    SELECT id
    FROM user_sources
    WHERE user_id = ?
  `);
  const updateSettings = database.prepare(`
    UPDATE user_settings
    SET default_source_ids = ?,
        excluded_sub_source_ids = ?,
        updated_at = ?
    WHERE user_id = ?
  `);

  const transaction = database.transaction(() => {
    let removedArticles = 0;
    let updatedSettings = 0;
    const now = new Date().toISOString();

    selectGlobalArticles.all().forEach((article) => {
      if (rawConfiguredSourceIds.has(article.sourceId) || configuredSourceGroupIds.has(article.sourceId) || legacyConfiguredSourceGroupIds.has(article.sourceId)) {
        return;
      }

      deleteSearchEntries.run(article.id);
      deleteArticle.run(article.id);
      removedArticles += 1;
    });

    selectSettings.all().forEach((row) => {
      const excludedSourceIds = row.excludedSourceIds ? JSON.parse(row.excludedSourceIds) : [];
      const excludedSubSourceIds = row.excludedSubSourceIds ? JSON.parse(row.excludedSubSourceIds) : [];
      const customSourceIds = new Set(selectUserSourceIds.all(row.userId).map((source) => source.id));
      const nextExcludedSourceIds = excludedSourceIds.filter((sourceId) => {
        return configuredSourceGroupIds.has(sourceId) || customSourceIds.has(sourceId);
      });
      const nextExcludedSubSourceIds = excludedSubSourceIds.filter((sourceId) => groupedConfiguredSourceIds.has(sourceId));

      if (
        nextExcludedSourceIds.length === excludedSourceIds.length
        && nextExcludedSubSourceIds.length === excludedSubSourceIds.length
      ) {
        return;
      }

      updateSettings.run(
        JSON.stringify(nextExcludedSourceIds),
        JSON.stringify(nextExcludedSubSourceIds),
        now,
        row.userId
      );
      updatedSettings += 1;
    });

    return {
      removedArticles,
      updatedSettings
    };
  });

  return transaction();
}

function getSourceStats(configuredSources = [], options = {}) {
  const scopeFilter = buildScopeFilter(options, 'articles');
  const retentionFilter = buildRetentionFilter(options, 'articles');
  const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
  const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);
  const where = [scopeFilter.clause];
  const params = [...scopeFilter.params];

  if (retentionFilter) {
    where.push(retentionFilter.clause);
    params.push(...retentionFilter.params);
  }

  if (excludedSourceFilter) {
    where.push(excludedSourceFilter.clause.replaceAll('a.', 'articles.'));
    params.push(...excludedSourceFilter.params);
  }

  if (excludedSubSourceFilter) {
    where.push(excludedSubSourceFilter.clause.replaceAll('a.', 'articles.'));
    params.push(...excludedSubSourceFilter.params);
  }

  const rows = getDb().prepare(`
    SELECT source_id AS id, source_name AS name, COUNT(*) AS count
    FROM articles
    WHERE ${where.join(' AND ')}
    GROUP BY source_id, source_name
    ORDER BY count DESC, name ASC
  `).all(...params);

  const aggregatedRows = rows.reduce((map, row) => {
    const sourceMetadata = getResolvedSourceMetadata(row.id, row.name, options.userId || null);
    const canonicalId = sourceMetadata.sourceId;
    const current = map.get(canonicalId) || {
      id: canonicalId,
      name: sourceMetadata.sourceName,
      count: 0
    };

    current.count += row.count;
    map.set(canonicalId, current);
    return map;
  }, new Map());

  const merged = configuredSources.map((source) => ({
    id: source.id,
    name: source.name,
    language: source.language,
    count: aggregatedRows.get(source.id)?.count || 0
  }));

  aggregatedRows.forEach((row) => {
    if (!configuredSources.some((source) => source.id === row.id)) {
      merged.push({ ...row, language: null });
    }
  });

  return merged.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function getTopicStatsByFilters(filters = {}, limit = 20, options = {}) {
  const state = buildFilterState(filters);
  const params = [];
  const joins = ['JOIN articles a ON a.id = article_topics.article_id'];
  const where = [];
  const searchQuery = buildSearchQuery(state.search);
  const scopeFilter = buildScopeFilter(options, 'a');
  const retentionFilter = buildRetentionFilter(options, 'a');
  const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
  const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);

  where.push(scopeFilter.clause);
  params.push(...scopeFilter.params);

  if (retentionFilter) {
    where.push(retentionFilter.clause);
    params.push(...retentionFilter.params);
  }

  if (excludedSourceFilter) {
    where.push(excludedSourceFilter.clause);
    params.push(...excludedSourceFilter.params);
  }

  if (excludedSubSourceFilter) {
    where.push(excludedSubSourceFilter.clause);
    params.push(...excludedSubSourceFilter.params);
  }

  if (searchQuery) {
    joins.push('JOIN article_search ON article_search.article_id = a.id');
    where.push('article_search MATCH ?');
    params.push(searchQuery);
  }

  if (state.sourceIds.length > 0) {
    const sourceFilter = getSourceFilterClauses(state.sourceIds, options);
    where.push(`(${sourceFilter.clause})`);
    params.push(...sourceFilter.params);
  }

  if (state.recentHours) {
    const recentThreshold = new Date(Date.now() - (state.recentHours * 60 * 60 * 1000)).toISOString();
    where.push('a.published_at >= ?');
    params.push(recentThreshold);
  }

  const rows = getDb().prepare(`
    SELECT article_topics.topic AS topic, COUNT(*) AS count
    FROM article_topics
    ${joins.join('\n')}
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY article_topics.topic
    ORDER BY count DESC, article_topics.topic ASC
  `).all(...params);

  return rows
    .filter((row) => topicNormalizer.isCanonicalTopic(row.topic))
    .slice(0, limit);
}

function createIngestionRun() {
  const startedAt = new Date().toISOString();
  const result = getDb().prepare(`
    INSERT INTO ingestion_runs (started_at, status)
    VALUES (?, 'running')
  `).run(startedAt);

  return {
    id: result.lastInsertRowid,
    startedAt
  };
}

function completeIngestionRun(runId, result = {}) {
  if (!runId) {
    return;
  }

  getDb().prepare(`
    UPDATE ingestion_runs
    SET completed_at = ?,
        status = ?,
        fetched_count = ?,
        inserted_count = ?,
        updated_count = ?,
        error_message = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(),
    result.status || 'completed',
    result.fetchedCount || 0,
    result.insertedCount || 0,
    result.updatedCount || 0,
    result.errorMessage || null,
    runId
  );
}

function getLatestIngestionRun() {
  return getDb().prepare(`
    SELECT id, started_at AS startedAt, completed_at AS completedAt, status,
           fetched_count AS fetchedCount, inserted_count AS insertedCount,
           updated_count AS updatedCount, error_message AS errorMessage
    FROM ingestion_runs
    ORDER BY id DESC
    LIMIT 1
  `).get();
}

function getReaderCache(articleId, maxAgeMs) {
  if (!articleId) {
    return null;
  }

  const row = getDb().prepare(`
    SELECT article_id AS articleId, url, title, site_name AS siteName,
           byline, language, excerpt, content_text AS contentText,
           content_blocks AS contentBlocks, minutes_to_read AS minutesToRead, fetched_at AS fetchedAt
    FROM reader_cache
    WHERE article_id = ?
  `).get(articleId);

  if (!row) {
    return null;
  }

  if (maxAgeMs) {
    const ageMs = Date.now() - new Date(row.fetchedAt).getTime();
    if (ageMs > maxAgeMs) {
      return null;
    }
  }

  return {
    ...row,
    contentBlocks: row.contentBlocks ? JSON.parse(row.contentBlocks) : null
  };
}

function upsertReaderCache(articleId, payload = {}) {
  if (!articleId || !payload.contentText) {
    return;
  }

  getDb().prepare(`
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
  `).run(
    articleId,
    payload.url || '',
    payload.title || '',
    payload.siteName || null,
    payload.byline || null,
    payload.language || null,
    payload.excerpt || null,
    payload.contentText,
    Array.isArray(payload.contentBlocks) ? JSON.stringify(payload.contentBlocks) : null,
    payload.minutesToRead || 1,
    payload.fetchedAt || new Date().toISOString()
  );
}

function createUser(user = {}) {
  getDb().prepare(`
    INSERT INTO users (id, username, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    user.id,
    user.username,
    user.passwordHash || null,
    user.createdAt,
    user.updatedAt
  );
}

function findUserByUsername(username) {
  if (!username) {
    return null;
  }

  return getDb().prepare(`
    SELECT id, username, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt
    FROM users
    WHERE lower(username) = lower(?)
  `).get(username);
}

function findUserById(userId) {
  if (!userId) {
    return null;
  }

  return getDb().prepare(`
    SELECT id, username, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt
    FROM users
    WHERE id = ?
  `).get(userId);
}

function createUserSession(session = {}) {
  getDb().prepare(`
    INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(session.tokenHash, session.userId, session.createdAt, session.expiresAt);
}

function findSessionByTokenHash(tokenHash) {
  if (!tokenHash) {
    return null;
  }

  return getDb().prepare(`
    SELECT user_sessions.token_hash AS tokenHash, user_sessions.user_id AS userId,
           user_sessions.created_at AS createdAt, user_sessions.expires_at AS expiresAt,
           users.username AS username
    FROM user_sessions
    JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.token_hash = ?
  `).get(tokenHash);
}

function deleteSessionByTokenHash(tokenHash) {
  if (!tokenHash) {
    return 0;
  }

  return getDb().prepare(`
    DELETE FROM user_sessions
    WHERE token_hash = ?
  `).run(tokenHash).changes;
}

function purgeExpiredSessions() {
  return getDb().prepare(`
    DELETE FROM user_sessions
    WHERE expires_at < ?
  `).run(new Date().toISOString()).changes;
}

function getUserSettings(userId) {
  if (!userId) {
    return null;
  }

  const row = getDb().prepare(`
    SELECT user_id AS userId, default_language AS defaultLanguage,
           article_retention_hours AS articleRetentionHours,
           recent_hours AS recentHours,
           auto_refresh_enabled AS autoRefreshEnabled,
           default_source_ids AS excludedSourceIds,
           excluded_sub_source_ids AS excludedSubSourceIds,
           updated_at AS updatedAt
    FROM user_settings
    WHERE user_id = ?
  `).get(userId);

  if (!row) {
    return null;
  }

  return {
    ...row,
    autoRefreshEnabled: Boolean(row.autoRefreshEnabled),
    excludedSourceIds: row.excludedSourceIds ? JSON.parse(row.excludedSourceIds) : [],
    excludedSubSourceIds: row.excludedSubSourceIds ? JSON.parse(row.excludedSubSourceIds) : []
  };
}

function upsertUserSettings(userId, settings = {}) {
  const now = new Date().toISOString();

  getDb().prepare(`
    INSERT INTO user_settings (
      user_id,
      default_language,
      article_retention_hours,
      recent_hours,
      auto_refresh_enabled,
      default_source_ids,
      excluded_sub_source_ids,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      default_language = excluded.default_language,
      article_retention_hours = excluded.article_retention_hours,
      recent_hours = excluded.recent_hours,
      auto_refresh_enabled = excluded.auto_refresh_enabled,
      default_source_ids = excluded.default_source_ids,
      excluded_sub_source_ids = excluded.excluded_sub_source_ids,
      updated_at = excluded.updated_at
  `).run(
    userId,
    settings.defaultLanguage || 'auto',
    settings.articleRetentionHours || 24,
    settings.recentHours || 3,
    settings.autoRefreshEnabled === false ? 0 : 1,
    JSON.stringify(settings.excludedSourceIds || []),
    JSON.stringify(settings.excludedSubSourceIds || []),
    now
  );

  return getUserSettings(userId);
}

function listUserSources(userId) {
  if (!userId) {
    return [];
  }

  return getDb().prepare(`
    SELECT id, user_id AS userId, name, url, language,
           is_active AS isActive, created_at AS createdAt,
           updated_at AS updatedAt, validated_at AS validatedAt
    FROM user_sources
    WHERE user_id = ?
    ORDER BY datetime(created_at) DESC, name ASC
  `).all(userId).map((row) => ({
    ...row,
    isActive: Boolean(row.isActive)
  }));
}

function listAllActiveUserSources() {
  return getDb().prepare(`
    SELECT id, user_id AS userId, name, url, language,
           is_active AS isActive, created_at AS createdAt,
           updated_at AS updatedAt, validated_at AS validatedAt
    FROM user_sources
    WHERE is_active = 1
    ORDER BY datetime(created_at) DESC, name ASC
  `).all().map((row) => ({
    ...row,
    isActive: Boolean(row.isActive)
  }));
}

function createUserSource(source = {}) {
  getDb().prepare(`
    INSERT INTO user_sources (
      id, user_id, name, url, language, is_active, created_at, updated_at, validated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    source.id,
    source.userId,
    source.name,
    source.url,
    source.language || 'it',
    source.isActive ? 1 : 0,
    source.createdAt,
    source.updatedAt,
    source.validatedAt || null
  );
}

function findUserSourceById(userId, sourceId) {
  if (!userId || !sourceId) {
    return null;
  }

  const row = getDb().prepare(`
    SELECT id, user_id AS userId, name, url, language,
           is_active AS isActive, created_at AS createdAt,
           updated_at AS updatedAt, validated_at AS validatedAt
    FROM user_sources
    WHERE user_id = ? AND id = ?
  `).get(userId, sourceId);

  return row ? { ...row, isActive: Boolean(row.isActive) } : null;
}

function updateUserSource(userId, sourceId, updates = {}) {
  if (!userId || !sourceId) {
    return 0;
  }

  return getDb().prepare(`
    UPDATE user_sources
    SET name = ?,
        url = ?,
        language = ?,
        updated_at = ?,
        validated_at = ?
    WHERE user_id = ? AND id = ?
  `).run(
    updates.name,
    updates.url,
    updates.language,
    updates.updatedAt,
    updates.validatedAt || null,
    userId,
    sourceId
  ).changes;
}

function deleteArticlesForUserSource(userId, sourceId) {
  if (!userId || !sourceId) {
    return 0;
  }

  const database = getDb();
  const transaction = database.transaction((ownerId, customSourceId) => {
    database.prepare(`
      DELETE FROM article_search
      WHERE article_id IN (
        SELECT id FROM articles WHERE owner_user_id = ? AND source_id = ?
      )
    `).run(ownerId, customSourceId);

    return database.prepare(`
      DELETE FROM articles
      WHERE owner_user_id = ? AND source_id = ?
    `).run(ownerId, customSourceId).changes;
  });

  return transaction(userId, sourceId);
}

function deleteUserSource(userId, sourceId) {
  if (!userId || !sourceId) {
    return 0;
  }

  const database = getDb();
  const transaction = database.transaction((ownerId, customSourceId) => {
    const removed = database.prepare(`
      DELETE FROM user_sources
      WHERE user_id = ? AND id = ?
    `).run(ownerId, customSourceId).changes;

    database.prepare(`
      DELETE FROM article_search
      WHERE article_id IN (
        SELECT id FROM articles WHERE owner_user_id = ? AND source_id = ?
      )
    `).run(ownerId, customSourceId);

    database.prepare(`
      DELETE FROM articles
      WHERE owner_user_id = ? AND source_id = ?
    `).run(ownerId, customSourceId);

    return removed;
  });

  return transaction(userId, sourceId);
}

function deleteAllUserSources(userId) {
  if (!userId) {
    return 0;
  }

  const database = getDb();
  const transaction = database.transaction((ownerId) => {
    database.prepare(`
      DELETE FROM article_search
      WHERE article_id IN (
        SELECT id FROM articles WHERE owner_user_id = ?
      )
    `).run(ownerId);

    database.prepare(`
      DELETE FROM articles
      WHERE owner_user_id = ?
    `).run(ownerId);

    return database.prepare(`
      DELETE FROM user_sources
      WHERE user_id = ?
    `).run(ownerId).changes;
  });

  return transaction(userId);
}

function importUserState(userId, sources = [], settings = {}) {
  if (!userId) {
    return {
      settings: null,
      customSources: []
    };
  }

  const database = getDb();
  const now = new Date().toISOString();
  const insertSourceStmt = database.prepare(`
    INSERT INTO user_sources (
      id, user_id, name, url, language, is_active, created_at, updated_at, validated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertSettingsStmt = database.prepare(`
    INSERT INTO user_settings (
      user_id,
      default_language,
      article_retention_hours,
      recent_hours,
      auto_refresh_enabled,
      default_source_ids,
      excluded_sub_source_ids,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      default_language = excluded.default_language,
      article_retention_hours = excluded.article_retention_hours,
      recent_hours = excluded.recent_hours,
      auto_refresh_enabled = excluded.auto_refresh_enabled,
      default_source_ids = excluded.default_source_ids,
      excluded_sub_source_ids = excluded.excluded_sub_source_ids,
      updated_at = excluded.updated_at
  `);

  const transaction = database.transaction((ownerId, importedSources, nextSettings) => {
    database.prepare(`
      DELETE FROM article_search
      WHERE article_id IN (
        SELECT id FROM articles WHERE owner_user_id = ?
      )
    `).run(ownerId);

    database.prepare(`
      DELETE FROM articles
      WHERE owner_user_id = ?
    `).run(ownerId);

    database.prepare(`
      DELETE FROM user_sources
      WHERE user_id = ?
    `).run(ownerId);

    importedSources.forEach((source) => {
      insertSourceStmt.run(
        source.id,
        ownerId,
        source.name,
        source.url,
        source.language || 'it',
        source.isActive ? 1 : 0,
        source.createdAt,
        source.updatedAt,
        source.validatedAt || null
      );
    });

    upsertSettingsStmt.run(
      ownerId,
      nextSettings.defaultLanguage || 'auto',
      nextSettings.articleRetentionHours || 24,
      nextSettings.recentHours || 3,
      nextSettings.autoRefreshEnabled === false ? 0 : 1,
      JSON.stringify(nextSettings.excludedSourceIds || []),
      JSON.stringify(nextSettings.excludedSubSourceIds || []),
      nextSettings.updatedAt || now
    );
  });

  transaction(userId, sources, settings);

  return {
    settings: getUserSettings(userId),
    customSources: listUserSources(userId)
  };
}

module.exports = {
  getDb,
  closeDb,
  getArticles,
  getArticleById,
  getArticlesByIds,
  mergeTopicsForArticle,
  mergeTopicsForArticles,
  upsertArticles,
  countArticles,
  deleteArticlesOlderThan,
  cleanupRemovedConfiguredSourceData,
  getSourceStats,
  getTopicStatsByFilters,
  createIngestionRun,
  completeIngestionRun,
  getLatestIngestionRun,
  getReaderCache,
  upsertReaderCache,
  createUser,
  findUserByUsername,
  findUserById,
  createUserSession,
  findSessionByTokenHash,
  deleteSessionByTokenHash,
  purgeExpiredSessions,
  getUserSettings,
  upsertUserSettings,
  listUserSources,
  listAllActiveUserSources,
  createUserSource,
  findUserSourceById,
  updateUserSource,
  deleteArticlesForUserSource,
  deleteUserSource,
  deleteAllUserSources,
  importUserState,
  verifyWriteAccess,
  getWriteAccessStatus,
  buildSearchQuery
};
