const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const logger = require('../utils/logger');
const configuredSources = require('../config/newsSources');
const topicNormalizer = require('./topicNormalizer');

const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = process.env.NEWS_DB_PATH || path.join(DATA_DIR, 'news.db');

let db;

const configuredSourceById = new Map(configuredSources.map((source) => [source.id, source]));

function canonicalizeSourceId(sourceId, sourceName) {
  if (configuredSourceById.has(sourceId)) {
    return sourceId;
  }

  const matchedSource = configuredSources.find((source) => {
    return source.id === sourceId
      || String(sourceId || '').startsWith(`${source.id}-`)
      || source.name === sourceName;
  });

  return matchedSource?.id || sourceId;
}

function canonicalizeSourceName(sourceId, sourceName) {
  const canonicalId = canonicalizeSourceId(sourceId, sourceName);
  return configuredSourceById.get(canonicalId)?.name || sourceName;
}

function getSourceFilterClauses(sourceIds = []) {
  const clauses = [];
  const params = [];

  sourceIds.forEach((sourceId) => {
    const canonicalId = canonicalizeSourceId(sourceId);
    const canonicalName = configuredSourceById.get(canonicalId)?.name;

    clauses.push('(a.source_id = ? OR a.source_id LIKE ? OR a.source_name = ?)');
    params.push(canonicalId, `${canonicalId}-%`, canonicalName || canonicalId);
  });

  return {
    clause: clauses.join(' OR '),
    params
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
  logger.info(`SQLite database ready at ${DB_PATH}`);

  return db;
}

function initializeSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
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
      is_ai_generated INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS reader_cache (
      article_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      site_name TEXT,
      byline TEXT,
      language TEXT,
      excerpt TEXT,
      content_text TEXT NOT NULL,
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

function buildArticleQuery(filters = {}) {
  const state = buildFilterState(filters);
  const params = [];
  const joins = [];
  const where = [];
  const searchQuery = buildSearchQuery(state.search);

  if (searchQuery) {
    joins.push('JOIN article_search ON article_search.article_id = a.id');
    where.push('article_search MATCH ?');
    params.push(searchQuery);
  }

  if (state.sourceIds.length > 0) {
    const sourceFilter = getSourceFilterClauses(state.sourceIds);
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

function hydrateArticleRows(rows) {
  const articleIds = rows.map((row) => row.id);
  const topicMap = getTopicsByArticleIds(articleIds);

  return rows.map((row) => ({
    ...row,
    sourceId: canonicalizeSourceId(row.sourceId, row.source),
    source: canonicalizeSourceName(row.sourceId, row.source),
    topics: (topicMap.get(row.id) || []).filter((topic) => topicNormalizer.isMeaningfulTopic(topic))
  }));
}

function upsertArticles(articles = []) {
  const database = getDb();
  const now = new Date().toISOString();
  const selectStmt = database.prepare('SELECT id FROM articles WHERE id = ?');
  const upsertStmt = database.prepare(`
    INSERT INTO articles (
      id,
      source_id,
      source_name,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_id = excluded.source_id,
      source_name = excluded.source_name,
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

  const transaction = database.transaction((items) => {
    const insertedIds = [];
    const updatedIds = [];

    items.forEach((article) => {
      const exists = selectStmt.get(article.id);

      upsertStmt.run(
        article.id,
        article.sourceId,
        article.source,
        article.title,
        article.description || '',
        article.content || '',
        article.url || '',
        article.image || null,
        article.author || null,
        article.language || 'it',
        article.pubDate,
        exists ? article.createdAt || now : now,
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

function mergeTopicsForArticle(articleId, topics = [], options = {}) {
  if (!articleId || !Array.isArray(topics) || topics.length === 0) {
    return [];
  }

  const database = getDb();
  const selectStmt = database.prepare('SELECT topic FROM article_topics WHERE article_id = ? ORDER BY topic ASC');
  const insertStmt = database.prepare(`
    INSERT OR IGNORE INTO article_topics (article_id, topic, is_ai_generated)
    VALUES (?, ?, ?)
  `);

  const transaction = database.transaction((articleIdentifier, topicList) => {
    topicList
      .filter((topic) => topicNormalizer.isMeaningfulTopic(topic))
      .forEach((topic) => {
      insertStmt.run(articleIdentifier, topic, options.isAiGenerated ? 1 : 0);
      });

    return selectStmt
      .all(articleIdentifier)
      .map((row) => row.topic)
      .filter((topic) => topicNormalizer.isMeaningfulTopic(topic));
  });

  return transaction(articleId, topics);
}

function getTopicsForArticle(articleId) {
  if (!articleId) {
    return [];
  }

  return getDb().prepare(`
    SELECT topic
    FROM article_topics
    WHERE article_id = ?
    ORDER BY topic ASC
  `).all(articleId)
    .map((row) => row.topic)
    .filter((topic) => topicNormalizer.isMeaningfulTopic(topic));
}

function getArticles(filters = {}) {
  const database = getDb();
  const { sql, params } = buildArticleQuery(filters);
  const rows = database.prepare(sql).all(...params);
  return hydrateArticleRows(rows);
}

function getArticleById(articleId) {
  if (!articleId) {
    return null;
  }

  return getArticlesByIds([articleId])[0] || null;
}

function getArticlesByIds(articleIds = []) {
  if (!Array.isArray(articleIds) || articleIds.length === 0) {
    return [];
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
    WHERE a.id IN (${articleIds.map(() => '?').join(', ')})
    ORDER BY datetime(a.published_at) DESC, a.id DESC
  `).all(...articleIds);

  return hydrateArticleRows(rows);
}

function countArticles() {
  return getDb().prepare('SELECT COUNT(*) AS count FROM articles').get().count;
}

function getSourceStats(configuredSources = []) {
  const rows = getDb().prepare(`
    SELECT source_id AS id, source_name AS name, COUNT(*) AS count
    FROM articles
    GROUP BY source_id, source_name
    ORDER BY count DESC, name ASC
  `).all();

  const aggregatedRows = rows.reduce((map, row) => {
    const canonicalId = canonicalizeSourceId(row.id, row.name);
    const current = map.get(canonicalId) || {
      id: canonicalId,
      name: canonicalizeSourceName(row.id, row.name),
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

function getTopicStats(limit = 20) {
  const rows = getDb().prepare(`
    SELECT topic, COUNT(*) AS count
    FROM article_topics
    GROUP BY topic
    ORDER BY count DESC, topic ASC
  `).all();

  return rows
    .filter((row) => topicNormalizer.isMeaningfulTopic(row.topic))
    .slice(0, limit);
}

function getTopicStatsByFilters(filters = {}, limit = 20) {
  const state = buildFilterState(filters);
  const params = [];
  const joins = ['JOIN articles a ON a.id = article_topics.article_id'];
  const where = [];
  const searchQuery = buildSearchQuery(state.search);

  if (searchQuery) {
    joins.push('JOIN article_search ON article_search.article_id = a.id');
    where.push('article_search MATCH ?');
    params.push(searchQuery);
  }

  if (state.sourceIds.length > 0) {
    const sourceFilter = getSourceFilterClauses(state.sourceIds);
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
    .filter((row) => topicNormalizer.isMeaningfulTopic(row.topic))
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
           minutes_to_read AS minutesToRead, fetched_at AS fetchedAt
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

  return row;
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
      minutes_to_read,
      fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      site_name = excluded.site_name,
      byline = excluded.byline,
      language = excluded.language,
      excerpt = excluded.excerpt,
      content_text = excluded.content_text,
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
    payload.minutesToRead || 1,
    payload.fetchedAt || new Date().toISOString()
  );
}

module.exports = {
  getDb,
  getArticles,
  getArticleById,
  getArticlesByIds,
  getTopicsForArticle,
  mergeTopicsForArticle,
  upsertArticles,
  countArticles,
  getSourceStats,
  getTopicStats,
  getTopicStatsByFilters,
  createIngestionRun,
  completeIngestionRun,
  getLatestIngestionRun,
  getReaderCache,
  upsertReaderCache,
  buildSearchQuery
};
