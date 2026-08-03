import publicationDate = require('../utils/publicationDate');
import json = require('../utils/json');
import type { DynamicRecord, NewsArticle, SourceGroup } from '../utils/types';
import type SqliteDatabase from './sqliteDatabase';

const { getCurrentPublicationDay, normalizePublicationDate } = publicationDate;
const { parseJsonArray } = json;

type Article = NewsArticle & DynamicRecord;
type Row = DynamicRecord;
type FilterClause = { clause: string; params: unknown[] };
type SourceAliases = { ids: string[]; names: string[] };
type SourceMetadataCache = Map<string, SourceMetadata>;
type TitleRange = {
  aliases: SourceAliases;
  ownerUserId: string;
  publishedAfter: number;
  publishedBefore: number;
};

interface ArticleFilters extends DynamicRecord {
  beforeId?: string;
  beforePubDate?: string;
  excludeArticleIds?: string[];
  limit?: number;
  offset?: number;
  recentHours?: number | null;
  search?: string;
  sourceIds?: string[];
  topics?: string[];
}

interface ArticleOptions extends DynamicRecord {
  configuredSourcesOnly?: boolean;
  customSourceGroups?: Map<string, SourceGroup> | null;
  excludedSourceIds?: string[];
  excludedSubSourceIds?: string[];
  maxArticleAgeHours?: number | null;
  readLaterUserId?: string | null;
  sourceMetadataCache?: SourceMetadataCache;
  userId?: string | null;
}

interface SourceMetadata extends DynamicRecord {
  sourceIconUrl: string;
  sourceId: string;
  sourceName: string;
  subSource: string | null;
}

interface TopicDetail extends DynamicRecord {
  confidence?: number | null;
  evidence?: string[];
  reasonCode?: string | null;
  source?: string;
  topic: string;
}

interface TopicNormalizer {
  CANONICAL_TOPICS: string[];
  classifyTopicsFromText: (article: DynamicRecord) => TopicDetail[];
  isCanonicalTopic: (topic: unknown) => boolean;
  normalizeTopic: (topic: unknown) => string | null;
}

interface ArticleRow extends DynamicRecord {
  aiStoryGroupMatchIds?: string | null;
  author?: string | null;
  canonicalUrl?: string;
  content: string;
  description: string;
  id: string;
  image?: string | null;
  language?: string;
  ownerUserId?: string | null;
  pubDate: string;
  source: string;
  sourceId: string;
  title: string;
  url: string;
}

interface DuplicateRow extends DynamicRecord {
  canonicalUrl?: string;
  createdAt?: string;
  id: string;
  publishedAt: string;
  sourceId: string;
  sourceName: string;
  title?: string;
  updatedAt?: string;
}

interface DuplicateInfo {
  aliases: SourceAliases;
  aliasKey: string;
  canonicalKey: string;
  canonicalUrl: string;
  normalizedTitle: string;
  ownerUserId: string;
  publishedTimestamp: number;
  sourceId?: string;
  sourceName: string;
}

interface TopicRow extends DynamicRecord {
  articleId: string;
  confidence?: number | null;
  evidence?: string | null;
  reasonCode?: string | null;
  source?: string | null;
  topic: string;
}

interface IdRow extends DynamicRecord {
  id: string;
}

interface ArticleFieldRow extends DynamicRecord {
  author?: string | null;
  canonicalUrl?: string;
  content: string;
  description: string;
  id: string;
  image?: string | null;
  language: string;
  ownerUserId?: string | null;
  pubDate: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
}

interface TopicUpdate extends DynamicRecord {
  articleId: string;
  topics: unknown[];
}

interface NormalizedTopicEntry extends DynamicRecord {
  confidence: number | null;
  evidence: string;
  reasonCode: string | null;
  source: string;
  topic: string;
}

interface NormalizedTopicUpdate extends DynamicRecord {
  articleId: string;
  topics: NormalizedTopicEntry[];
}

interface NormalizedPodcastAudioEntry extends DynamicRecord {
  audioBlob: Buffer | null;
  audioErrorMessage: string | null;
  audioFailedAt: string | null;
  audioFailureCategory: string;
  audioMimeType: string;
  audioModel: string;
  audioRetryCount: number;
  audioStatus: string;
  audioVoice: string;
  generatedAt: string;
  locale: string;
}

interface StoryAnchorRow extends DynamicRecord {
  id: string;
  ownerUserId?: string | null;
  pubDate: string;
}

interface SourceStatRow extends DynamicRecord {
  count: number;
  id: string;
  name: string;
}

interface ConfiguredSource extends DynamicRecord {
  iconUrl?: string;
  id: string;
  language?: string | null;
  name: string;
}

interface AggregatedSourceStat extends DynamicRecord {
  count: number;
  id: string;
  name: string;
}

interface UserSourceRow extends DynamicRecord {
  id: string;
  userId: string;
}

interface ArticleRepositoryDependencies {
  getDb: () => SqliteDatabase;
  chunkValues: <T>(values: T[], size?: number) => T[][];
  topicNormalizer: TopicNormalizer;
  normalizeArticleUrl: (value: unknown) => string;
  normalizeIdentityText: (value: unknown, options?: { lowercase?: boolean }) => string;
  getResolvedSourceAliases: (sourceId: string, sourceName: string | null, userId: string | null, groups?: Map<string, SourceGroup> | null) => SourceAliases;
  getResolvedSourceMetadata: (sourceId: string, sourceName: string, userId: string | null, groups?: Map<string, SourceGroup> | null) => SourceMetadata;
  getRawConfiguredSourceIds: () => Set<string>;
  getConfiguredSourceGroupIds: () => Set<string>;
  getLegacyConfiguredSourceGroupIds: () => Set<string>;
  getGroupedConfiguredSourceIds: () => Set<string>;
}

