function parseJsonValue(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function createReaderCacheRepository({ getDb }) {
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
      contentBlocks: parseJsonValue(row.contentBlocks, null)
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

  return {
    getReaderCache,
    upsertReaderCache
  };
}

module.exports = createReaderCacheRepository;
