const { parseJsonValue } = require('../utils/json');

const READER_CACHE_SELECT = `
  article_id AS articleId, url, title, site_name AS siteName,
  byline, language, excerpt, content_text AS contentText,
  content_blocks AS contentBlocks, minutes_to_read AS minutesToRead, fetched_at AS fetchedAt
`;

function mapReaderCacheRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    contentBlocks: parseJsonValue(row.contentBlocks, null)
  };
}

function isReaderCacheFresh(row, maxAgeMs) {
  if (!Number.isFinite(maxAgeMs)) {
    return true;
  }

  const ageMs = Date.now() - new Date(row.fetchedAt).getTime();
  return Number.isFinite(ageMs) && ageMs < maxAgeMs;
}

function createReaderCacheRepository({ getDb, chunkValues }) {
  function getReaderCache(articleId, maxAgeMs) {
    if (!articleId) {
      return null;
    }

    const row = getDb().prepare(`
      SELECT ${READER_CACHE_SELECT}
      FROM reader_cache
      WHERE article_id = ?
    `).get(articleId);

    if (!row) {
      return null;
    }

    if (!isReaderCacheFresh(row, maxAgeMs)) {
      return null;
    }

    return mapReaderCacheRow(row);
  }

  function getReaderCaches(articleIds = [], maxAgeMs) {
    const normalizedArticleIds = [...new Set((Array.isArray(articleIds) ? articleIds : [])
      .map((articleId) => String(articleId || '').trim())
      .filter(Boolean))];
    const cacheByArticleId = new Map();

    if (normalizedArticleIds.length === 0) {
      return cacheByArticleId;
    }

    chunkValues(normalizedArticleIds, 500).forEach((ids) => {
      const rows = getDb().prepare(`
        SELECT ${READER_CACHE_SELECT}
        FROM reader_cache
        WHERE article_id IN (${ids.map(() => '?').join(', ')})
      `).all(...ids);

      rows.forEach((row) => {
        if (isReaderCacheFresh(row, maxAgeMs)) {
          cacheByArticleId.set(row.articleId, mapReaderCacheRow(row));
        }
      });
    });

    return cacheByArticleId;
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

  return {
    getReaderCache,
    getReaderCaches,
    upsertReaderCache
  };
}

module.exports = createReaderCacheRepository;
