const { parseJsonValue } = require('../utils/json');
import type { DynamicRecord } from '../utils/types';
import type SqliteDatabase from './sqliteDatabase';

interface ReaderCacheEntry {
  articleId: string;
  url: string;
  title: string;
  siteName: string | null;
  byline: string | null;
  language: string | null;
  excerpt: string | null;
  contentText: string;
  contentBlocks: unknown;
  minutesToRead: number;
  fetchedAt: string;
}

interface ReaderCacheRow extends DynamicRecord {
  articleId: string;
  byline: string | null;
  contentBlocks: unknown;
  contentText: string;
  excerpt: string | null;
  fetchedAt: string;
  language: string | null;
  minutesToRead: number;
  siteName: string | null;
  title: string;
  url: string;
}

const READER_CACHE_SELECT = `
  article_id AS articleId, url, title, site_name AS siteName,
  byline, language, excerpt, content_text AS contentText,
  content_blocks AS contentBlocks, minutes_to_read AS minutesToRead, fetched_at AS fetchedAt
`;

function mapReaderCacheRow(row: ReaderCacheRow | undefined | null): ReaderCacheEntry | null {
  if (!row) {
    return null;
  }

  return {
    ...row,
    contentBlocks: parseJsonValue(row.contentBlocks, null)
  };
}

function isReaderCacheFresh(row: ReaderCacheRow, maxAgeMs?: number) {
  if (typeof maxAgeMs !== 'number' || !Number.isFinite(maxAgeMs)) {
    return true;
  }

  const ageMs = Date.now() - new Date(row.fetchedAt).getTime();
  return Number.isFinite(ageMs) && ageMs < maxAgeMs;
}

function createReaderCacheRepository({
  getDb,
  chunkValues
}: {
  getDb: () => SqliteDatabase;
  chunkValues: <T>(values: T[], size?: number) => T[][];
}) {
  function getReaderCache(articleId: string, maxAgeMs?: number) {
    if (!articleId) {
      return null;
    }

    const row = getDb().prepare<ReaderCacheRow>(`
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

  function getReaderCaches(articleIds: string[] = [], maxAgeMs?: number) {
    const normalizedArticleIds = [...new Set((Array.isArray(articleIds) ? articleIds : [])
      .map((articleId) => String(articleId || '').trim())
      .filter(Boolean))];
    const cacheByArticleId = new Map<string, ReaderCacheEntry>();

    if (normalizedArticleIds.length === 0) {
      return cacheByArticleId;
    }

    chunkValues(normalizedArticleIds, 500).forEach((ids) => {
      const rows = getDb().prepare<ReaderCacheRow>(`
        SELECT ${READER_CACHE_SELECT}
        FROM reader_cache
        WHERE article_id IN (${ids.map(() => '?').join(', ')})
      `).all(...ids);

      rows.forEach((row) => {
        if (isReaderCacheFresh(row, maxAgeMs)) {
          const mapped = mapReaderCacheRow(row);
          if (mapped) {
            cacheByArticleId.set(String(row.articleId), mapped);
          }
        }
      });
    });

    return cacheByArticleId;
  }

  function upsertReaderCache(articleId: string, payload: Partial<ReaderCacheEntry> = {}) {
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

export = createReaderCacheRepository;