function createArticleRepository({
  getDb,
  chunkValues,
  topicNormalizer,
  normalizeArticleUrl,
  normalizeIdentityText,
  getResolvedSourceAliases,
  getResolvedSourceMetadata,
  getRawConfiguredSourceIds,
  getConfiguredSourceGroupIds,
  getLegacyConfiguredSourceGroupIds,
  getGroupedConfiguredSourceIds
}: ArticleRepositoryDependencies) {
  const TITLE_DEDUPE_WINDOW_MS = 3 * 60 * 60 * 1000;

  function getRecord(value: unknown): DynamicRecord {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as DynamicRecord : {};
  }

  function getSourceFilterClauses(sourceIds: string[] = [], options: ArticleOptions = {}, alias = 'a') {
    const aliasedIds = new Set<string>();
    const aliasedNames = new Set<string>();

    sourceIds.forEach((sourceId) => {
      const aliases = getResolvedSourceAliases(sourceId, null, options.userId || null, options.customSourceGroups || null);
      aliases.ids.forEach((id) => aliasedIds.add(id));
      aliases.names.forEach((name) => aliasedNames.add(name));
    });

    const clauses = [];
    const params = [];

    if (aliasedIds.size > 0) {
      clauses.push(`${alias}.source_id IN (${[...aliasedIds].map(() => '?').join(', ')})`);
      params.push(...aliasedIds);
    }

    if (aliasedNames.size > 0) {
      clauses.push(`${alias}.source_name IN (${[...aliasedNames].map(() => '?').join(', ')})`);
      params.push(...aliasedNames);
    }

    return {
      clause: clauses.length > 1 ? `(${clauses.join(' OR ')})` : (clauses[0] || ''),
      params
    };
  }

  function getSourceExclusionClause(sourceIds: string[] = [], options: ArticleOptions = {}, alias = 'a') {
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return null;
    }

    const sourceFilter = getSourceFilterClauses(sourceIds, options, alias);
    if (!sourceFilter.clause) {
      return null;
    }

    return {
      clause: `NOT (${sourceFilter.clause})`,
      params: sourceFilter.params
    };
  }

  function getSubSourceExclusionClause(subSourceIds: string[] = [], alias = 'a') {
    if (!Array.isArray(subSourceIds) || subSourceIds.length === 0) {
      return null;
    }

    return {
      clause: `${alias}.source_id NOT IN (${subSourceIds.map(() => '?').join(', ')})`,
      params: subSourceIds
    };
  }

  function filterEntriesForExistingArticles<T extends { articleId: string }>(entries: T[] = [], database: SqliteDatabase = getDb()) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return [];
    }

    const existingArticleIds = new Set(
      chunkValues([...new Set(entries.map((entry) => entry.articleId))]).flatMap((articleIds) => {
        return database.prepare(`
          SELECT id
          FROM articles
          WHERE id IN (${articleIds.map(() => '?').join(', ')})
        `).all(...articleIds).map((row) => String(row.id || ''));
      })
    );

    return entries.filter((entry) => existingArticleIds.has(entry.articleId));
  }

  function buildScopeFilter(options: ArticleOptions = {}, alias = 'a'): FilterClause {
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

  function buildReadLaterFilter(options: ArticleOptions = {}, alias = 'a'): FilterClause | null {
    if (!options.readLaterUserId) {
      return null;
    }

    return {
      clause: `EXISTS (
        SELECT 1
        FROM user_read_later_articles read_later
        WHERE read_later.user_id = ?
          AND read_later.article_id = ${alias}.id
      )`,
      params: [options.readLaterUserId]
    };
  }

  function buildConfiguredSourceFilter(options: ArticleOptions = {}, alias = 'a'): FilterClause | null {
    if (options.configuredSourcesOnly !== true) {
      return null;
    }

    const sourceIds = [...new Set([
      ...getRawConfiguredSourceIds(),
      ...getConfiguredSourceGroupIds(),
      ...getLegacyConfiguredSourceGroupIds()
    ])];
    return {
      clause: sourceIds.length > 0
        ? `(${alias}.owner_user_id IS NOT NULL OR ${alias}.source_id IN (${sourceIds.map(() => '?').join(', ')}))`
        : `${alias}.owner_user_id IS NOT NULL`,
      params: sourceIds
    };
  }

  function buildRetentionFilter(options: ArticleOptions = {}, alias = 'a'): FilterClause | null {
    if (!options.maxArticleAgeHours || !Number.isFinite(options.maxArticleAgeHours) || options.maxArticleAgeHours <= 0) {
      return null;
    }

    return {
      clause: `${alias}.published_at >= ?`,
      params: [new Date(Date.now() - (options.maxArticleAgeHours * 60 * 60 * 1000)).toISOString()]
    };
  }

  function buildPublishedBeforeNowFilter(alias = 'a') {
    return {
      clause: `${alias}.published_at <= ?`,
      params: [new Date().toISOString()]
    };
  }

  function appendFilters(where: string[], params: unknown[], ...filters: Array<FilterClause | null | undefined>) {
    filters.filter((filter): filter is FilterClause => Boolean(filter)).forEach((filter) => {
      where.push(filter.clause);
      params.push(...filter.params);
    });
  }

  function buildFilterState(filters: ArticleFilters = {}) {
    return {
      search: typeof filters.search === 'string' ? filters.search.trim() : '',
      sourceIds: Array.isArray(filters.sourceIds) ? filters.sourceIds.filter(Boolean) : [],
      topics: Array.isArray(filters.topics) ? filters.topics.filter(Boolean) : [],
      recentHours: typeof filters.recentHours === 'number' && Number.isFinite(filters.recentHours) && filters.recentHours > 0 ? filters.recentHours : null,
      beforePubDate: typeof filters.beforePubDate === 'string' && filters.beforePubDate.trim() ? filters.beforePubDate.trim() : '',
      beforeId: typeof filters.beforeId === 'string' && filters.beforeId.trim() ? filters.beforeId.trim() : '',
      excludeArticleIds: Array.isArray(filters.excludeArticleIds) ? filters.excludeArticleIds.filter(Boolean).slice(0, 300) : [],
      limit: Math.max(1, Math.min(Number(filters.limit) || 50, 251)),
      offset: Math.max(0, Number(filters.offset) || 0)
    };
  }

  function normalizeArticleIds(articleIds: unknown[] = []) {
    return [...new Set((Array.isArray(articleIds) ? articleIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  }

  function uniqueTruthyArticleIds(articleIds: string[] = []) {
    return [...new Set((Array.isArray(articleIds) ? articleIds : []).filter(Boolean))];
  }

  function buildSearchQuery(search: unknown) {
    const tokens = String(search || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
      .slice(0, 8);

    if (tokens.length === 0) {
      return '';
    }

    return tokens.map((token) => `${token}*`).join(' AND ');
  }

  function buildArticleQuery(filters: ArticleFilters = {}, options: ArticleOptions = {}) {
    const state = buildFilterState(filters);
    const params: unknown[] = [];
    const joins: string[] = [];
    const where: string[] = [];
    const searchQuery = buildSearchQuery(state.search);
    const scopeFilter = buildScopeFilter(options, 'a');
    const configuredSourceFilter = buildConfiguredSourceFilter(options, 'a');
    const retentionFilter = buildRetentionFilter(options, 'a');
    const publishedBeforeNowFilter = buildPublishedBeforeNowFilter('a');
    const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
    const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);

    appendFilters(
      where,
      params,
      scopeFilter,
      configuredSourceFilter,
      publishedBeforeNowFilter,
      retentionFilter,
      excludedSourceFilter,
      excludedSubSourceFilter
    );

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

    if (state.beforePubDate && state.beforeId) {
      where.push('(a.published_at < ? OR (a.published_at = ? AND a.id < ?))');
      params.push(state.beforePubDate, state.beforePubDate, state.beforeId);
    } else if (state.beforePubDate) {
      where.push('a.published_at < ?');
      params.push(state.beforePubDate);
    }

    if (state.excludeArticleIds.length > 0) {
      where.push(`a.id NOT IN (${state.excludeArticleIds.map(() => '?').join(', ')})`);
      params.push(...state.excludeArticleIds);
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
        a.canonical_url AS canonicalUrl,
        a.image,
        a.author,
        a.language,
        a.owner_user_id AS ownerUserId,
        a.published_at AS pubDate,
        a.story_group_id AS storyGroupId,
        a.ai_story_group_processed_at AS aiStoryGroupProcessedAt,
        a.ai_story_group_status AS aiStoryGroupStatus,
        a.ai_story_group_model AS aiStoryGroupModel,
        a.ai_story_group_match_ids AS aiStoryGroupMatchIds,
        a.ai_story_group_confidence AS aiStoryGroupConfidence,
        a.ai_story_group_reason AS aiStoryGroupReason
      FROM articles a
      ${joins.join('\n')}
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.published_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `;

    params.push(state.limit, state.offset);

    return { sql, params };
  }

  function normalizeArticleTitle(title: unknown) {
    return normalizeIdentityText(title, { lowercase: true });
  }

  function sortDuplicateRows(rows: DuplicateRow[] = []) {
    return [...rows].sort((left, right) => String(right.updatedAt || right.createdAt || right.id || '').localeCompare(
      String(left.updatedAt || left.createdAt || left.id || '')
    ));
  }

  function sourceMatchesAliases(row: DuplicateRow, aliases: SourceAliases) {
    return aliases.ids.includes(row.sourceId) || aliases.names.includes(row.sourceName);
  }

  function getAliasKey(ownerUserId: string | null, aliases: SourceAliases) {
    return [ownerUserId || '', aliases.ids.join('\u0001'), aliases.names.join('\u0001')].join('\u0000');
  }

  function createArticleDuplicateLookup(database: SqliteDatabase, articles: Article[] = [], existingIdSet = new Set<string>()) {
    const aliasCache = new Map<string, SourceAliases>();
    const infoByArticle = new WeakMap<Article, DuplicateInfo>();
    const canonicalRowsByKey = new Map<string, DuplicateRow[]>();
    const titleRowsByAliasKey = new Map<string, DuplicateRow[]>();
    const titleGroupRanges = new Map<string, TitleRange>();

    function getAliases(sourceId: string, sourceName: string, ownerUserId: string) {
      const cacheKey = [ownerUserId || '', sourceId || '', sourceName || ''].join('\u0000');
      if (!aliasCache.has(cacheKey)) {
        aliasCache.set(cacheKey, getResolvedSourceAliases(sourceId, sourceName, ownerUserId || null));
      }

      return aliasCache.get(cacheKey)!;
    }

    function buildInfo(article: Article): DuplicateInfo {
      const sourceId = article.rawSourceId || article.sourceId;
      const sourceName = String(article.rawSource || article.source || '');
      const ownerUserId = article.ownerUserId || '';
      const aliases = getAliases(String(sourceId || ''), String(sourceName || ''), ownerUserId);
      const canonicalUrl = normalizeArticleUrl(article.canonicalUrl || article.url || '');
      const normalizedTitle = normalizeArticleTitle(article.title);
      const publishedTimestamp = Date.parse(article.pubDate || '');
      const info = {
        sourceId,
        sourceName,
        ownerUserId,
        aliases,
        aliasKey: getAliasKey(ownerUserId, aliases),
        canonicalKey: `${ownerUserId}\u0000${canonicalUrl}`,
        canonicalUrl,
        normalizedTitle,
        publishedTimestamp
      };

      infoByArticle.set(article, info);
      return info;
    }

    function getInfo(article: Article): DuplicateInfo {
      return infoByArticle.get(article) || buildInfo(article);
    }

    function addCanonicalCandidate(info: DuplicateInfo, row: DuplicateRow) {
      if (!info.canonicalUrl || !sourceMatchesAliases(row, info.aliases)) {
        return;
      }

      const rows = canonicalRowsByKey.get(info.canonicalKey) || [];
      if (!rows.some((candidate) => candidate.id === row.id)) {
        rows.push(row);
        canonicalRowsByKey.set(info.canonicalKey, rows);
      }
    }

    function addTitleCandidate(info: DuplicateInfo, row: DuplicateRow) {
      if (!info.normalizedTitle || Number.isNaN(info.publishedTimestamp) || !sourceMatchesAliases(row, info.aliases)) {
        return;
      }

      const rows = titleRowsByAliasKey.get(info.aliasKey) || [];
      if (!rows.some((candidate) => candidate.id === row.id)) {
        rows.push(row);
        titleRowsByAliasKey.set(info.aliasKey, rows);
      }
    }

    articles.forEach((article) => {
      const info = buildInfo(article);
      if (existingIdSet.has(article.id)) {
        return;
      }

      if (info.canonicalUrl) {
        canonicalRowsByKey.set(info.canonicalKey, []);
      }

      if (info.normalizedTitle && !Number.isNaN(info.publishedTimestamp) && (info.aliases.ids.length > 0 || info.aliases.names.length > 0)) {
        const range = titleGroupRanges.get(info.aliasKey) || {
          ownerUserId: info.ownerUserId,
          aliases: info.aliases,
          publishedAfter: info.publishedTimestamp - TITLE_DEDUPE_WINDOW_MS,
          publishedBefore: info.publishedTimestamp + TITLE_DEDUPE_WINDOW_MS
        };
        range.publishedAfter = Math.min(range.publishedAfter, info.publishedTimestamp - TITLE_DEDUPE_WINDOW_MS);
        range.publishedBefore = Math.max(range.publishedBefore, info.publishedTimestamp + TITLE_DEDUPE_WINDOW_MS);
        titleGroupRanges.set(info.aliasKey, range);
      }
    });

    const canonicalUrlsByOwner = new Map<string, string[]>();
    canonicalRowsByKey.forEach((_, key) => {
      const [ownerUserId, canonicalUrl] = key.split('\u0000');
      const urls = canonicalUrlsByOwner.get(ownerUserId) || [];
      urls.push(canonicalUrl);
      canonicalUrlsByOwner.set(ownerUserId, urls);
    });

    canonicalUrlsByOwner.forEach((urls, ownerUserId) => {
      chunkValues([...new Set(urls)]).forEach((urlChunk) => {
        database.prepare<DuplicateRow>(`
          SELECT id, source_id AS sourceId, source_name AS sourceName, canonical_url AS canonicalUrl,
                 published_at AS publishedAt, updated_at AS updatedAt, created_at AS createdAt
          FROM articles
          WHERE COALESCE(owner_user_id, '') = ?
            AND canonical_url IN (${urlChunk.map(() => '?').join(', ')})
          ORDER BY datetime(updated_at) DESC, datetime(published_at) DESC, datetime(created_at) DESC, id DESC
        `).all(ownerUserId, ...urlChunk).forEach((row) => {
          const key = `${ownerUserId}\u0000${row.canonicalUrl}`;
          const rows = canonicalRowsByKey.get(key);
          if (rows) {
            rows.push(row);
          }
        });
      });
    });

    const titleRangesByOwner = new Map<string, Array<{ aliasKey: string; range: TitleRange }>>();
    titleGroupRanges.forEach((range, aliasKey) => {
      if (range.aliases.ids.length === 0 && range.aliases.names.length === 0) {
        titleRowsByAliasKey.set(aliasKey, []);
        return;
      }

      const ownerRanges = titleRangesByOwner.get(range.ownerUserId) || [];
      ownerRanges.push({ aliasKey, range });
      titleRangesByOwner.set(range.ownerUserId, ownerRanges);
    });

    titleRangesByOwner.forEach((ownerRanges, ownerUserId) => {
      const sourceIds = new Set<string>();
      const sourceNames = new Set<string>();
      let publishedAfter = Infinity;
      let publishedBefore = -Infinity;

      ownerRanges.forEach(({ range }) => {
        range.aliases.ids.forEach((id) => sourceIds.add(id));
        range.aliases.names.forEach((name) => sourceNames.add(name));
        publishedAfter = Math.min(publishedAfter, range.publishedAfter);
        publishedBefore = Math.max(publishedBefore, range.publishedBefore);
      });

      const sourceClauses: string[] = [];
      const sourceParams: string[] = [];
      const sourceIdList = [...sourceIds];
      const sourceNameList = [...sourceNames];

      if (sourceIdList.length > 0) {
        sourceClauses.push(`source_id IN (${sourceIdList.map(() => '?').join(', ')})`);
        sourceParams.push(...sourceIdList);
      }

      if (sourceNameList.length > 0) {
        sourceClauses.push(`source_name IN (${sourceNameList.map(() => '?').join(', ')})`);
        sourceParams.push(...sourceNameList);
      }

      const candidateRows = database.prepare<DuplicateRow>(`
        SELECT id, source_id AS sourceId, source_name AS sourceName, title,
               canonical_url AS canonicalUrl, published_at AS publishedAt,
               updated_at AS updatedAt, created_at AS createdAt
        FROM articles
        WHERE COALESCE(owner_user_id, '') = ?
          AND (${sourceClauses.join(' OR ')})
          AND published_at BETWEEN ? AND ?
        ORDER BY datetime(updated_at) DESC, datetime(published_at) DESC, datetime(created_at) DESC, id DESC
      `).all(
        ownerUserId,
        ...sourceParams,
        new Date(publishedAfter).toISOString(),
        new Date(publishedBefore).toISOString()
      );

      ownerRanges.forEach(({ aliasKey, range }) => {
        titleRowsByAliasKey.set(aliasKey, candidateRows.filter((row) => {
          const rowTimestamp = Date.parse(row.publishedAt || '');
          return sourceMatchesAliases(row, range.aliases)
            && Number.isFinite(rowTimestamp)
            && rowTimestamp >= range.publishedAfter
            && rowTimestamp <= range.publishedBefore;
        }));
      });
    });

    return {
      getInfo,
      getCanonicalMatches(article: Article) {
        const info = getInfo(article);
        if (!info.canonicalUrl) {
          return [];
        }

        return sortDuplicateRows((canonicalRowsByKey.get(info.canonicalKey) || []).filter((row) => sourceMatchesAliases(row, info.aliases)));
      },
      getTitleMatches(article: Article) {
        const info = getInfo(article);
        if (!info.normalizedTitle || Number.isNaN(info.publishedTimestamp)) {
          return [];
        }

        return (titleRowsByAliasKey.get(info.aliasKey) || [])
          .filter((row) => {
            const rowTimestamp = Date.parse(row.publishedAt || '');
            const rowCanonicalUrl = normalizeArticleUrl(row.canonicalUrl || '');
            return normalizeArticleTitle(row.title) === info.normalizedTitle
              && Number.isFinite(rowTimestamp)
              && Math.abs(rowTimestamp - info.publishedTimestamp) <= TITLE_DEDUPE_WINDOW_MS
              && (!info.canonicalUrl || !rowCanonicalUrl || rowCanonicalUrl === info.canonicalUrl);
          })
          .sort((left, right) => {
            const leftDiff = Math.abs(Date.parse(left.publishedAt || '') - info.publishedTimestamp);
            const rightDiff = Math.abs(Date.parse(right.publishedAt || '') - info.publishedTimestamp);
            if (leftDiff !== rightDiff) {
              return leftDiff - rightDiff;
            }

            return String(right.updatedAt || right.createdAt || right.id || '').localeCompare(
              String(left.updatedAt || left.createdAt || left.id || '')
            );
          });
      },
      forgetIds(ids: string[] = []) {
        const deletedIds = new Set<string>(ids.filter(Boolean));
        if (deletedIds.size === 0) {
          return;
        }

        canonicalRowsByKey.forEach((rows, key) => {
          canonicalRowsByKey.set(key, rows.filter((row) => !deletedIds.has(row.id)));
        });
        titleRowsByAliasKey.forEach((rows, key) => {
          titleRowsByAliasKey.set(key, rows.filter((row) => !deletedIds.has(row.id)));
        });
      },
      rememberArticle(article: Article) {
        const info = getInfo(article);
        const row = {
          id: article.id,
          sourceId: String(article.rawSourceId || article.sourceId || ''),
          sourceName: String(article.rawSource || article.source || ''),
          title: article.title,
          canonicalUrl: info.canonicalUrl,
          publishedAt: article.pubDate,
          updatedAt: String(article.updatedAt || new Date().toISOString()),
          createdAt: String(article.createdAt || new Date().toISOString())
        };

        addCanonicalCandidate(info, row);
        addTitleCandidate(info, row);
      }
    };
  }

  function transferDuplicateArticleReferences(database: SqliteDatabase, duplicateId: string, persistedArticleId: string) {
    if (!duplicateId || !persistedArticleId || duplicateId === persistedArticleId) {
      return;
    }

    database.prepare(`
      INSERT OR IGNORE INTO user_read_later_articles (user_id, article_id, saved_at)
      SELECT user_id, ?, saved_at
      FROM user_read_later_articles
      WHERE article_id = ?
    `).run(persistedArticleId, duplicateId);

    database.prepare(`
      UPDATE user_read_later_articles
      SET saved_at = (
        SELECT MAX(source.saved_at)
        FROM user_read_later_articles source
        WHERE source.user_id = user_read_later_articles.user_id
          AND source.article_id IN (?, ?)
      )
      WHERE article_id = ?
        AND user_id IN (
          SELECT user_id
          FROM user_read_later_articles
          WHERE article_id = ?
        )
    `).run(persistedArticleId, duplicateId, persistedArticleId, duplicateId);

    database.prepare(`
      INSERT OR IGNORE INTO reader_cache (
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
      )
      SELECT ?, url, title, site_name, byline, language, excerpt, content_text, content_blocks, minutes_to_read, fetched_at
      FROM reader_cache
      WHERE article_id = ?
    `).run(persistedArticleId, duplicateId);

    database.prepare(`
      UPDATE reader_cache
      SET url = duplicate.url,
          title = duplicate.title,
          site_name = duplicate.site_name,
          byline = duplicate.byline,
          language = duplicate.language,
          excerpt = duplicate.excerpt,
          content_text = duplicate.content_text,
          content_blocks = duplicate.content_blocks,
          minutes_to_read = duplicate.minutes_to_read,
          fetched_at = duplicate.fetched_at
      FROM reader_cache duplicate
      WHERE reader_cache.article_id = ?
        AND duplicate.article_id = ?
        AND duplicate.fetched_at > reader_cache.fetched_at
    `).run(persistedArticleId, duplicateId);

    database.prepare(`
      INSERT INTO article_topics (article_id, topic, source, confidence, evidence, reason_code, created_at)
      SELECT ?, topic, source, confidence, evidence, reason_code, created_at
      FROM article_topics
      WHERE article_id = ?
      ON CONFLICT(article_id, topic) DO UPDATE SET
        source = CASE
          WHEN article_topics.source = 'legacy' AND excluded.source != 'legacy' THEN excluded.source
          ELSE article_topics.source
        END,
        confidence = COALESCE(article_topics.confidence, excluded.confidence),
        evidence = CASE
          WHEN article_topics.evidence = '[]' THEN excluded.evidence
          ELSE article_topics.evidence
        END,
        reason_code = COALESCE(article_topics.reason_code, excluded.reason_code)
    `).run(persistedArticleId, duplicateId);

    database.prepare(`
      UPDATE articles
      SET story_group_id = COALESCE(NULLIF(story_group_id, ''), (
            SELECT story_group_id
            FROM articles duplicate
            WHERE duplicate.id = ?
          )),
          ai_story_group_processed_at = COALESCE(ai_story_group_processed_at, (
            SELECT ai_story_group_processed_at
            FROM articles duplicate
            WHERE duplicate.id = ?
          )),
          ai_story_group_status = COALESCE(ai_story_group_status, (
            SELECT ai_story_group_status
            FROM articles duplicate
            WHERE duplicate.id = ?
          )),
          ai_story_group_model = COALESCE(ai_story_group_model, (
            SELECT ai_story_group_model
            FROM articles duplicate
            WHERE duplicate.id = ?
          )),
          ai_story_group_match_ids = COALESCE(NULLIF(NULLIF(ai_story_group_match_ids, ''), '[]'), (
            SELECT ai_story_group_match_ids
            FROM articles duplicate
            WHERE duplicate.id = ?
          )),
          ai_story_group_confidence = COALESCE(ai_story_group_confidence, (
            SELECT ai_story_group_confidence
            FROM articles duplicate
            WHERE duplicate.id = ?
          )),
          ai_story_group_reason = COALESCE(ai_story_group_reason, (
            SELECT ai_story_group_reason
            FROM articles duplicate
            WHERE duplicate.id = ?
          ))
      WHERE id = ?
    `).run(
      duplicateId, duplicateId, duplicateId, duplicateId, duplicateId, duplicateId, duplicateId,
      persistedArticleId
    );
  }

  function getTopicDetailsByArticleIds(articleIds: string[]): Map<string, TopicDetail[]> {
    const normalizedArticleIds = [...new Set((Array.isArray(articleIds) ? articleIds : []).filter(Boolean))];
    if (normalizedArticleIds.length === 0) {
      return new Map<string, TopicDetail[]>();
    }

    const rows = chunkValues(normalizedArticleIds).flatMap((ids) => {
      return getDb().prepare<TopicRow>(`
        SELECT article_id AS articleId, topic, source, confidence, evidence, reason_code AS reasonCode
        FROM article_topics
        WHERE article_id IN (${ids.map(() => '?').join(', ')})
        ORDER BY topic ASC
      `).all(...ids);
    });

    const topicDetailsMap = new Map<string, TopicDetail[]>();
    rows.forEach((row) => {
      if (!topicNormalizer.isCanonicalTopic(row.topic)) {
        return;
      }

      const topics = topicDetailsMap.get(row.articleId) || [];
      topics.push({
        topic: row.topic,
        source: row.source || 'legacy',
        confidence: row.confidence,
        evidence: parseJsonArray(row.evidence),
        reasonCode: row.reasonCode || null
      });
      topicDetailsMap.set(row.articleId, topics);
    });

    return topicDetailsMap;
  }

  function hydrateArticleRows(rows: ArticleRow[], options: ArticleOptions = {}): Article[] {
    const articleIds = rows.map((row) => row.id);
    const topicDetailsMap = getTopicDetailsByArticleIds(articleIds);
    const metadataCache = options.sourceMetadataCache || new Map<string, SourceMetadata>();

    return rows.map((row) => {
      const userId = options.userId || row.ownerUserId || null;
      const cacheKey = `${userId || ''}:${row.sourceId || ''}:${row.source || ''}`;
      let sourceMetadata = metadataCache.get(cacheKey);

      if (!sourceMetadata) {
        sourceMetadata = getResolvedSourceMetadata(row.sourceId, row.source, userId, options.customSourceGroups || null);
        metadataCache.set(cacheKey, sourceMetadata);
      }

      const topicDetails = topicDetailsMap.get(row.id) || [];

      return {
        ...row,
        aiStoryGroupMatchIds: parseJsonArray(row.aiStoryGroupMatchIds),
        rawSourceId: row.sourceId,
        rawSource: row.source,
        sourceId: sourceMetadata.sourceId,
        source: sourceMetadata.sourceName,
        sourceIconUrl: sourceMetadata.sourceIconUrl || '',
        subSource: sourceMetadata.subSource,
        topics: topicDetails.map((entry) => entry.topic),
        topicDetails
      };
    });
  }

  function normalizeTopicEntry(entry: unknown, fallbackSource = 'local') {
    const topicEntry = entry && typeof entry === 'object' ? entry as DynamicRecord : null;
    const rawTopic = topicEntry ? topicEntry.topic : entry;
    const topic = topicNormalizer.normalizeTopic(rawTopic);
    if (!topic || !topicNormalizer.isCanonicalTopic(topic)) {
      return null;
    }

    const confidence = topicEntry && Number.isFinite(Number(topicEntry.confidence))
      ? Math.max(0, Math.min(1, Number(topicEntry.confidence)))
      : null;
    const evidence = topicEntry && Array.isArray(topicEntry.evidence)
      ? topicEntry.evidence.map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 8)
      : [];

    return {
      topic,
      source: String(topicEntry?.source || fallbackSource || 'local').slice(0, 32),
      confidence,
      evidence: JSON.stringify(evidence),
      reasonCode: topicEntry?.reasonCode ? String(topicEntry.reasonCode).slice(0, 80) : null
    };
  }

  function normalizeTopicEntries(topics: unknown = [], fallbackSource = 'local'): NormalizedTopicEntry[] {
    if (!Array.isArray(topics)) {
      return [];
    }

    const seen = new Set();
    return topics
      .map((topic) => normalizeTopicEntry(topic, fallbackSource))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .filter((entry) => {
        const key = entry.topic.toLowerCase();
        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });
  }

  function articleFieldsChanged(row: Row | null | undefined, values: Row) {
    if (!row) {
      return true;
    }

    return row.sourceId !== values.sourceId
      || row.sourceName !== values.sourceName
      || (row.ownerUserId || null) !== (values.ownerUserId || null)
      || row.title !== values.title
      || row.description !== values.description
      || row.content !== values.content
      || row.url !== values.url
      || row.canonicalUrl !== values.canonicalUrl
      || (row.image || null) !== (values.image || null)
      || (row.author || null) !== (values.author || null)
      || row.language !== values.language
      || row.pubDate !== values.pubDate;
  }

  function upsertArticles(articles: Article[] = []) {
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
        canonical_url,
        image,
        author,
        language,
        published_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_id = excluded.source_id,
        source_name = excluded.source_name,
        owner_user_id = excluded.owner_user_id,
        title = excluded.title,
        description = excluded.description,
        content = excluded.content,
        url = excluded.url,
        canonical_url = excluded.canonical_url,
        image = excluded.image,
        author = excluded.author,
        language = excluded.language,
        published_at = excluded.published_at,
        updated_at = excluded.updated_at
    `);
    const deleteArticleStmt = database.prepare('DELETE FROM articles WHERE id = ?');
    const articleFieldSelectSql = `
      SELECT id, source_id AS sourceId, source_name AS sourceName, owner_user_id AS ownerUserId,
             title, description, content, url, canonical_url AS canonicalUrl, image, author,
             language, published_at AS pubDate
      FROM articles
    `;
    const existingArticleFields = new Map<string, ArticleFieldRow>(
      chunkValues(articles.map((article) => article.id).filter(Boolean)).flatMap((articleIds) => {
        return database.prepare<ArticleFieldRow>(`
          ${articleFieldSelectSql}
          WHERE id IN (${articleIds.map(() => '?').join(', ')})
        `).all(...articleIds).map((row) => [row.id, row]);
      })
    );
    const selectArticleFieldsStmt = database.prepare<ArticleFieldRow>(`${articleFieldSelectSql} WHERE id = ?`);
    const existingIdSet = new Set<string>(
      chunkValues(articles.map((article) => article.id).filter(Boolean)).flatMap((articleIds) => {
        return database.prepare<IdRow>(`
          SELECT id
          FROM articles
          WHERE id IN (${articleIds.map(() => '?').join(', ')})
        `).all(...articleIds).map((row) => row.id);
      })
    );
    const duplicateLookup = createArticleDuplicateLookup(database, articles, existingIdSet);

    const transaction = database.transaction((items: Article[]) => {
      const insertedIds: string[] = [];
      const updatedIds: string[] = [];

      items.forEach((article) => {
        const storedSourceId = article.rawSourceId || article.sourceId;
        const storedSourceName = article.rawSource || article.source;
        const lookupInfo = duplicateLookup.getInfo(article);
        const canonicalUrl = lookupInfo.canonicalUrl;
        const canonicalMatches = duplicateLookup.getCanonicalMatches(article);
        const canonicalMatch = !existingIdSet.has(article.id)
          ? canonicalMatches.find((row) => row.id !== article.id)
          : null;
        const titleMatches = !existingIdSet.has(article.id) && !canonicalMatch
          ? duplicateLookup.getTitleMatches(article)
          : [];
        const titleMatch = titleMatches.find((row) => row.id !== article.id) || null;
        const persistedArticleId = existingIdSet.has(article.id) ? article.id : (canonicalMatch?.id || titleMatch?.id || article.id);
        const duplicateIds = canonicalMatches
          .map((row) => row.id)
          .filter((id) => id && id !== persistedArticleId);
        const exists = existingIdSet.has(persistedArticleId) || Boolean(canonicalMatch) || Boolean(titleMatch);
        const normalizedPubDate = normalizePublicationDate(article.pubDate, now);

        article.id = persistedArticleId;
        article.canonicalUrl = canonicalUrl;
        article.pubDate = normalizedPubDate;

        duplicateIds.forEach((duplicateId) => {
          transferDuplicateArticleReferences(database, duplicateId, persistedArticleId);
          deleteArticleStmt.run(duplicateId);
          existingIdSet.delete(duplicateId);
        });
        duplicateLookup.forgetIds(duplicateIds);

        const values = {
          sourceId: String(storedSourceId || ''),
          sourceName: storedSourceName,
          ownerUserId: article.ownerUserId || null,
          title: article.title,
          description: article.description || '',
          content: article.content || '',
          url: article.url || '',
          canonicalUrl,
          image: article.image || null,
          author: article.author || null,
          language: article.language || 'it',
          pubDate: normalizedPubDate
        };
        const previousArticleFields = existingArticleFields.get(persistedArticleId) || (exists ? selectArticleFieldsStmt.get(persistedArticleId) : null);
        const shouldWriteArticle = !exists || articleFieldsChanged(previousArticleFields, values);

        if (shouldWriteArticle) {
          upsertStmt.run(
            persistedArticleId,
            values.sourceId,
            values.sourceName,
            values.ownerUserId,
            values.title,
            values.description,
            values.content,
            values.url,
            values.canonicalUrl,
            values.image,
            values.author,
            values.language,
            values.pubDate,
            article.createdAt || now,
            now
          );
        }

        if (exists && shouldWriteArticle) {
          updatedIds.push(persistedArticleId);
        } else if (!exists) {
          insertedIds.push(persistedArticleId);
          existingIdSet.add(persistedArticleId);
        }
        existingArticleFields.set(persistedArticleId, { id: persistedArticleId, ...values });
        duplicateLookup.rememberArticle(article);
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

  function getArticleIdsPendingAiTopicProcessing(articleIds: string[] = []) {
    const normalizedArticleIds = uniqueTruthyArticleIds(articleIds);
    if (normalizedArticleIds.length === 0) {
      return [];
    }

    return chunkValues(normalizedArticleIds).flatMap((ids) => {
      return getDb().prepare(`
        SELECT id
        FROM articles
        WHERE id IN (${ids.map(() => '?').join(', ')})
          AND (
            ai_topics_processed_at IS NULL
            OR ai_topics_status IN ('failed', 'deferred')
          )
      `).all(...ids).map((row) => row.id);
    });
  }

  function markArticlesAiTopicProcessing(articleIds: string[] = [], status = 'completed') {
    const normalizedArticleIds = uniqueTruthyArticleIds(articleIds);
    if (normalizedArticleIds.length === 0) {
      return 0;
    }

    const processedAt = new Date().toISOString();
    return chunkValues(normalizedArticleIds).reduce((total, ids) => {
      return total + Number(getDb().prepare(`
        UPDATE articles
        SET ai_topics_processed_at = ?,
            ai_topics_status = ?
        WHERE id IN (${ids.map(() => '?').join(', ')})
      `).run(processedAt, status, ...ids).changes);
    }, 0);
  }

  function getArticleIdsPendingAiStoryGrouping(articleIds: string[] = []) {
    const normalizedArticleIds = uniqueTruthyArticleIds(articleIds);
    if (normalizedArticleIds.length === 0) {
      return [];
    }

    return chunkValues(normalizedArticleIds).flatMap((ids) => {
      return getDb().prepare(`
        SELECT id
        FROM articles
        WHERE id IN (${ids.map(() => '?').join(', ')})
          AND (
            ai_story_group_processed_at IS NULL
            OR ai_story_group_status IN ('failed', 'deferred')
          )
      `).all(...ids).map((row) => row.id);
    });
  }

  function getArticleIdsForAiStoryGroupingRetry(articleIds: string[] = [], options: DynamicRecord = {}) {
    const normalizedArticleIds = uniqueTruthyArticleIds(articleIds);
    if (normalizedArticleIds.length === 0) {
      return [];
    }

    const database = getDb();
    const windowHours = Math.max(1, Math.min(Number(options.windowHours) || 24, 72));
    const limit = Math.max(1, Math.min(Number(options.limit) || 12, 100));
    const retryStatuses = ['failed', 'deferred', 'no_candidates', 'no_match'];
    const anchors = chunkValues(normalizedArticleIds).flatMap((ids) => {
      return database.prepare<StoryAnchorRow>(`
        SELECT id, owner_user_id AS ownerUserId, published_at AS pubDate
        FROM articles
        WHERE id IN (${ids.map(() => '?').join(', ')})
      `).all(...ids);
    });
    const retryAnchors = anchors.flatMap((anchor) => {
      const anchorTimestamp = Date.parse(anchor.pubDate || '');
      if (!Number.isFinite(anchorTimestamp)) {
        return [];
      }

      return [{
        id: anchor.id,
        ownerUserId: anchor.ownerUserId || '',
        periodStart: new Date(anchorTimestamp - (windowHours * 60 * 60 * 1000)).toISOString(),
        periodEnd: new Date(anchorTimestamp + (windowHours * 60 * 60 * 1000)).toISOString()
      }];
    });
    const retryIds = new Set<string>();

    for (const anchorChunk of chunkValues(retryAnchors)) {
      if (retryIds.size >= limit) {
        break;
      }

      const anchorValues = anchorChunk.map(() => '(?, ?, ?, ?)').join(', ');
      const anchorParams = anchorChunk.flatMap((anchor) => [
        anchor.id,
        anchor.ownerUserId,
        anchor.periodStart,
        anchor.periodEnd
      ]);
      const rows = database.prepare<IdRow>(`
        WITH anchors(id, owner_user_id, period_start, period_end) AS (
          VALUES ${anchorValues}
        )
        SELECT DISTINCT candidate.id, candidate.published_at AS pub_date
        FROM articles candidate
        JOIN anchors
          ON candidate.id != anchors.id
          AND COALESCE(candidate.owner_user_id, '') = anchors.owner_user_id
          AND candidate.published_at BETWEEN anchors.period_start AND anchors.period_end
        WHERE candidate.ai_story_group_status IN (${retryStatuses.map(() => '?').join(', ')})
        ORDER BY pub_date DESC, candidate.id DESC
        LIMIT ?
      `).all(...anchorParams, ...retryStatuses, limit - retryIds.size);

      rows.forEach((row) => retryIds.add(row.id));
    }

    return [...retryIds];
  }

  function markArticlesAiStoryGrouping(articleIds: string[] = [], status = 'completed', model = '', metadata: DynamicRecord = {}) {
    const normalizedArticleIds = uniqueTruthyArticleIds(articleIds);
    if (normalizedArticleIds.length === 0) {
      return 0;
    }

    const processedAt = new Date().toISOString();
    const matchIds = Array.isArray(metadata.matchIds)
      ? JSON.stringify([...new Set(metadata.matchIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 20))
      : null;
    const confidence = Number.isFinite(Number(metadata.confidence)) ? Number(metadata.confidence) : null;
    const reason = metadata.reason ? String(metadata.reason).replace(/\s+/g, ' ').trim().slice(0, 500) : null;
    return chunkValues(normalizedArticleIds).reduce((total, ids) => {
      return total + Number(getDb().prepare(`
        UPDATE articles
        SET ai_story_group_processed_at = ?,
            ai_story_group_status = ?,
            ai_story_group_model = ?,
            ai_story_group_match_ids = COALESCE(?, ai_story_group_match_ids),
            ai_story_group_confidence = ?,
            ai_story_group_reason = ?
        WHERE id IN (${ids.map(() => '?').join(', ')})
          AND COALESCE(ai_story_group_status, '') != 'matched'
      `).run(
        processedAt,
        status,
        String(model || '').slice(0, 160),
        matchIds,
        confidence,
        reason,
        ...ids
      ).changes);
    }, 0);
  }

  function normalizeStoryMatchEvidence(matches: DynamicRecord[] = []) {
    const normalizedMatches = (Array.isArray(matches) ? matches : [])
      .map((match) => ({
        articleId: String(match?.articleId || match?.id || '').trim(),
        confidence: Number(match?.confidence),
        reason: String(match?.reason || '').replace(/\s+/g, ' ').trim()
      }))
      .filter((match) => match.articleId && Number.isFinite(match.confidence))
      .sort((left, right) => right.confidence - left.confidence);
    const matchIds = [...new Set(normalizedMatches.map((match) => match.articleId))].slice(0, 20);
    const confidence = normalizedMatches.length > 0
      ? Math.max(...normalizedMatches.map((match) => match.confidence))
      : null;
    const reason = normalizedMatches
      .map((match) => match.reason)
      .filter(Boolean)
      .slice(0, 3)
      .join('; ')
      .slice(0, 500);

    return {
      matchIdsJson: JSON.stringify(matchIds),
      confidence,
      reason: reason || null
    };
  }

  function assignArticlesToStoryGroup(articleIds: string[] = [], storyGroupId = '', model = '', matches: DynamicRecord[] = []) {
    const normalizedArticleIds = uniqueTruthyArticleIds(articleIds);
    const normalizedStoryGroupId = String(storyGroupId || '').trim().slice(0, 160);
    if (normalizedArticleIds.length === 0 || !normalizedStoryGroupId) {
      return 0;
    }

    const processedAt = new Date().toISOString();
    const evidence = normalizeStoryMatchEvidence(matches);
    return chunkValues(normalizedArticleIds).reduce((total, ids) => {
      return total + Number(getDb().prepare(`
        UPDATE articles
        SET story_group_id = ?,
            ai_story_group_processed_at = ?,
            ai_story_group_status = 'matched',
            ai_story_group_model = ?,
            ai_story_group_match_ids = ?,
            ai_story_group_confidence = ?,
            ai_story_group_reason = ?
        WHERE id IN (${ids.map(() => '?').join(', ')})
      `).run(
        normalizedStoryGroupId,
        processedAt,
        String(model || '').slice(0, 160),
        evidence.matchIdsJson,
        evidence.confidence,
        evidence.reason,
        ...ids
      ).changes);
    }, 0);
  }

  function getArticleIdsForStoryGroups(storyGroupIds: string[] = [], ownerUserId: string | null = null) {
    const normalizedStoryGroupIds = [...new Set((Array.isArray(storyGroupIds) ? storyGroupIds : [])
      .map((storyGroupId) => String(storyGroupId || '').trim())
      .filter(Boolean))];

    if (normalizedStoryGroupIds.length === 0) {
      return [];
    }

    const ownerKey = ownerUserId || '';
    return chunkValues(normalizedStoryGroupIds).flatMap((ids) => {
      return getDb().prepare(`
        SELECT id
        FROM articles
        WHERE story_group_id IN (${ids.map(() => '?').join(', ')})
          AND COALESCE(owner_user_id, '') = ?
      `).all(...ids, ownerKey).map((row) => row.id);
    });
  }

  function getAiStoryGroupingCandidateSet(articleId: string, options: DynamicRecord = {}) {
    const normalizedArticleId = String(articleId || '').trim();
    if (!normalizedArticleId) {
      return { target: null, candidates: [] };
    }

    const database = getDb();
    const windowHours = Math.max(1, Math.min(Number(options.windowHours) || 24, 72));
    const limit = Math.max(1, Math.min(Number(options.limit) || 12, 100));
    const targetRow = database.prepare<ArticleRow>(`
      SELECT id, source_id AS sourceId, source_name AS source, title, description, content, url, canonical_url AS canonicalUrl,
             image, author, language, owner_user_id AS ownerUserId, published_at AS pubDate,
             story_group_id AS storyGroupId, ai_story_group_processed_at AS aiStoryGroupProcessedAt,
             ai_story_group_status AS aiStoryGroupStatus, ai_story_group_model AS aiStoryGroupModel,
             ai_story_group_match_ids AS aiStoryGroupMatchIds, ai_story_group_confidence AS aiStoryGroupConfidence,
             ai_story_group_reason AS aiStoryGroupReason
      FROM articles
      WHERE id = ?
    `).get(normalizedArticleId);

    if (!targetRow) {
      return { target: null, candidates: [] };
    }

    if (targetRow.aiStoryGroupStatus === 'matched') {
      return { target: hydrateArticleRows([targetRow], options)[0] || null, candidates: [] };
    }

    const targetTimestamp = Date.parse(targetRow.pubDate || '');
    if (!Number.isFinite(targetTimestamp)) {
      return { target: hydrateArticleRows([targetRow], options)[0] || null, candidates: [] };
    }

    const periodStart = new Date(targetTimestamp - (windowHours * 60 * 60 * 1000)).toISOString();
    const periodEnd = new Date(targetTimestamp + (windowHours * 60 * 60 * 1000)).toISOString();
    const rows = database.prepare<ArticleRow>(`
      SELECT id, source_id AS sourceId, source_name AS source, title, description, content, url, canonical_url AS canonicalUrl,
             image, author, language, owner_user_id AS ownerUserId, published_at AS pubDate,
             story_group_id AS storyGroupId, ai_story_group_processed_at AS aiStoryGroupProcessedAt,
             ai_story_group_status AS aiStoryGroupStatus, ai_story_group_model AS aiStoryGroupModel,
             ai_story_group_match_ids AS aiStoryGroupMatchIds, ai_story_group_confidence AS aiStoryGroupConfidence,
             ai_story_group_reason AS aiStoryGroupReason
      FROM articles
      WHERE id != ?
        AND COALESCE(owner_user_id, '') = COALESCE(?, '')
        AND published_at BETWEEN ? AND ?
      ORDER BY ABS(strftime('%s', published_at) - strftime('%s', ?)) ASC, published_at DESC
      LIMIT ?
    `).all(normalizedArticleId, targetRow.ownerUserId || '', periodStart, periodEnd, targetRow.pubDate, limit);
    const hydrated = hydrateArticleRows([targetRow, ...rows], options);

    return {
      target: hydrated[0] || null,
      candidates: hydrated.slice(1)
    };
  }

  function mergeTopicsForArticles(entries: TopicUpdate[] = []) {
    const normalizedEntries = Array.isArray(entries)
      ? entries.filter((entry) => entry.articleId && Array.isArray(entry.topics) && entry.topics.length > 0)
      : [];

    if (normalizedEntries.length === 0) {
      return 0;
    }

    const database = getDb();
    const existingEntries = filterEntriesForExistingArticles(normalizedEntries, database);

    if (existingEntries.length === 0) {
      return 0;
    }

    const insertStmt = database.prepare(`
      INSERT INTO article_topics (article_id, topic, source, confidence, evidence, reason_code)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(article_id, topic) DO UPDATE SET
        source = excluded.source,
        confidence = excluded.confidence,
        evidence = excluded.evidence,
        reason_code = excluded.reason_code
    `);

    const transaction = database.transaction((items: TopicUpdate[]) => {
      let insertedCount = 0;

      items.forEach(({ articleId, topics }) => {
        normalizeTopicEntries(topics).forEach((entry) => {
            insertedCount += Number(insertStmt.run(articleId, entry.topic, entry.source, entry.confidence, entry.evidence, entry.reasonCode).changes);
          });
      });

      return insertedCount;
    });

    return transaction(existingEntries);
  }

  function replaceTopicsForArticles(entries: TopicUpdate[] = []) {
    const normalizedEntries: NormalizedTopicUpdate[] = Array.isArray(entries)
      ? entries
        .map((entry) => ({
          articleId: entry?.articleId,
          topics: normalizeTopicEntries(entry?.topics || [], 'ai').slice(0, 3)
        }))
        .filter((entry) => entry.articleId && entry.topics.length > 0)
      : [];

    if (normalizedEntries.length === 0) {
      return 0;
    }

    const database = getDb();
    const existingEntries = filterEntriesForExistingArticles(normalizedEntries, database);

    if (existingEntries.length === 0) {
      return 0;
    }

    const deleteStmt = database.prepare('DELETE FROM article_topics WHERE article_id = ?');
    const insertStmt = database.prepare(`
      INSERT OR IGNORE INTO article_topics (article_id, topic, source, confidence, evidence, reason_code)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = database.transaction((items: NormalizedTopicUpdate[]) => {
      let insertedCount = 0;

      items.forEach(({ articleId, topics }) => {
        deleteStmt.run(articleId);
        topics.forEach((entry) => {
          insertedCount += Number(insertStmt.run(articleId, entry.topic, entry.source, entry.confidence, entry.evidence, entry.reasonCode).changes);
        });
      });

      return insertedCount;
    });

    return transaction(existingEntries);
  }

  function getTopicClassificationReport(articleId: string) {
    if (!articleId) {
      return null;
    }

    const article = getDb().prepare(`
      SELECT id, title, description, source_id AS sourceId, source_name AS sourceName,
             ai_topics_processed_at AS aiTopicsProcessedAt, ai_topics_status AS aiTopicsStatus
      FROM articles
      WHERE id = ?
    `).get(articleId);

    if (!article) {
      return null;
    }

    const topicRows = getDb().prepare(`
      SELECT topic, source, confidence, evidence, reason_code AS reasonCode, created_at AS createdAt
      FROM article_topics
      WHERE article_id = ?
      ORDER BY topic ASC
    `).all(articleId);
    const localCandidates = topicNormalizer.classifyTopicsFromText(article).map((entry: DynamicRecord) => ({
      topic: entry.topic,
      score: entry.score,
      confidence: entry.confidence,
      evidence: entry.evidence,
      negativeEvidence: entry.negativeEvidence,
      reasonCode: entry.reasonCode
    }));

    return {
      article,
      storedTopics: topicRows.map((row) => ({
        ...row,
        evidence: parseJsonArray(row.evidence)
      })),
      localCandidates
    };
  }

  function getArticles(filters: ArticleFilters = {}, options: ArticleOptions = {}) {
    const { sql, params } = buildArticleQuery(filters, options);
    const rows = getDb().prepare<ArticleRow>(sql).all(...params);
    return hydrateArticleRows(rows, options);
  }

  function getArticleById(articleId: string, options: ArticleOptions = {}) {
    if (!articleId) {
      return null;
    }

    return getArticlesByIds([articleId], options)[0] || null;
  }

  function getArticlesByIds(articleIds: string[] = [], options: ArticleOptions = {}) {
    const normalizedArticleIds = normalizeArticleIds(articleIds);
    if (normalizedArticleIds.length === 0) {
      return [];
    }

    const rows = chunkValues(normalizedArticleIds).flatMap((ids) => {
      const params = [...ids];
      const where = [`a.id IN (${ids.map(() => '?').join(', ')})`];
      const scopeFilter = buildScopeFilter(options, 'a');
      const retentionFilter = buildRetentionFilter(options, 'a');
      const publishedBeforeNowFilter = buildPublishedBeforeNowFilter('a');
      const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
      const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);

      appendFilters(
        where,
        params,
        scopeFilter,
        publishedBeforeNowFilter,
        retentionFilter,
        excludedSourceFilter,
        excludedSubSourceFilter
      );

      return getDb().prepare<ArticleRow>(`
        SELECT
          a.id,
          a.source_id AS sourceId,
          a.source_name AS source,
          a.owner_user_id AS ownerUserId,
          a.title,
          a.description,
          a.content,
          a.url,
          a.canonical_url AS canonicalUrl,
          a.image,
          a.author,
          a.language,
          a.published_at AS pubDate,
          a.story_group_id AS storyGroupId,
          a.ai_story_group_processed_at AS aiStoryGroupProcessedAt,
          a.ai_story_group_status AS aiStoryGroupStatus,
          a.ai_story_group_model AS aiStoryGroupModel,
          a.ai_story_group_match_ids AS aiStoryGroupMatchIds,
          a.ai_story_group_confidence AS aiStoryGroupConfidence,
          a.ai_story_group_reason AS aiStoryGroupReason
        FROM articles a
        WHERE ${where.join(' AND ')}
      `).all(...params);
    });

    rows.sort((left, right) => {
      const publishedComparison = String(right.pubDate || '').localeCompare(String(left.pubDate || ''));
      return publishedComparison || String(right.id || '').localeCompare(String(left.id || ''));
    });

    return hydrateArticleRows(rows, options);
  }

  function getReadLaterArticleIdSet(userId: string, articleIds: string[] = []) {
    const normalizedUserId = String(userId || '').trim();
    const normalizedArticleIds = normalizeArticleIds(articleIds);
    if (!normalizedUserId || normalizedArticleIds.length === 0) {
      return new Set();
    }

    const rows = chunkValues(normalizedArticleIds).flatMap((ids) => {
      return getDb().prepare(`
        SELECT article_id AS articleId
        FROM user_read_later_articles
        WHERE user_id = ?
          AND article_id IN (${ids.map(() => '?').join(', ')})
      `).all(normalizedUserId, ...ids);
    });

    return new Set(rows.map((row) => row.articleId));
  }

  function isReadLaterArticle(userId: string, articleId: string) {
    return getReadLaterArticleIdSet(userId, [articleId]).has(articleId);
  }

  function saveReadLaterArticles(userId: string, articleIds: string[] = [], options: ArticleOptions = {}) {
    const normalizedUserId = String(userId || '').trim();
    const normalizedArticleIds = normalizeArticleIds(articleIds);
    if (!normalizedUserId || normalizedArticleIds.length === 0) {
      return { savedArticleIds: [], savedCount: 0 };
    }

    const existingArticles = getArticlesByIds(normalizedArticleIds, {
      ...options,
      userId: normalizedUserId,
      maxArticleAgeHours: null
    });
    const accessibleArticleIds = existingArticles.map((article) => article.id);
    if (accessibleArticleIds.length === 0) {
      return { savedArticleIds: [], savedCount: 0 };
    }

    const database = getDb();
    const now = new Date().toISOString();
    const insertStmt = database.prepare(`
      INSERT OR IGNORE INTO user_read_later_articles (user_id, article_id, saved_at)
      VALUES (?, ?, ?)
    `);

    const transaction = database.transaction((ids: string[]) => {
      let savedCount = 0;
      ids.forEach((articleId) => {
        savedCount += Number(insertStmt.run(normalizedUserId, articleId, now).changes);
      });

      return savedCount;
    });

    return {
      savedArticleIds: accessibleArticleIds,
      savedCount: transaction(accessibleArticleIds)
    };
  }

  function cleanupExpiredUnsavedArticles(articleIds: string[] = [], isoTimestamp = '') {
    const normalizedArticleIds = normalizeArticleIds(articleIds);
    if (normalizedArticleIds.length === 0 || !isoTimestamp) {
      return 0;
    }

    const deleteArticles = getDb().prepare(`
      DELETE FROM articles
      WHERE id IN (${normalizedArticleIds.map(() => '?').join(', ')})
        AND published_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM user_read_later_articles
          WHERE user_read_later_articles.article_id = articles.id
        )
    `);

    return deleteArticles.run(...normalizedArticleIds, isoTimestamp).changes;
  }

  function removeReadLaterArticles(userId: string, articleIds: string[] = [], options: ArticleOptions = {}) {
    const normalizedUserId = String(userId || '').trim();
    const normalizedArticleIds = normalizeArticleIds(articleIds);
    if (!normalizedUserId || normalizedArticleIds.length === 0) {
      return { removedArticleIds: [], removedCount: 0, deletedExpiredArticleCount: 0 };
    }

    const database = getDb();
    const deleteStmt = database.prepare(`
      DELETE FROM user_read_later_articles
      WHERE user_id = ? AND article_id = ?
    `);
    const transaction = database.transaction((ids: string[]) => {
      const removedArticleIds: string[] = [];
      let removedCount = 0;

      ids.forEach((articleId) => {
        const changes = deleteStmt.run(normalizedUserId, articleId).changes;
        if (changes > 0) {
          removedArticleIds.push(articleId);
          removedCount += Number(changes);
        }
      });

      return { removedArticleIds, removedCount };
    });
    const result = transaction(normalizedArticleIds);
    const maxArticleAgeHours = Number(options.maxArticleAgeHours);
    const cutoff = Number.isFinite(maxArticleAgeHours) && maxArticleAgeHours > 0
      ? new Date(Date.now() - (maxArticleAgeHours * 60 * 60 * 1000)).toISOString()
      : '';

    return {
      ...result,
      deletedExpiredArticleCount: cleanupExpiredUnsavedArticles(result.removedArticleIds, cutoff)
    };
  }

  function getReadLaterArticles(userId: string, filters: ArticleFilters = {}, options: ArticleOptions = {}) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      return [];
    }

    const state = buildFilterState(filters);
    const params: unknown[] = [normalizedUserId];
    const joins = ['JOIN user_read_later_articles rl ON rl.article_id = a.id'];
    const where = ['rl.user_id = ?'];
    const searchQuery = buildSearchQuery(state.search);
    const scopeFilter = buildScopeFilter({ ...options, userId: normalizedUserId }, 'a');
    const publishedBeforeNowFilter = buildPublishedBeforeNowFilter('a');

    where.push(scopeFilter.clause);
    params.push(...scopeFilter.params);
    where.push(publishedBeforeNowFilter.clause);
    params.push(...publishedBeforeNowFilter.params);

    if (searchQuery) {
      joins.push('JOIN article_search ON article_search.article_id = a.id');
      where.push('article_search MATCH ?');
      params.push(searchQuery);
    }

    if (state.sourceIds.length > 0) {
      const sourceFilter = getSourceFilterClauses(state.sourceIds, { ...options, userId: normalizedUserId });
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

    const rows = getDb().prepare<ArticleRow>(`
      SELECT
        a.id,
        a.source_id AS sourceId,
        a.source_name AS source,
        a.title,
        a.description,
        a.content,
        a.url,
        a.canonical_url AS canonicalUrl,
        a.image,
        a.author,
        a.language,
        a.owner_user_id AS ownerUserId,
        a.published_at AS pubDate,
        a.story_group_id AS storyGroupId,
        a.ai_story_group_processed_at AS aiStoryGroupProcessedAt,
        a.ai_story_group_status AS aiStoryGroupStatus,
        a.ai_story_group_model AS aiStoryGroupModel,
        a.ai_story_group_match_ids AS aiStoryGroupMatchIds,
        a.ai_story_group_confidence AS aiStoryGroupConfidence,
        a.ai_story_group_reason AS aiStoryGroupReason,
        rl.saved_at AS readLaterSavedAt
      FROM articles a
      ${joins.join('\n')}
      WHERE ${where.join(' AND ')}
      ORDER BY rl.saved_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, state.limit, state.offset);

    return hydrateArticleRows(rows, { ...options, userId: normalizedUserId });
  }

  function getArticlesForThematicSummary({
    topics = [],
    excludedTopics = [],
    periodStart,
    periodEnd,
    limit = 80
  }: {
    topics?: string[];
    excludedTopics?: string[];
    periodStart?: string;
    periodEnd?: string;
    limit?: number;
  } = {}) {
    const normalizedTopics = [...new Set((Array.isArray(topics) ? topics : [])
      .map((topic) => topicNormalizer.normalizeTopic(topic))
      .filter((topic) => topic && topicNormalizer.isCanonicalTopic(topic)))];
    const normalizedExcludedTopics = [...new Set((Array.isArray(excludedTopics) ? excludedTopics : [])
      .map((topic) => topicNormalizer.normalizeTopic(topic))
      .filter((topic) => topic && topicNormalizer.isCanonicalTopic(topic) && !normalizedTopics.includes(topic)))];
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 80, 300));

    if (normalizedTopics.length === 0 || !periodStart || !periodEnd) {
      return [];
    }

    const excludedTopicClause = normalizedExcludedTopics.length > 0 ? `
        AND NOT EXISTS (
          SELECT 1
          FROM article_topics competing_topics
          WHERE competing_topics.article_id = a.id
            AND competing_topics.topic IN (${normalizedExcludedTopics.map(() => '?').join(', ')})
            AND COALESCE(competing_topics.confidence, 0) > COALESCE(at.confidence, 0)
        )
    ` : '';

    const rows = getDb().prepare<ArticleRow>(`
      SELECT DISTINCT
        a.id,
        a.source_id AS sourceId,
        a.source_name AS source,
        a.title,
        a.description,
        a.content,
        a.url,
        a.canonical_url AS canonicalUrl,
        a.image,
        a.author,
        a.language,
        a.owner_user_id AS ownerUserId,
        a.published_at AS pubDate,
        a.story_group_id AS storyGroupId,
        a.ai_story_group_processed_at AS aiStoryGroupProcessedAt,
        a.ai_story_group_status AS aiStoryGroupStatus,
        a.ai_story_group_model AS aiStoryGroupModel,
        a.ai_story_group_match_ids AS aiStoryGroupMatchIds,
        a.ai_story_group_confidence AS aiStoryGroupConfidence,
        a.ai_story_group_reason AS aiStoryGroupReason
      FROM articles a
      JOIN article_topics at ON at.article_id = a.id
      WHERE a.owner_user_id IS NULL
        AND a.published_at >= ?
        AND a.published_at < ?
        AND a.published_at <= ?
        AND at.topic IN (${normalizedTopics.map(() => '?').join(', ')})
        ${excludedTopicClause}
      ORDER BY a.published_at DESC, a.id DESC
      LIMIT ?
    `).all(periodStart, periodEnd, new Date().toISOString(), ...normalizedTopics, ...normalizedExcludedTopics, normalizedLimit);

    return hydrateArticleRows(rows, { userId: null });
  }

  function hasPendingTopicProcessingForThematicSummary({ periodStart, periodEnd }: { periodStart?: string; periodEnd?: string } = {}) {
    if (!periodStart || !periodEnd) {
      return false;
    }

    const row = getDb().prepare(`
      SELECT 1
      FROM articles
      WHERE owner_user_id IS NULL
        AND published_at >= ?
        AND published_at < ?
        AND published_at <= ?
        AND (
          ai_topics_processed_at IS NULL
          OR ai_topics_status IN ('failed', 'deferred')
        )
      LIMIT 1
    `).get(periodStart, periodEnd, new Date().toISOString());

    return Boolean(row);
  }

  function normalizeSummarySources(sources: unknown = []) {
    if (!Array.isArray(sources)) {
      return [];
    }

    return sources.map((value, index) => {
      const source = getRecord(value);
      return {
      index: Number(source?.index) || index + 1,
      articleId: String(source?.articleId || '').trim(),
      title: String(source?.title || '').trim().slice(0, 300),
      source: String(source?.source || '').trim().slice(0, 120),
      sourceIconUrl: String(source?.sourceIconUrl || '').trim().slice(0, 1000),
      url: String(source?.url || '').trim().slice(0, 1000),
        publishedAt: String(source.publishedAt || '').trim()
      };
    }).filter((source) => source.articleId && source.title);
  }

  function normalizeLocalizedTextFields(summary: DynamicRecord = {}, textFieldName: string, textByLocaleFieldName: string) {
    const textByLocale = getRecord(summary[textByLocaleFieldName]);
    const textEnKey = `${textFieldName}En`;
    const textItKey = `${textFieldName}It`;
    const textEn = String(summary[textEnKey] || textByLocale.en || summary[textFieldName] || '').trim();
    const textIt = String(summary[textItKey] || textByLocale.it || textEn || summary[textFieldName] || '').trim();

    return {
      text: textEn || textIt,
      textEn,
      textIt
    };
  }

  function normalizeLocalizedSummaryFields(summary: DynamicRecord = {}, textFieldName: string, textByLocaleFieldName: string) {
    const titleByLocale = getRecord(summary.titleByLocale);
    const titleEn = String(summary.titleEn || titleByLocale.en || summary.title || '').trim().slice(0, 180);
    const titleIt = String(summary.titleIt || titleByLocale.it || titleEn || summary.title || '').trim().slice(0, 180);
    const localizedText = normalizeLocalizedTextFields(summary, textFieldName, textByLocaleFieldName);

    return {
      ...localizedText,
      title: titleEn || titleIt,
      titleEn,
      titleIt
    };
  }

  function getLocalizedTextRowFields(row: Row = {}, textFieldName: string) {
    const textEnKey = `${textFieldName}En`;
    const textItKey = `${textFieldName}It`;

    return {
      text: row[textEnKey] || row[textFieldName] || row[textItKey] || '',
      textByLocale: {
        en: row[textEnKey] || row[textFieldName] || row[textItKey] || '',
        it: row[textItKey] || row[textEnKey] || row[textFieldName] || ''
      }
    };
  }

  function getLocalizedSummaryRowFields(row: Row = {}, textFieldName: string) {
    const localizedText = getLocalizedTextRowFields(row, textFieldName);

    return {
      ...localizedText,
      title: row.titleEn || row.title || row.titleIt || '',
      titleByLocale: {
        en: row.titleEn || row.title || row.titleIt || '',
        it: row.titleIt || row.titleEn || row.title || ''
      }
    };
  }

  function normalizeSummaryPayload(summary: DynamicRecord = {}) {
    const topicKey = String(summary.topicKey || '').trim();
    const periodStart = String(summary.periodStart || '').trim();
    const periodEnd = String(summary.periodEnd || '').trim();

    if (!topicKey || !periodStart || !periodEnd) {
      return null;
    }

    const id = String(summary.id || `${topicKey}:${periodStart}:${periodEnd}`).trim();
    const localized = normalizeLocalizedTextFields(summary, 'summaryText', 'summaryTextByLocale');

    return {
      id,
      topicKey,
      topicLabel: String(summary.topicLabel || topicKey).trim().slice(0, 80),
      topicsJson: JSON.stringify(Array.isArray(summary.topics) ? summary.topics : []),
      periodStart,
      periodEnd,
      summaryText: localized.text,
      summaryTextEn: localized.textEn,
      summaryTextIt: localized.textIt,
      sourcesJson: JSON.stringify(normalizeSummarySources(summary.sources || [])),
      articleCount: Math.max(0, Number(summary.articleCount) || 0),
      model: String(summary.model || '').trim().slice(0, 120),
      status: String(summary.status || 'completed').trim().slice(0, 40),
      failureCategory: String(summary.failureCategory || '').trim().slice(0, 80),
      retryCount: Math.max(0, Number(summary.retryCount) || 0),
      errorMessage: summary.errorMessage ? String(summary.errorMessage).trim().slice(0, 1000) : null,
      generatedAt: String(summary.generatedAt || new Date().toISOString()).trim()
    };
  }

  function mapThematicSummaryRow(row: Row | undefined | null) {
    if (!row) {
      return null;
    }

    const localized = getLocalizedTextRowFields(row, 'summaryText');

    return {
      id: row.id,
      topicKey: row.topicKey,
      topicLabel: row.topicLabel,
      topics: parseJsonArray(row.topicsJson),
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      summaryText: localized.text,
      summaryTextByLocale: localized.textByLocale,
      sources: parseJsonArray(row.sourcesJson),
      articleCount: row.articleCount,
      model: row.model,
      status: row.status,
      failureCategory: row.failureCategory || '',
      retryCount: row.retryCount || 0,
      errorMessage: row.errorMessage,
      generatedAt: row.generatedAt
    };
  }

  function normalizePodcastAudioData(audioData: unknown) {
    if (!audioData) {
      return null;
    }

    if (Buffer.isBuffer(audioData)) {
      return audioData;
    }

    if (typeof audioData === 'string') {
      const base64Data = audioData.includes(',') && /^data:audio\//i.test(audioData)
        ? audioData.slice(audioData.indexOf(',') + 1)
        : audioData;
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        return buffer.length > 0 ? buffer : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  function normalizePodcastLocale(locale: unknown = '') {
    const normalized = String(locale || '').trim().toLowerCase().replace(/_/gu, '-');
    return /^[a-z]{2}(?:-[a-z0-9]{2,8})?$/u.test(normalized) ? normalized : '';
  }

  function normalizePodcastAudioEntry(locale: unknown, entry: DynamicRecord = {}, defaultGeneratedAt = ''): NormalizedPodcastAudioEntry | null {
    const normalizedLocale = normalizePodcastLocale(locale);
    if (!normalizedLocale) {
      return null;
    }

    const audio = getRecord(entry.audio);
    const audioBlob = normalizePodcastAudioData(entry.audioData || audio.data || entry.data || null);
    const requestedAudioStatus = String(entry.audioStatus || (audioBlob ? 'completed' : 'not_available')).trim().slice(0, 40);
    const audioStatus = requestedAudioStatus === 'completed' && !audioBlob ? 'not_available' : requestedAudioStatus;

    return {
      locale: normalizedLocale,
      audioModel: String(entry.audioModel || audio.model || '').trim().slice(0, 120),
      audioVoice: String(entry.audioVoice || audio.voice || '').trim().slice(0, 120),
      audioMimeType: String(entry.audioMimeType || audio.mimeType || '').trim().slice(0, 120),
      audioBlob,
      audioStatus,
      audioErrorMessage: entry.audioErrorMessage ? String(entry.audioErrorMessage).trim().slice(0, 1000) : null,
      audioFailureCategory: String(entry.audioFailureCategory || '').trim().slice(0, 80),
      audioRetryCount: Math.max(0, Number(entry.audioRetryCount) || 0),
      audioFailedAt: entry.audioFailedAt ? String(entry.audioFailedAt).trim() : null,
      generatedAt: String(entry.generatedAt || audio.generatedAt || defaultGeneratedAt || new Date().toISOString()).trim()
    };
  }

  function normalizePodcastAudioEntries(summary: DynamicRecord = {}, defaultGeneratedAt = '') {
    const entries: NormalizedPodcastAudioEntry[] = [];
    const audioByLocale = getRecord(summary.audioByLocale);

    Object.entries(audioByLocale).forEach(([locale, entry]) => {
      const normalized = normalizePodcastAudioEntry(locale, getRecord(entry), defaultGeneratedAt);
      if (normalized) {
        entries.push(normalized);
      }
    });

    if (summary.audio || summary.audioData || summary.audioStatus) {
      const legacyLocale = normalizePodcastLocale(summary.audioLocale || summary.locale || 'it');
      const normalized = normalizePodcastAudioEntry(legacyLocale, summary, defaultGeneratedAt);
      if (normalized) {
        entries.push(normalized);
      }
    }

    return [...new Map(entries.map((entry) => [entry.locale, entry])).values()];
  }

  function normalizePodcastSummaryPayload(summary: DynamicRecord = {}) {
    const periodStart = String(summary.periodStart || '').trim();
    const periodEnd = String(summary.periodEnd || '').trim();

    if (!periodStart || !periodEnd) {
      return null;
    }

    const id = String(summary.id || `podcast:${periodStart}:${periodEnd}`).trim();
    const localized = normalizeLocalizedSummaryFields(summary, 'scriptText', 'scriptTextByLocale');
    const generatedAt = String(summary.generatedAt || new Date().toISOString()).trim();
    const audioEntries = normalizePodcastAudioEntries(summary, generatedAt);

    return {
      id,
      periodStart,
      periodEnd,
      title: localized.title,
      scriptText: localized.text,
      titleEn: localized.titleEn,
      scriptTextEn: localized.textEn,
      titleIt: localized.titleIt,
      scriptTextIt: localized.textIt,
      sourcesJson: JSON.stringify(normalizeSummarySources(summary.sources || [])),
      articleCount: Math.max(0, Number(summary.articleCount) || 0),
      scriptModel: String(summary.scriptModel || summary.model || '').trim().slice(0, 120),
      status: String(summary.status || 'completed').trim().slice(0, 40),
      failureCategory: String(summary.failureCategory || '').trim().slice(0, 80),
      retryCount: Math.max(0, Number(summary.retryCount) || 0),
      errorMessage: summary.errorMessage ? String(summary.errorMessage).trim().slice(0, 1000) : null,
      generatedAt,
      audioEntries
    };
  }

  function mapPodcastSummaryRow(row: Row | undefined | null) {
    if (!row) {
      return null;
    }

    const localized = getLocalizedSummaryRowFields(row, 'scriptText');
    const audioByLocale = getPodcastSummaryAudioRows(String(row.id || ''));
    const audioLocales = Object.keys(audioByLocale);
    const completedAudioLocales = audioLocales.filter((locale) => audioByLocale[locale]?.audioStatus === 'completed' && audioByLocale[locale]?.audioUrl);
    const primaryAudioLocale = completedAudioLocales.includes('en')
      ? 'en'
      : (completedAudioLocales[0] || (audioLocales.includes('en') ? 'en' : audioLocales[0]));
    const primaryAudio = primaryAudioLocale ? audioByLocale[primaryAudioLocale] : null;

    return {
      id: row.id,
      type: 'podcast',
      topicKey: 'podcast',
      topicLabel: 'Podcast',
      topics: ['Podcast'],
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      title: localized.title,
      summaryText: localized.text,
      titleByLocale: localized.titleByLocale,
      summaryTextByLocale: localized.textByLocale,
      sources: parseJsonArray(row.sourcesJson),
      articleCount: row.articleCount,
      model: row.scriptModel,
      audioByLocale,
      availableAudioLocales: completedAudioLocales,
      audioLocale: primaryAudioLocale || '',
      audioModel: primaryAudio?.audioModel || '',
      audioVoice: primaryAudio?.audioVoice || '',
      audioMimeType: primaryAudio?.audioMimeType || '',
      audioStatus: primaryAudio?.audioStatus || 'not_available',
      audioErrorMessage: primaryAudio?.audioErrorMessage || null,
      audioFailureCategory: primaryAudio?.audioFailureCategory || '',
      audioRetryCount: primaryAudio?.audioRetryCount ?? 0,
      audioFailedAt: primaryAudio?.audioFailedAt || null,
      audioUrl: primaryAudio?.audioUrl || '',
      status: row.status,
      failureCategory: row.failureCategory || '',
      retryCount: row.retryCount || 0,
      errorMessage: row.errorMessage,
      generatedAt: row.generatedAt
    };
  }

  function mapPodcastAudioRow(row: Row | undefined | null, podcastId = ''): DynamicRecord | null {
    if (!row) {
      return null;
    }

    const locale = normalizePodcastLocale(row.locale);
    if (!locale) {
      return null;
    }

    return {
      locale,
      audioModel: row.audioModel || '',
      audioVoice: row.audioVoice || '',
      audioMimeType: row.audioMimeType || '',
      audioStatus: row.audioStatus || 'not_available',
      audioErrorMessage: row.audioErrorMessage || '',
      audioFailureCategory: row.audioFailureCategory || '',
      audioRetryCount: row.audioRetryCount || 0,
      audioFailedAt: row.audioFailedAt || null,
      generatedAt: row.generatedAt || '',
      audioUrl: row.audioStatus === 'completed'
        ? `/api/podcast-summary/${encodeURIComponent(podcastId)}/audio?locale=${encodeURIComponent(locale)}&v=${encodeURIComponent([row.generatedAt, row.audioModel, row.audioVoice].filter(Boolean).join(':'))}`
        : ''
    };
  }

  function getPodcastSummaryAudioRows(podcastId = ''): Record<string, DynamicRecord> {
    const normalizedPodcastId = String(podcastId || '').trim();
    if (!normalizedPodcastId) {
      return {};
    }

    const rows = getDb().prepare(`
      SELECT locale, audio_model AS audioModel, audio_voice AS audioVoice,
             audio_mime_type AS audioMimeType, audio_status AS audioStatus,
             audio_error_message AS audioErrorMessage, audio_failure_category AS audioFailureCategory,
             audio_retry_count AS audioRetryCount, audio_failed_at AS audioFailedAt,
             generated_at AS generatedAt
      FROM podcast_summary_audio
      WHERE podcast_id = ?
      ORDER BY locale ASC
    `).all(normalizedPodcastId);

    const audioRows = rows
      .map((row) => mapPodcastAudioRow(row, normalizedPodcastId))
      .filter((row): row is DynamicRecord => row !== null);
    return Object.fromEntries(audioRows.map((row) => [row.locale, row]));
  }

  function upsertPodcastAudioRow(podcastId: string, audioEntry: DynamicRecord = {}) {
    const normalizedPodcastId = String(podcastId || '').trim();
    if (!normalizedPodcastId || !audioEntry?.locale) {
      return;
    }

    getDb().prepare(`
      INSERT INTO podcast_summary_audio (
        podcast_id, locale, audio_model, audio_voice, audio_mime_type, audio_blob,
        audio_status, audio_error_message, audio_failure_category, audio_retry_count,
        audio_failed_at, generated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(podcast_id, locale) DO UPDATE SET
        audio_model = excluded.audio_model,
        audio_voice = excluded.audio_voice,
        audio_mime_type = excluded.audio_mime_type,
        audio_blob = excluded.audio_blob,
        audio_status = excluded.audio_status,
        audio_error_message = excluded.audio_error_message,
        audio_failure_category = excluded.audio_failure_category,
        audio_retry_count = excluded.audio_retry_count,
        audio_failed_at = excluded.audio_failed_at,
        generated_at = excluded.generated_at
    `).run(
      normalizedPodcastId,
      audioEntry.locale,
      audioEntry.audioModel,
      audioEntry.audioVoice,
      audioEntry.audioMimeType,
      audioEntry.audioBlob,
      audioEntry.audioStatus,
      audioEntry.audioErrorMessage,
      audioEntry.audioFailureCategory,
      audioEntry.audioRetryCount,
      audioEntry.audioFailedAt,
      audioEntry.generatedAt
    );
  }

  function upsertThematicSummary(summary: DynamicRecord = {}) {
    const normalized = normalizeSummaryPayload(summary);
    if (!normalized) {
      return null;
    }

    getDb().prepare(`
      INSERT INTO thematic_summaries (
        id, topic_key, topic_label, topics_json, period_start, period_end,
        summary_text, summary_text_en, summary_text_it,
        sources_json, article_count, model, status, failure_category, retry_count, error_message, generated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(topic_key, period_start, period_end) DO UPDATE SET
        topic_label = excluded.topic_label,
        topics_json = excluded.topics_json,
        summary_text = excluded.summary_text,
        summary_text_en = excluded.summary_text_en,
        summary_text_it = excluded.summary_text_it,
        sources_json = excluded.sources_json,
        article_count = excluded.article_count,
        model = excluded.model,
        status = excluded.status,
        failure_category = excluded.failure_category,
        retry_count = excluded.retry_count,
        error_message = excluded.error_message,
        generated_at = excluded.generated_at
    `).run(
      normalized.id,
      normalized.topicKey,
      normalized.topicLabel,
      normalized.topicsJson,
      normalized.periodStart,
      normalized.periodEnd,
      normalized.summaryText,
      normalized.summaryTextEn,
      normalized.summaryTextIt,
      normalized.sourcesJson,
      normalized.articleCount,
      normalized.model,
      normalized.status,
      normalized.failureCategory,
      normalized.retryCount,
      normalized.errorMessage,
      normalized.generatedAt
    );

    return getThematicSummary(normalized.topicKey, normalized.periodStart, normalized.periodEnd);
  }

  function getThematicSummary(topicKey: string, periodStart: string, periodEnd: string) {
    const row = getDb().prepare(`
      SELECT id, topic_key AS topicKey, topic_label AS topicLabel, topics_json AS topicsJson,
             period_start AS periodStart, period_end AS periodEnd, summary_text AS summaryText,
             summary_text_en AS summaryTextEn, summary_text_it AS summaryTextIt,
             sources_json AS sourcesJson, article_count AS articleCount, model, status,
             failure_category AS failureCategory, retry_count AS retryCount,
             error_message AS errorMessage, generated_at AS generatedAt
      FROM thematic_summaries
      WHERE topic_key = ? AND period_start = ? AND period_end = ?
      LIMIT 1
    `).get(topicKey, periodStart, periodEnd);

    return mapThematicSummaryRow(row);
  }

  function listLatestThematicSummaries(topicKeys: string[] = [], limitPerTopic = 1) {
    const normalizedTopicKeys = [...new Set((Array.isArray(topicKeys) ? topicKeys : [])
      .map((topicKey) => String(topicKey || '').trim())
      .filter(Boolean))];
    if (normalizedTopicKeys.length === 0) {
      return [];
    }

    const normalizedLimit = Math.max(1, Math.min(10, Number(limitPerTopic) || 1));
    const rows = getDb().prepare(`
      SELECT id, topic_key AS topicKey, topic_label AS topicLabel, topics_json AS topicsJson,
             period_start AS periodStart, period_end AS periodEnd, summary_text AS summaryText,
             summary_text_en AS summaryTextEn, summary_text_it AS summaryTextIt,
             sources_json AS sourcesJson, article_count AS articleCount, model, status,
             failure_category AS failureCategory, retry_count AS retryCount,
             error_message AS errorMessage, generated_at AS generatedAt
      FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY topic_key
          ORDER BY period_end DESC, generated_at DESC
        ) AS summary_rank
        FROM thematic_summaries
        WHERE topic_key IN (${normalizedTopicKeys.map(() => '?').join(', ')})
          AND status IN ('completed', 'empty')
      ) ranked
      WHERE summary_rank <= ?
      ORDER BY period_end DESC, topic_key ASC
    `).all(...normalizedTopicKeys, normalizedLimit);

    return rows.map(mapThematicSummaryRow).filter(Boolean);
  }

  function pruneSummaryHistory(options: DynamicRecord = {}) {
    const periodEnd = String(options.periodEnd || '').trim();
    if (!periodEnd) {
      return { thematicSummaries: 0, podcastSummaries: 0 };
    }

    const topicKeys = [...new Set((Array.isArray(options.topicKeys) ? options.topicKeys : [])
      .map((topicKey) => String(topicKey || '').trim())
      .filter(Boolean))];
    const db = getDb();
    const thematicRetainCount = Math.max(1, Number(options.thematicRetainCount) || 1);
    const thematicSummaries = topicKeys.length > 0
      ? db.prepare(`
        DELETE FROM thematic_summaries
        WHERE period_end < ?
          AND topic_key IN (${topicKeys.map(() => '?').join(', ')})
          AND id NOT IN (
            SELECT retained.id
            FROM thematic_summaries retained
            WHERE retained.topic_key = thematic_summaries.topic_key
              AND retained.period_end <= ?
              AND retained.status IN ('completed', 'empty')
            ORDER BY retained.period_end DESC, retained.generated_at DESC
            LIMIT ?
          )
      `).run(periodEnd, ...topicKeys, periodEnd, thematicRetainCount).changes
      : 0;
    const podcastRetainCount = Math.max(1, Number(options.podcastRetainCount) || 1);
    const podcastSummaries = options.podcast === true
      ? db.prepare(`
        DELETE FROM podcast_summaries
        WHERE period_end < ?
          AND period_end NOT IN (
            SELECT period_end
            FROM podcast_summaries
            WHERE period_end <= ?
              AND status IN ('completed', 'empty', 'failed')
            ORDER BY period_end DESC
            LIMIT ?
          )
      `).run(periodEnd, periodEnd, podcastRetainCount).changes
      : 0;

    return { thematicSummaries, podcastSummaries };
  }

  function upsertPodcastSummary(summary: DynamicRecord = {}) {
    const normalized = normalizePodcastSummaryPayload(summary);
    if (!normalized) {
      return null;
    }

    const database = getDb();
    const upsertPodcast = database.prepare(`
      INSERT INTO podcast_summaries (
        id, period_start, period_end, title, script_text, title_en, script_text_en,
        title_it, script_text_it, sources_json, article_count, script_model,
        status, failure_category, retry_count, error_message, generated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(period_start, period_end) DO UPDATE SET
        title = excluded.title,
        script_text = excluded.script_text,
        title_en = excluded.title_en,
        script_text_en = excluded.script_text_en,
        title_it = excluded.title_it,
        script_text_it = excluded.script_text_it,
        sources_json = excluded.sources_json,
        article_count = excluded.article_count,
        script_model = excluded.script_model,
        status = excluded.status,
        failure_category = excluded.failure_category,
        retry_count = excluded.retry_count,
        error_message = excluded.error_message,
        generated_at = excluded.generated_at
      RETURNING id
    `);
    const transaction = database.transaction(() => {
      const persistedPodcast = upsertPodcast.get(
        normalized.id,
        normalized.periodStart,
        normalized.periodEnd,
        normalized.title,
        normalized.scriptText,
        normalized.titleEn,
        normalized.scriptTextEn,
        normalized.titleIt,
        normalized.scriptTextIt,
        normalized.sourcesJson,
        normalized.articleCount,
        normalized.scriptModel,
        normalized.status,
        normalized.failureCategory,
        normalized.retryCount,
        normalized.errorMessage,
        normalized.generatedAt
      );

      normalized.audioEntries.forEach((audioEntry) => upsertPodcastAudioRow(String(persistedPodcast!.id), audioEntry));
    });

    transaction();

    return getPodcastSummary(normalized.periodStart, normalized.periodEnd);
  }

  function getPodcastSummary(periodStart: string, periodEnd: string) {
    const row = getDb().prepare(`
      SELECT id, period_start AS periodStart, period_end AS periodEnd, title, script_text AS scriptText,
             title_en AS titleEn, script_text_en AS scriptTextEn,
             title_it AS titleIt, script_text_it AS scriptTextIt,
             sources_json AS sourcesJson, article_count AS articleCount, script_model AS scriptModel,
             status, failure_category AS failureCategory, retry_count AS retryCount, error_message AS errorMessage,
             generated_at AS generatedAt
      FROM podcast_summaries
      WHERE period_start = ? AND period_end = ?
      LIMIT 1
    `).get(periodStart, periodEnd);

    return mapPodcastSummaryRow(row);
  }

  function listLatestPodcastSummaries(limit = 1) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 1, 10));
    const rows = getDb().prepare(`
      SELECT id, period_start AS periodStart, period_end AS periodEnd, title, script_text AS scriptText,
             title_en AS titleEn, script_text_en AS scriptTextEn,
             title_it AS titleIt, script_text_it AS scriptTextIt,
             sources_json AS sourcesJson, article_count AS articleCount, script_model AS scriptModel,
             status, failure_category AS failureCategory, retry_count AS retryCount, error_message AS errorMessage,
             generated_at AS generatedAt
      FROM podcast_summaries
      WHERE status IN ('completed', 'empty', 'failed')
      ORDER BY period_end DESC
      LIMIT ?
    `).all(normalizedLimit);

    return rows.map(mapPodcastSummaryRow).filter(Boolean);
  }

  function getPodcastSummaryAudio(podcastId: string, locale: unknown = '') {
    const normalizedPodcastId = String(podcastId || '').trim();
    const requestedLocale = String(locale || '').trim();
    const normalizedLocale = normalizePodcastLocale(locale);
    if (requestedLocale && !normalizedLocale) {
      return null;
    }

    const audioRow = normalizedLocale ? getDb().prepare(`
      SELECT audio_blob AS audioBlob, audio_mime_type AS audioMimeType
      FROM podcast_summary_audio
      WHERE podcast_id = ? AND locale = ? AND audio_status = 'completed' AND audio_blob IS NOT NULL
      LIMIT 1
    `).get(normalizedPodcastId, normalizedLocale) : getDb().prepare(`
      SELECT audio_blob AS audioBlob, audio_mime_type AS audioMimeType
      FROM podcast_summary_audio
      WHERE podcast_id = ? AND audio_status = 'completed' AND audio_blob IS NOT NULL
      ORDER BY CASE locale WHEN 'en' THEN 0 WHEN 'it' THEN 1 ELSE 2 END, locale ASC
      LIMIT 1
    `).get(normalizedPodcastId);

    if (audioRow?.audioBlob) {
      return {
        data: audioRow.audioBlob,
        mimeType: audioRow.audioMimeType || 'audio/mpeg'
      };
    }

    return null;
  }

  function countArticles(options: ArticleOptions = {}) {
    const scopeFilter = buildScopeFilter(options, 'articles');
    const configuredSourceFilter = buildConfiguredSourceFilter(options, 'articles');
    const retentionFilter = buildRetentionFilter(options, 'articles');
    const publishedBeforeNowFilter = buildPublishedBeforeNowFilter('articles');
    const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options, 'articles');
    const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || [], 'articles');
    const where: string[] = [];
    const params: unknown[] = [];
    appendFilters(
      where,
      params,
      scopeFilter,
      configuredSourceFilter,
      publishedBeforeNowFilter,
      retentionFilter,
      excludedSourceFilter,
      excludedSubSourceFilter
    );

    return getDb().prepare(`
      SELECT COUNT(*) AS count
      FROM articles
      WHERE ${where.join(' AND ')}
    `).get(...params)?.count || 0;
  }

  function deleteArticlesOlderThan(isoTimestamp: string) {
    if (!isoTimestamp) {
      return 0;
    }

    return getDb().prepare(`
      DELETE FROM articles
      WHERE published_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM user_read_later_articles
          WHERE user_read_later_articles.article_id = articles.id
        )
    `).run(isoTimestamp).changes;
  }

  function normalizeFuturePublicationDates(referenceTimestamp = new Date().toISOString()) {
    const normalizedReferenceTimestamp = new Date(referenceTimestamp).toISOString();
    const normalizedPublicationDate = getCurrentPublicationDay(normalizedReferenceTimestamp).toISOString();

    return getDb().prepare(`
      UPDATE articles
      SET published_at = ?, updated_at = ?
      WHERE published_at > ?
    `).run(normalizedPublicationDate, normalizedReferenceTimestamp, normalizedReferenceTimestamp).changes;
  }

  function cleanupRemovedConfiguredSourceData() {
    const database = getDb();
    const retainedGlobalSourceIds = [...new Set([
      ...getRawConfiguredSourceIds(),
      ...getConfiguredSourceGroupIds(),
      ...getLegacyConfiguredSourceGroupIds(),
    ])];
    const configuredSourceGroupIds = getConfiguredSourceGroupIds();
    const groupedConfiguredSourceIds = getGroupedConfiguredSourceIds();
    const selectSettings = database.prepare(`
      SELECT user_id AS userId,
             excluded_source_ids AS excludedSourceIds,
             excluded_sub_source_ids AS excludedSubSourceIds
      FROM user_settings
    `);
    const selectUserSourceIds = database.prepare<UserSourceRow>('SELECT user_id AS userId, id FROM user_sources');
    const updateSettings = database.prepare(`
      UPDATE user_settings
      SET excluded_source_ids = ?,
          excluded_sub_source_ids = ?,
          updated_at = ?
      WHERE user_id = ?
    `);

    const transaction = database.transaction(() => {
      let updatedSettings = 0;
      const now = new Date().toISOString();
      const retainedPlaceholders = retainedGlobalSourceIds.map(() => '?').join(', ');
      const removedArticleFilter = retainedGlobalSourceIds.length > 0
        ? `owner_user_id IS NULL AND source_id NOT IN (${retainedPlaceholders})`
        : 'owner_user_id IS NULL';
      const removableArticleFilter = `${removedArticleFilter}
        AND NOT EXISTS (
          SELECT 1
          FROM user_read_later_articles
          WHERE user_read_later_articles.article_id = articles.id
        )`;
      const deleteArticles = database.prepare(`
        DELETE FROM articles
        WHERE ${removableArticleFilter}
      `);
      const customSourceIdsByUserId = new Map<string, Set<string>>();

      selectUserSourceIds.all().forEach((source) => {
        const sourceIds = customSourceIdsByUserId.get(String(source.userId)) || new Set<string>();
        sourceIds.add(source.id);
        customSourceIdsByUserId.set(String(source.userId), sourceIds);
      });

      const removedArticles = deleteArticles.run(...retainedGlobalSourceIds).changes;

      selectSettings.all().forEach((row) => {
        const excludedSourceIds = parseJsonArray<string>(row.excludedSourceIds);
        const excludedSubSourceIds = parseJsonArray<string>(row.excludedSubSourceIds);
        const customSourceIds = customSourceIdsByUserId.get(String(row.userId)) || new Set<string>();
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

  function getSourceStats(configuredSources: ConfiguredSource[] = [], options: ArticleOptions = {}) {
    const scopeFilter = buildScopeFilter(options, 'articles');
    const configuredSourceFilter = buildConfiguredSourceFilter(options, 'articles');
    const readLaterFilter = buildReadLaterFilter(options, 'articles');
    const retentionFilter = buildRetentionFilter(options, 'articles');
    const publishedBeforeNowFilter = buildPublishedBeforeNowFilter('articles');
    const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options, 'articles');
    const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || [], 'articles');
    const where: string[] = [];
    const params: unknown[] = [];
    appendFilters(
      where,
      params,
      scopeFilter,
      configuredSourceFilter,
      readLaterFilter,
      publishedBeforeNowFilter,
      retentionFilter,
      excludedSourceFilter,
      excludedSubSourceFilter
    );

    const rows = getDb().prepare<SourceStatRow>(`
      SELECT source_id AS id, source_name AS name, COUNT(*) AS count
      FROM articles
      WHERE ${where.join(' AND ')}
      GROUP BY source_id, source_name
      ORDER BY count DESC, name ASC
    `).all(...params);

    const metadataCache = options.sourceMetadataCache || new Map<string, SourceMetadata>();
    const aggregatedRows = rows.reduce<Map<string, AggregatedSourceStat>>((map, row) => {
      const cacheKey = `${options.userId || ''}:${row.id || ''}:${row.name || ''}`;
      let sourceMetadata = metadataCache.get(cacheKey);

      if (!sourceMetadata) {
        sourceMetadata = getResolvedSourceMetadata(row.id, row.name, options.userId || null, options.customSourceGroups || null);
        metadataCache.set(cacheKey, sourceMetadata);
      }
      const canonicalId = sourceMetadata.sourceId;
      const current = map.get(canonicalId) || {
        id: canonicalId,
        name: sourceMetadata.sourceName,
        count: 0
      };

      current.count += row.count;
      map.set(canonicalId, current);
      return map;
    }, new Map<string, AggregatedSourceStat>());

    const merged: AggregatedSourceStat[] = configuredSources.map((source) => ({
      id: source.id,
      name: source.name,
      language: source.language,
      iconUrl: source.iconUrl || '',
      count: aggregatedRows.get(source.id)?.count || 0
    }));

    aggregatedRows.forEach((row) => {
      if (!configuredSources.some((source) => source.id === row.id)) {
        merged.push({ ...row, language: null });
      }
    });

    return merged.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function getTopicStatsByFilters(filters: ArticleFilters = {}, limit = 20, options: ArticleOptions = {}) {
    const state = buildFilterState(filters);
    const params: unknown[] = [];
    const joins = ['JOIN articles a ON a.id = article_topics.article_id'];
    const where: string[] = [];
    const searchQuery = buildSearchQuery(state.search);
    const scopeFilter = buildScopeFilter(options, 'a');
    const configuredSourceFilter = buildConfiguredSourceFilter(options, 'a');
    const readLaterFilter = buildReadLaterFilter(options, 'a');
    const retentionFilter = buildRetentionFilter(options, 'a');
    const publishedBeforeNowFilter = buildPublishedBeforeNowFilter('a');
    const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
    const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);
    const canonicalTopics = topicNormalizer.CANONICAL_TOPICS;

    where.push(`article_topics.topic IN (${canonicalTopics.map(() => '?').join(', ')})`);
    params.push(...canonicalTopics);

    appendFilters(
      where,
      params,
      scopeFilter,
      configuredSourceFilter,
      readLaterFilter,
      publishedBeforeNowFilter,
      retentionFilter,
      excludedSourceFilter,
      excludedSubSourceFilter
    );

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
      LIMIT ?
    `).all(...params, limit);

    return rows;
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

  function completeIngestionRun(runId: number | bigint, result: DynamicRecord = {}) {
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

  return {
    getArticles,
    getArticleById,
    getReadLaterArticles,
    getArticlesForThematicSummary,
    hasPendingTopicProcessingForThematicSummary,
    upsertThematicSummary,
    getThematicSummary,
    listLatestThematicSummaries,
    pruneSummaryHistory,
    upsertPodcastSummary,
    getPodcastSummary,
    listLatestPodcastSummaries,
    getPodcastSummaryAudio,
    getReadLaterArticleIdSet,
    isReadLaterArticle,
    saveReadLaterArticles,
    removeReadLaterArticles,
    getArticleIdsPendingAiTopicProcessing,
    getArticleIdsPendingAiStoryGrouping,
    getArticleIdsForAiStoryGroupingRetry,
    getTopicClassificationReport,
    markArticlesAiTopicProcessing,
    markArticlesAiStoryGrouping,
    assignArticlesToStoryGroup,
    getArticleIdsForStoryGroups,
    getAiStoryGroupingCandidateSet,
    mergeTopicsForArticles,
    replaceTopicsForArticles,
    upsertArticles,
    countArticles,
    deleteArticlesOlderThan,
    normalizeFuturePublicationDates,
    cleanupRemovedConfiguredSourceData,
    getSourceStats,
    getTopicStatsByFilters,
    createIngestionRun,
    completeIngestionRun,
    getLatestIngestionRun
  };
}

export = createArticleRepository;
