const { getCurrentPublicationDay, normalizePublicationDate } = require('../utils/publicationDate');
const { parseJsonArray } = require('../utils/json');

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
}) {
  const TITLE_DEDUPE_WINDOW_MS = 3 * 60 * 60 * 1000;

  function getSourceFilterClauses(sourceIds = [], options = {}) {
    const aliasedIds = new Set();
    const aliasedNames = new Set();

    sourceIds.forEach((sourceId) => {
      const aliases = getResolvedSourceAliases(sourceId, null, options.userId || null, options.customSourceGroups || null);
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

  function buildPublishedBeforeNowFilter(alias = 'a') {
    return {
      clause: `${alias}.published_at <= ?`,
      params: [new Date().toISOString()]
    };
  }

  function buildFilterState(filters = {}) {
    return {
      search: typeof filters.search === 'string' ? filters.search.trim() : '',
      sourceIds: Array.isArray(filters.sourceIds) ? filters.sourceIds.filter(Boolean) : [],
      topics: Array.isArray(filters.topics) ? filters.topics.filter(Boolean) : [],
      recentHours: Number.isFinite(filters.recentHours) && filters.recentHours > 0 ? filters.recentHours : null,
      beforePubDate: typeof filters.beforePubDate === 'string' && filters.beforePubDate.trim() ? filters.beforePubDate.trim() : '',
      beforeId: typeof filters.beforeId === 'string' && filters.beforeId.trim() ? filters.beforeId.trim() : '',
      excludeArticleIds: Array.isArray(filters.excludeArticleIds) ? filters.excludeArticleIds.filter(Boolean).slice(0, 300) : [],
      limit: Math.max(1, Math.min(Number(filters.limit) || 50, 251)),
      offset: Math.max(0, Number(filters.offset) || 0)
    };
  }

  function normalizeArticleIds(articleIds = []) {
    return [...new Set((Array.isArray(articleIds) ? articleIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  }

  function uniqueTruthyArticleIds(articleIds = []) {
    return [...new Set((Array.isArray(articleIds) ? articleIds : []).filter(Boolean))];
  }

  function buildSearchQuery(search) {
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

  function buildArticleQuery(filters = {}, options = {}) {
    const state = buildFilterState(filters);
    const params = [];
    const joins = [];
    const where = [];
    const searchQuery = buildSearchQuery(state.search);
    const scopeFilter = buildScopeFilter(options, 'a');
    const retentionFilter = buildRetentionFilter(options, 'a');
    const publishedBeforeNowFilter = buildPublishedBeforeNowFilter('a');
    const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
    const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);

    where.push(scopeFilter.clause);
    params.push(...scopeFilter.params);
    where.push(publishedBeforeNowFilter.clause);
    params.push(...publishedBeforeNowFilter.params);

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
        a.ai_story_group_model AS aiStoryGroupModel
      FROM articles a
      ${joins.join('\n')}
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.published_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `;

    params.push(state.limit, state.offset);

    return { sql, params };
  }

  function normalizeArticleTitle(title) {
    return normalizeIdentityText(title, { lowercase: true });
  }

  function sortDuplicateRows(rows = []) {
    return [...rows].sort((left, right) => String(right.updatedAt || right.createdAt || right.id || '').localeCompare(
      String(left.updatedAt || left.createdAt || left.id || '')
    ));
  }

  function sourceMatchesAliases(row, aliases) {
    return aliases.ids.includes(row.sourceId) || aliases.names.includes(row.sourceName);
  }

  function getAliasKey(ownerUserId, aliases) {
    return [ownerUserId || '', aliases.ids.join('\u0001'), aliases.names.join('\u0001')].join('\u0000');
  }

  function createArticleDuplicateLookup(database, articles = [], existingIdSet = new Set()) {
    const aliasCache = new Map();
    const infoByArticle = new WeakMap();
    const canonicalRowsByKey = new Map();
    const titleRowsByAliasKey = new Map();
    const titleGroupRanges = new Map();

    function getAliases(sourceId, sourceName, ownerUserId) {
      const cacheKey = [ownerUserId || '', sourceId || '', sourceName || ''].join('\u0000');
      if (!aliasCache.has(cacheKey)) {
        aliasCache.set(cacheKey, getResolvedSourceAliases(sourceId, sourceName, ownerUserId || null));
      }

      return aliasCache.get(cacheKey);
    }

    function buildInfo(article) {
      const sourceId = article.rawSourceId || article.sourceId;
      const sourceName = article.rawSource || article.source;
      const ownerUserId = article.ownerUserId || '';
      const aliases = getAliases(sourceId, sourceName, ownerUserId);
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

    function getInfo(article) {
      return infoByArticle.get(article) || buildInfo(article);
    }

    function addCanonicalCandidate(info, row) {
      if (!info.canonicalUrl || !sourceMatchesAliases(row, info.aliases)) {
        return;
      }

      const rows = canonicalRowsByKey.get(info.canonicalKey) || [];
      if (!rows.some((candidate) => candidate.id === row.id)) {
        rows.push(row);
        canonicalRowsByKey.set(info.canonicalKey, rows);
      }
    }

    function addTitleCandidate(info, row) {
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

    const canonicalUrlsByOwner = new Map();
    canonicalRowsByKey.forEach((rows, key) => {
      const [ownerUserId, canonicalUrl] = key.split('\u0000');
      const urls = canonicalUrlsByOwner.get(ownerUserId) || [];
      urls.push(canonicalUrl);
      canonicalUrlsByOwner.set(ownerUserId, urls);
      canonicalRowsByKey.set(key, rows);
    });

    canonicalUrlsByOwner.forEach((urls, ownerUserId) => {
      chunkValues([...new Set(urls)]).forEach((urlChunk) => {
        database.prepare(`
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

    const titleRangesByOwner = new Map();
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
      const sourceIds = new Set();
      const sourceNames = new Set();
      let publishedAfter = Infinity;
      let publishedBefore = -Infinity;

      ownerRanges.forEach(({ range }) => {
        range.aliases.ids.forEach((id) => sourceIds.add(id));
        range.aliases.names.forEach((name) => sourceNames.add(name));
        publishedAfter = Math.min(publishedAfter, range.publishedAfter);
        publishedBefore = Math.max(publishedBefore, range.publishedBefore);
      });

      const sourceClauses = [];
      const sourceParams = [];
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

      const candidateRows = database.prepare(`
        SELECT id, source_id AS sourceId, source_name AS sourceName, title,
               published_at AS publishedAt, updated_at AS updatedAt, created_at AS createdAt
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
      getCanonicalMatches(article) {
        const info = getInfo(article);
        if (!info.canonicalUrl) {
          return [];
        }

        return sortDuplicateRows((canonicalRowsByKey.get(info.canonicalKey) || []).filter((row) => sourceMatchesAliases(row, info.aliases)));
      },
      getTitleMatches(article) {
        const info = getInfo(article);
        if (!info.normalizedTitle || Number.isNaN(info.publishedTimestamp)) {
          return [];
        }

        return (titleRowsByAliasKey.get(info.aliasKey) || [])
          .filter((row) => {
            const rowTimestamp = Date.parse(row.publishedAt || '');
            return normalizeArticleTitle(row.title) === info.normalizedTitle
              && Number.isFinite(rowTimestamp)
              && Math.abs(rowTimestamp - info.publishedTimestamp) <= TITLE_DEDUPE_WINDOW_MS;
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
      forgetIds(ids = []) {
        const deletedIds = new Set(ids.filter(Boolean));
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
      rememberArticle(article) {
        const info = getInfo(article);
        const row = {
          id: article.id,
          sourceId: article.rawSourceId || article.sourceId,
          sourceName: article.rawSource || article.source,
          title: article.title,
          publishedAt: article.pubDate,
          updatedAt: article.updatedAt || new Date().toISOString(),
          createdAt: article.createdAt || new Date().toISOString()
        };

        addCanonicalCandidate(info, row);
        addTitleCandidate(info, row);
      }
    };
  }

  function transferDuplicateArticleReferences(database, duplicateId, persistedArticleId) {
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
          ))
      WHERE id = ?
    `).run(duplicateId, duplicateId, duplicateId, duplicateId, persistedArticleId);
  }

  function getTopicDetailsByArticleIds(articleIds) {
    const normalizedArticleIds = [...new Set((Array.isArray(articleIds) ? articleIds : []).filter(Boolean))];
    if (normalizedArticleIds.length === 0) {
      return new Map();
    }

    const rows = chunkValues(normalizedArticleIds).flatMap((ids) => {
      return getDb().prepare(`
        SELECT article_id AS articleId, topic, source, confidence, evidence, reason_code AS reasonCode
        FROM article_topics
        WHERE article_id IN (${ids.map(() => '?').join(', ')})
        ORDER BY topic ASC
      `).all(...ids);
    });

    const topicDetailsMap = new Map();
    rows.forEach((row) => {
      if (!topicNormalizer.isCanonicalTopic(row.topic)) {
        return;
      }

      const topics = topicDetailsMap.get(row.articleId) || [];
      topics.push({
        topic: row.topic,
        source: row.source || 'legacy',
        confidence: row.confidence,
        evidence: parseEvidence(row.evidence),
        reasonCode: row.reasonCode || null
      });
      topicDetailsMap.set(row.articleId, topics);
    });

    return topicDetailsMap;
  }

  function hydrateArticleRows(rows, options = {}) {
    const articleIds = rows.map((row) => row.id);
    const topicDetailsMap = getTopicDetailsByArticleIds(articleIds);
    const metadataCache = options.sourceMetadataCache || new Map();

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

  function normalizeTopicEntry(entry, fallbackSource = 'local') {
    const rawTopic = entry && typeof entry === 'object' ? entry.topic : entry;
    const topic = topicNormalizer.normalizeTopic(rawTopic);
    if (!topic || !topicNormalizer.isCanonicalTopic(topic)) {
      return null;
    }

    const confidence = entry && typeof entry === 'object' && Number.isFinite(Number(entry.confidence))
      ? Math.max(0, Math.min(1, Number(entry.confidence)))
      : null;
    const evidence = entry && typeof entry === 'object' && Array.isArray(entry.evidence)
      ? entry.evidence.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 8)
      : [];

    return {
      topic,
      source: String(entry?.source || fallbackSource || 'local').slice(0, 32),
      confidence,
      evidence: JSON.stringify(evidence),
      reasonCode: entry?.reasonCode ? String(entry.reasonCode).slice(0, 80) : null
    };
  }

  function normalizeTopicEntries(topics = [], fallbackSource = 'local') {
    if (!Array.isArray(topics)) {
      return [];
    }

    const seen = new Set();
    return topics
      .map((topic) => normalizeTopicEntry(topic, fallbackSource))
      .filter(Boolean)
      .filter((entry) => {
        const key = entry.topic.toLowerCase();
        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });
  }

  function parseEvidence(value) {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
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
    const deleteSearchStmt = database.prepare('DELETE FROM article_search WHERE article_id = ?');
    const insertSearchStmt = database.prepare(`
      INSERT INTO article_search (article_id, title, description, content)
      VALUES (?, ?, ?, ?)
    `);
    const deleteArticleStmt = database.prepare('DELETE FROM articles WHERE id = ?');
    const existingSearchableFields = new Map(
      chunkValues(articles.map((article) => article.id).filter(Boolean)).flatMap((articleIds) => {
        return database.prepare(`
        SELECT id, title, description, content
        FROM articles
          WHERE id IN (${articleIds.map(() => '?').join(', ')})
        `).all(...articleIds).map((row) => [row.id, row]);
      })
    );
    const existingIdSet = new Set(
      chunkValues(articles.map((article) => article.id).filter(Boolean)).flatMap((articleIds) => {
        return database.prepare(`
          SELECT id
          FROM articles
          WHERE id IN (${articleIds.map(() => '?').join(', ')})
        `).all(...articleIds).map((row) => row.id);
      })
    );
    const duplicateLookup = createArticleDuplicateLookup(database, articles, existingIdSet);

    const transaction = database.transaction((items) => {
      const insertedIds = [];
      const updatedIds = [];

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
          deleteSearchStmt.run(duplicateId);
          deleteArticleStmt.run(duplicateId);
          existingIdSet.delete(duplicateId);
        });
        duplicateLookup.forgetIds(duplicateIds);

        upsertStmt.run(
          persistedArticleId,
          storedSourceId,
          storedSourceName,
          article.ownerUserId || null,
          article.title,
          article.description || '',
          article.content || '',
          article.url || '',
          canonicalUrl,
          article.image || null,
          article.author || null,
          article.language || 'it',
          normalizedPubDate,
          article.createdAt || now,
          now
        );

        const previousSearchableFields = existingSearchableFields.get(persistedArticleId);
        const searchableFieldsChanged = !previousSearchableFields
          || previousSearchableFields.title !== article.title
          || previousSearchableFields.description !== (article.description || '')
          || previousSearchableFields.content !== (article.content || '');

        if (searchableFieldsChanged) {
          deleteSearchStmt.run(persistedArticleId);
          insertSearchStmt.run(persistedArticleId, article.title, article.description || '', article.content || '');
        }

        if (exists) {
          updatedIds.push(persistedArticleId);
        } else {
          insertedIds.push(persistedArticleId);
          existingIdSet.add(persistedArticleId);
        }
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

  function getArticleIdsPendingAiTopicProcessing(articleIds = []) {
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

  function markArticlesAiTopicProcessing(articleIds = [], status = 'completed') {
    const normalizedArticleIds = uniqueTruthyArticleIds(articleIds);
    if (normalizedArticleIds.length === 0) {
      return 0;
    }

    const processedAt = new Date().toISOString();
    return chunkValues(normalizedArticleIds).reduce((total, ids) => {
      return total + getDb().prepare(`
        UPDATE articles
        SET ai_topics_processed_at = ?,
            ai_topics_status = ?
        WHERE id IN (${ids.map(() => '?').join(', ')})
      `).run(processedAt, status, ...ids).changes;
    }, 0);
  }

  function getArticleIdsPendingAiStoryGrouping(articleIds = []) {
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

  function markArticlesAiStoryGrouping(articleIds = [], status = 'completed', model = '') {
    const normalizedArticleIds = uniqueTruthyArticleIds(articleIds);
    if (normalizedArticleIds.length === 0) {
      return 0;
    }

    const processedAt = new Date().toISOString();
    return chunkValues(normalizedArticleIds).reduce((total, ids) => {
      return total + getDb().prepare(`
        UPDATE articles
        SET ai_story_group_processed_at = ?,
            ai_story_group_status = ?,
            ai_story_group_model = ?
        WHERE id IN (${ids.map(() => '?').join(', ')})
      `).run(processedAt, status, String(model || '').slice(0, 160), ...ids).changes;
    }, 0);
  }

  function assignArticlesToStoryGroup(articleIds = [], storyGroupId = '', model = '') {
    const normalizedArticleIds = uniqueTruthyArticleIds(articleIds);
    const normalizedStoryGroupId = String(storyGroupId || '').trim().slice(0, 160);
    if (normalizedArticleIds.length === 0 || !normalizedStoryGroupId) {
      return 0;
    }

    const processedAt = new Date().toISOString();
    return chunkValues(normalizedArticleIds).reduce((total, ids) => {
      return total + getDb().prepare(`
        UPDATE articles
        SET story_group_id = ?,
            ai_story_group_processed_at = ?,
            ai_story_group_status = 'matched',
            ai_story_group_model = ?
        WHERE id IN (${ids.map(() => '?').join(', ')})
      `).run(normalizedStoryGroupId, processedAt, String(model || '').slice(0, 160), ...ids).changes;
    }, 0);
  }

  function getArticleIdsForStoryGroups(storyGroupIds = [], ownerUserId = null) {
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

  function getAiStoryGroupingCandidateSet(articleId, options = {}) {
    const normalizedArticleId = String(articleId || '').trim();
    if (!normalizedArticleId) {
      return { target: null, candidates: [] };
    }

    const database = getDb();
    const windowHours = Math.max(1, Math.min(Number(options.windowHours) || 24, 72));
    const limit = Math.max(1, Math.min(Number(options.limit) || 12, 30));
    const targetRow = database.prepare(`
      SELECT id, source_id AS sourceId, source_name AS source, title, description, content, url, canonical_url AS canonicalUrl,
             image, author, language, owner_user_id AS ownerUserId, published_at AS pubDate,
             story_group_id AS storyGroupId, ai_story_group_processed_at AS aiStoryGroupProcessedAt,
             ai_story_group_status AS aiStoryGroupStatus, ai_story_group_model AS aiStoryGroupModel
      FROM articles
      WHERE id = ?
    `).get(normalizedArticleId);

    if (!targetRow) {
      return { target: null, candidates: [] };
    }

    const targetTimestamp = Date.parse(targetRow.pubDate || '');
    if (!Number.isFinite(targetTimestamp)) {
      return { target: hydrateArticleRows([targetRow], options)[0] || null, candidates: [] };
    }

    const periodStart = new Date(targetTimestamp - (windowHours * 60 * 60 * 1000)).toISOString();
    const periodEnd = new Date(targetTimestamp + (windowHours * 60 * 60 * 1000)).toISOString();
    const rows = database.prepare(`
      SELECT id, source_id AS sourceId, source_name AS source, title, description, content, url, canonical_url AS canonicalUrl,
             image, author, language, owner_user_id AS ownerUserId, published_at AS pubDate,
             story_group_id AS storyGroupId, ai_story_group_processed_at AS aiStoryGroupProcessedAt,
             ai_story_group_status AS aiStoryGroupStatus, ai_story_group_model AS aiStoryGroupModel
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

  function mergeTopicsForArticle(articleId, topics = []) {
    if (!articleId || !Array.isArray(topics) || topics.length === 0) {
      return [];
    }

    const database = getDb();
    const articleExists = database.prepare('SELECT 1 FROM articles WHERE id = ?').get(articleId);
    if (!articleExists) {
      return [];
    }

    const selectStmt = database.prepare('SELECT topic FROM article_topics WHERE article_id = ? ORDER BY topic ASC');
    const insertStmt = database.prepare(`
      INSERT INTO article_topics (article_id, topic, source, confidence, evidence, reason_code)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(article_id, topic) DO UPDATE SET
        source = excluded.source,
        confidence = excluded.confidence,
        evidence = excluded.evidence,
        reason_code = excluded.reason_code
    `);

    const transaction = database.transaction((articleIdentifier, topicList) => {
      normalizeTopicEntries(topicList).forEach((entry) => {
          insertStmt.run(articleIdentifier, entry.topic, entry.source, entry.confidence, entry.evidence, entry.reasonCode);
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
    const existingArticleIds = new Set(
      chunkValues([...new Set(normalizedEntries.map((entry) => entry.articleId))]).flatMap((articleIds) => {
        return database.prepare(`
          SELECT id
          FROM articles
          WHERE id IN (${articleIds.map(() => '?').join(', ')})
        `).all(...articleIds).map((row) => row.id);
      })
    );
    const existingEntries = normalizedEntries.filter((entry) => existingArticleIds.has(entry.articleId));

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

    const transaction = database.transaction((items) => {
      let insertedCount = 0;

      items.forEach(({ articleId, topics }) => {
        normalizeTopicEntries(topics).forEach((entry) => {
            insertedCount += insertStmt.run(articleId, entry.topic, entry.source, entry.confidence, entry.evidence, entry.reasonCode).changes;
          });
      });

      return insertedCount;
    });

    return transaction(existingEntries);
  }

  function replaceTopicsForArticles(entries = []) {
    const normalizedEntries = Array.isArray(entries)
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
    const existingArticleIds = new Set(
      chunkValues([...new Set(normalizedEntries.map((entry) => entry.articleId))]).flatMap((articleIds) => {
        return database.prepare(`
          SELECT id
          FROM articles
          WHERE id IN (${articleIds.map(() => '?').join(', ')})
        `).all(...articleIds).map((row) => row.id);
      })
    );
    const existingEntries = normalizedEntries.filter((entry) => existingArticleIds.has(entry.articleId));

    if (existingEntries.length === 0) {
      return 0;
    }

    const deleteStmt = database.prepare('DELETE FROM article_topics WHERE article_id = ?');
    const insertStmt = database.prepare(`
      INSERT OR IGNORE INTO article_topics (article_id, topic, source, confidence, evidence, reason_code)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = database.transaction((items) => {
      let insertedCount = 0;

      items.forEach(({ articleId, topics }) => {
        deleteStmt.run(articleId);
        topics.forEach((entry) => {
          insertedCount += insertStmt.run(articleId, entry.topic, entry.source, entry.confidence, entry.evidence, entry.reasonCode).changes;
        });
      });

      return insertedCount;
    });

    return transaction(existingEntries);
  }

  function getTopicClassificationReport(articleId) {
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
    const localCandidates = topicNormalizer.classifyTopicsFromText(article).map((entry) => ({
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
        evidence: parseEvidence(row.evidence)
      })),
      localCandidates
    };
  }

  function getArticles(filters = {}, options = {}) {
    const { sql, params } = buildArticleQuery(filters, options);
    const rows = getDb().prepare(sql).all(...params);
    return hydrateArticleRows(rows, options);
  }

  function getArticleById(articleId, options = {}) {
    if (!articleId) {
      return null;
    }

    return getArticlesByIds([articleId], options)[0] || null;
  }

  function getArticlesByIds(articleIds = [], options = {}) {
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

      where.push(scopeFilter.clause);
      params.push(...scopeFilter.params);
      where.push(publishedBeforeNowFilter.clause);
      params.push(...publishedBeforeNowFilter.params);

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

      return getDb().prepare(`
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
          a.ai_story_group_model AS aiStoryGroupModel
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

  function getReadLaterArticleIdSet(userId, articleIds = []) {
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

  function isReadLaterArticle(userId, articleId) {
    return getReadLaterArticleIdSet(userId, [articleId]).has(articleId);
  }

  function saveReadLaterArticles(userId, articleIds = [], options = {}) {
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

    const transaction = database.transaction((ids) => {
      let savedCount = 0;
      ids.forEach((articleId) => {
        savedCount += insertStmt.run(normalizedUserId, articleId, now).changes;
      });

      return savedCount;
    });

    return {
      savedArticleIds: accessibleArticleIds,
      savedCount: transaction(accessibleArticleIds)
    };
  }

  function cleanupExpiredUnsavedArticles(articleIds = [], isoTimestamp = '') {
    const normalizedArticleIds = normalizeArticleIds(articleIds);
    if (normalizedArticleIds.length === 0 || !isoTimestamp) {
      return 0;
    }

    const database = getDb();
    const deleteSearchEntries = database.prepare(`
      DELETE FROM article_search
      WHERE article_id IN (
        SELECT id
        FROM articles
        WHERE id IN (${normalizedArticleIds.map(() => '?').join(', ')})
          AND published_at < ?
          AND NOT EXISTS (
            SELECT 1
            FROM user_read_later_articles
            WHERE user_read_later_articles.article_id = articles.id
          )
      )
    `);
    const deleteArticles = database.prepare(`
      DELETE FROM articles
      WHERE id IN (${normalizedArticleIds.map(() => '?').join(', ')})
        AND published_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM user_read_later_articles
          WHERE user_read_later_articles.article_id = articles.id
        )
    `);

    const transaction = database.transaction((ids, threshold) => {
      deleteSearchEntries.run(...ids, threshold);
      return deleteArticles.run(...ids, threshold).changes;
    });

    return transaction(normalizedArticleIds, isoTimestamp);
  }

  function removeReadLaterArticles(userId, articleIds = [], options = {}) {
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
    const transaction = database.transaction((ids) => {
      const removedArticleIds = [];
      let removedCount = 0;

      ids.forEach((articleId) => {
        const changes = deleteStmt.run(normalizedUserId, articleId).changes;
        if (changes > 0) {
          removedArticleIds.push(articleId);
          removedCount += changes;
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

  function getReadLaterArticles(userId, filters = {}, options = {}) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      return [];
    }

    const state = buildFilterState(filters);
    const params = [normalizedUserId];
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

    const rows = getDb().prepare(`
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
        rl.saved_at AS readLaterSavedAt
      FROM articles a
      ${joins.join('\n')}
      WHERE ${where.join(' AND ')}
      ORDER BY rl.saved_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, state.limit, state.offset);

    return hydrateArticleRows(rows, { ...options, userId: normalizedUserId });
  }

  function getArticlesForThematicSummary({ topics = [], periodStart, periodEnd, limit = 80 } = {}) {
    const normalizedTopics = [...new Set((Array.isArray(topics) ? topics : [])
      .map((topic) => topicNormalizer.normalizeTopic(topic))
      .filter((topic) => topic && topicNormalizer.isCanonicalTopic(topic)))];
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 80, 200));

    if (normalizedTopics.length === 0 || !periodStart || !periodEnd) {
      return [];
    }

    const rows = getDb().prepare(`
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
        a.ai_story_group_model AS aiStoryGroupModel
      FROM articles a
      JOIN article_topics at ON at.article_id = a.id
      WHERE a.owner_user_id IS NULL
        AND a.published_at >= ?
        AND a.published_at < ?
        AND a.published_at <= ?
        AND at.topic IN (${normalizedTopics.map(() => '?').join(', ')})
      ORDER BY a.published_at DESC, a.id DESC
      LIMIT ?
    `).all(periodStart, periodEnd, new Date().toISOString(), ...normalizedTopics, normalizedLimit);

    return hydrateArticleRows(rows, { userId: null });
  }

  function normalizeSummarySources(sources = []) {
    if (!Array.isArray(sources)) {
      return [];
    }

    return sources.map((source, index) => ({
      index: Number(source?.index) || index + 1,
      articleId: String(source?.articleId || '').trim(),
      title: String(source?.title || '').trim().slice(0, 300),
      source: String(source?.source || '').trim().slice(0, 120),
      sourceIconUrl: String(source?.sourceIconUrl || '').trim().slice(0, 1000),
      url: String(source?.url || '').trim().slice(0, 1000),
      publishedAt: String(source?.publishedAt || '').trim()
    })).filter((source) => source.articleId && source.title);
  }

  function normalizeSummaryPayload(summary = {}) {
    const topicKey = String(summary.topicKey || '').trim();
    const periodStart = String(summary.periodStart || '').trim();
    const periodEnd = String(summary.periodEnd || '').trim();

    if (!topicKey || !periodStart || !periodEnd) {
      return null;
    }

    const id = String(summary.id || `${topicKey}:${periodStart}:${periodEnd}`).trim();
    const titleByLocale = summary.titleByLocale && typeof summary.titleByLocale === 'object' ? summary.titleByLocale : {};
    const summaryTextByLocale = summary.summaryTextByLocale && typeof summary.summaryTextByLocale === 'object' ? summary.summaryTextByLocale : {};
    const titleEn = String(summary.titleEn || titleByLocale.en || summary.title || '').trim().slice(0, 180);
    const titleIt = String(summary.titleIt || titleByLocale.it || titleEn || summary.title || '').trim().slice(0, 180);
    const summaryTextEn = String(summary.summaryTextEn || summaryTextByLocale.en || summary.summaryText || '').trim();
    const summaryTextIt = String(summary.summaryTextIt || summaryTextByLocale.it || summaryTextEn || summary.summaryText || '').trim();

    return {
      id,
      topicKey,
      topicLabel: String(summary.topicLabel || topicKey).trim().slice(0, 80),
      topicsJson: JSON.stringify(Array.isArray(summary.topics) ? summary.topics : []),
      periodStart,
      periodEnd,
      title: titleEn || titleIt,
      summaryText: summaryTextEn || summaryTextIt,
      titleEn,
      summaryTextEn,
      titleIt,
      summaryTextIt,
      sourcesJson: JSON.stringify(normalizeSummarySources(summary.sources || [])),
      articleCount: Math.max(0, Number(summary.articleCount) || 0),
      model: String(summary.model || '').trim().slice(0, 120),
      status: String(summary.status || 'completed').trim().slice(0, 40),
      errorMessage: summary.errorMessage ? String(summary.errorMessage).trim().slice(0, 1000) : null,
      generatedAt: String(summary.generatedAt || new Date().toISOString()).trim()
    };
  }

  function parseSummaryJson(value, fallback = []) {
    try {
      const parsed = JSON.parse(value || '');
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function mapThematicSummaryRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      topicKey: row.topicKey,
      topicLabel: row.topicLabel,
      topics: parseSummaryJson(row.topicsJson),
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      title: row.titleEn || row.title || row.titleIt || '',
      summaryText: row.summaryTextEn || row.summaryText || row.summaryTextIt || '',
      titleByLocale: {
        en: row.titleEn || row.title || row.titleIt || '',
        it: row.titleIt || row.titleEn || row.title || ''
      },
      summaryTextByLocale: {
        en: row.summaryTextEn || row.summaryText || row.summaryTextIt || '',
        it: row.summaryTextIt || row.summaryTextEn || row.summaryText || ''
      },
      sources: parseSummaryJson(row.sourcesJson),
      articleCount: row.articleCount,
      model: row.model,
      status: row.status,
      errorMessage: row.errorMessage,
      generatedAt: row.generatedAt
    };
  }

  function normalizePodcastAudioData(audioData) {
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

  function normalizePodcastSummaryPayload(summary = {}) {
    const periodStart = String(summary.periodStart || '').trim();
    const periodEnd = String(summary.periodEnd || '').trim();

    if (!periodStart || !periodEnd) {
      return null;
    }

    const id = String(summary.id || `podcast:${periodStart}:${periodEnd}`).trim();
    const titleByLocale = summary.titleByLocale && typeof summary.titleByLocale === 'object' ? summary.titleByLocale : {};
    const scriptTextByLocale = summary.scriptTextByLocale && typeof summary.scriptTextByLocale === 'object' ? summary.scriptTextByLocale : {};
    const titleEn = String(summary.titleEn || titleByLocale.en || summary.title || '').trim().slice(0, 180);
    const titleIt = String(summary.titleIt || titleByLocale.it || titleEn || summary.title || '').trim().slice(0, 180);
    const scriptTextEn = String(summary.scriptTextEn || scriptTextByLocale.en || summary.scriptText || '').trim();
    const scriptTextIt = String(summary.scriptTextIt || scriptTextByLocale.it || scriptTextEn || summary.scriptText || '').trim();
    const audioBlob = normalizePodcastAudioData(summary.audioData || summary.audio?.data || null);
    const requestedAudioStatus = String(summary.audioStatus || (audioBlob ? 'completed' : 'not_available')).trim().slice(0, 40);
    const audioStatus = requestedAudioStatus === 'completed' && !audioBlob ? 'not_available' : requestedAudioStatus;

    return {
      id,
      periodStart,
      periodEnd,
      title: titleEn || titleIt,
      scriptText: scriptTextEn || scriptTextIt,
      titleEn,
      scriptTextEn,
      titleIt,
      scriptTextIt,
      sourcesJson: JSON.stringify(normalizeSummarySources(summary.sources || [])),
      articleCount: Math.max(0, Number(summary.articleCount) || 0),
      scriptModel: String(summary.scriptModel || summary.model || '').trim().slice(0, 120),
      audioModel: String(summary.audioModel || summary.audio?.model || '').trim().slice(0, 120),
      audioVoice: String(summary.audioVoice || summary.audio?.voice || '').trim().slice(0, 120),
      audioMimeType: String(summary.audioMimeType || summary.audio?.mimeType || '').trim().slice(0, 120),
      audioBlob,
      audioStatus,
      audioErrorMessage: summary.audioErrorMessage ? String(summary.audioErrorMessage).trim().slice(0, 1000) : null,
      status: String(summary.status || 'completed').trim().slice(0, 40),
      errorMessage: summary.errorMessage ? String(summary.errorMessage).trim().slice(0, 1000) : null,
      generatedAt: String(summary.generatedAt || new Date().toISOString()).trim()
    };
  }

  function mapPodcastSummaryRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      type: 'podcast',
      topicKey: 'podcast',
      topicLabel: 'Podcast',
      topics: ['Podcast'],
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      title: row.titleEn || row.title || row.titleIt || '',
      summaryText: row.scriptTextEn || row.scriptText || row.scriptTextIt || '',
      titleByLocale: {
        en: row.titleEn || row.title || row.titleIt || '',
        it: row.titleIt || row.titleEn || row.title || ''
      },
      summaryTextByLocale: {
        en: row.scriptTextEn || row.scriptText || row.scriptTextIt || '',
        it: row.scriptTextIt || row.scriptTextEn || row.scriptText || ''
      },
      sources: parseSummaryJson(row.sourcesJson),
      articleCount: row.articleCount,
      model: row.scriptModel,
      audioModel: row.audioModel,
      audioVoice: row.audioVoice,
      audioMimeType: row.audioMimeType,
      audioStatus: row.audioStatus,
      audioErrorMessage: row.audioErrorMessage,
      audioUrl: row.audioStatus === 'completed'
        ? `/api/podcast-summary/${encodeURIComponent(row.id)}/audio?v=${encodeURIComponent([row.generatedAt, row.audioModel, row.audioVoice].filter(Boolean).join(':'))}`
        : '',
      status: row.status,
      errorMessage: row.errorMessage,
      generatedAt: row.generatedAt
    };
  }

  function upsertThematicSummary(summary = {}) {
    const normalized = normalizeSummaryPayload(summary);
    if (!normalized) {
      return null;
    }

    getDb().prepare(`
      INSERT INTO thematic_summaries (
        id, topic_key, topic_label, topics_json, period_start, period_end, title,
        summary_text, title_en, summary_text_en, title_it, summary_text_it,
        sources_json, article_count, model, status, error_message, generated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(topic_key, period_start, period_end) DO UPDATE SET
        topic_label = excluded.topic_label,
        topics_json = excluded.topics_json,
        title = excluded.title,
        summary_text = excluded.summary_text,
        title_en = excluded.title_en,
        summary_text_en = excluded.summary_text_en,
        title_it = excluded.title_it,
        summary_text_it = excluded.summary_text_it,
        sources_json = excluded.sources_json,
        article_count = excluded.article_count,
        model = excluded.model,
        status = excluded.status,
        error_message = excluded.error_message,
        generated_at = excluded.generated_at
    `).run(
      normalized.id,
      normalized.topicKey,
      normalized.topicLabel,
      normalized.topicsJson,
      normalized.periodStart,
      normalized.periodEnd,
      normalized.title,
      normalized.summaryText,
      normalized.titleEn,
      normalized.summaryTextEn,
      normalized.titleIt,
      normalized.summaryTextIt,
      normalized.sourcesJson,
      normalized.articleCount,
      normalized.model,
      normalized.status,
      normalized.errorMessage,
      normalized.generatedAt
    );

    return getThematicSummary(normalized.topicKey, normalized.periodStart, normalized.periodEnd);
  }

  function getThematicSummary(topicKey, periodStart, periodEnd) {
    const row = getDb().prepare(`
      SELECT id, topic_key AS topicKey, topic_label AS topicLabel, topics_json AS topicsJson,
             period_start AS periodStart, period_end AS periodEnd, title, summary_text AS summaryText,
             title_en AS titleEn, summary_text_en AS summaryTextEn,
             title_it AS titleIt, summary_text_it AS summaryTextIt,
             sources_json AS sourcesJson, article_count AS articleCount, model, status,
             error_message AS errorMessage, generated_at AS generatedAt
      FROM thematic_summaries
      WHERE topic_key = ? AND period_start = ? AND period_end = ?
      LIMIT 1
    `).get(topicKey, periodStart, periodEnd);

    return mapThematicSummaryRow(row);
  }

  function listLatestThematicSummaries(topicKeys = []) {
    const normalizedTopicKeys = [...new Set((Array.isArray(topicKeys) ? topicKeys : [])
      .map((topicKey) => String(topicKey || '').trim())
      .filter(Boolean))];
    if (normalizedTopicKeys.length === 0) {
      return [];
    }

    const rows = getDb().prepare(`
      SELECT id, topic_key AS topicKey, topic_label AS topicLabel, topics_json AS topicsJson,
             period_start AS periodStart, period_end AS periodEnd, title, summary_text AS summaryText,
             title_en AS titleEn, summary_text_en AS summaryTextEn,
             title_it AS titleIt, summary_text_it AS summaryTextIt,
             sources_json AS sourcesJson, article_count AS articleCount, model, status,
             error_message AS errorMessage, generated_at AS generatedAt
      FROM thematic_summaries ts
      WHERE topic_key IN (${normalizedTopicKeys.map(() => '?').join(', ')})
        AND period_end = (
          SELECT MAX(period_end)
          FROM thematic_summaries latest
          WHERE latest.topic_key = ts.topic_key
            AND latest.status = 'completed'
        )
        AND status = 'completed'
      ORDER BY period_end DESC, topic_key ASC
    `).all(...normalizedTopicKeys);

    return rows.map(mapThematicSummaryRow).filter(Boolean);
  }

  function upsertPodcastSummary(summary = {}) {
    const normalized = normalizePodcastSummaryPayload(summary);
    if (!normalized) {
      return null;
    }

    getDb().prepare(`
      INSERT INTO podcast_summaries (
        id, period_start, period_end, title, script_text, title_en, script_text_en,
        title_it, script_text_it, sources_json, article_count, script_model,
        audio_model, audio_voice, audio_mime_type, audio_blob, audio_status, audio_error_message,
        status, error_message, generated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        audio_model = excluded.audio_model,
        audio_voice = excluded.audio_voice,
        audio_mime_type = excluded.audio_mime_type,
        audio_blob = excluded.audio_blob,
        audio_status = excluded.audio_status,
        audio_error_message = excluded.audio_error_message,
        status = excluded.status,
        error_message = excluded.error_message,
        generated_at = excluded.generated_at
    `).run(
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
      normalized.audioModel,
      normalized.audioVoice,
      normalized.audioMimeType,
      normalized.audioBlob,
      normalized.audioStatus,
      normalized.audioErrorMessage,
      normalized.status,
      normalized.errorMessage,
      normalized.generatedAt
    );

    return getPodcastSummary(normalized.periodStart, normalized.periodEnd);
  }

  function getPodcastSummary(periodStart, periodEnd) {
    const row = getDb().prepare(`
      SELECT id, period_start AS periodStart, period_end AS periodEnd, title, script_text AS scriptText,
             title_en AS titleEn, script_text_en AS scriptTextEn,
             title_it AS titleIt, script_text_it AS scriptTextIt,
             sources_json AS sourcesJson, article_count AS articleCount, script_model AS scriptModel,
             audio_model AS audioModel, audio_voice AS audioVoice, audio_mime_type AS audioMimeType, audio_status AS audioStatus,
             audio_error_message AS audioErrorMessage, status, error_message AS errorMessage,
             generated_at AS generatedAt
      FROM podcast_summaries
      WHERE period_start = ? AND period_end = ?
      LIMIT 1
    `).get(periodStart, periodEnd);

    return mapPodcastSummaryRow(row);
  }

  function getLatestPodcastSummary() {
    const row = getDb().prepare(`
      SELECT id, period_start AS periodStart, period_end AS periodEnd, title, script_text AS scriptText,
             title_en AS titleEn, script_text_en AS scriptTextEn,
             title_it AS titleIt, script_text_it AS scriptTextIt,
             sources_json AS sourcesJson, article_count AS articleCount, script_model AS scriptModel,
             audio_model AS audioModel, audio_voice AS audioVoice, audio_mime_type AS audioMimeType, audio_status AS audioStatus,
             audio_error_message AS audioErrorMessage, status, error_message AS errorMessage,
             generated_at AS generatedAt
      FROM podcast_summaries
      WHERE status = 'completed'
      ORDER BY period_end DESC
      LIMIT 1
    `).get();

    return mapPodcastSummaryRow(row);
  }

  function getPodcastSummaryAudio(podcastId) {
    const row = getDb().prepare(`
      SELECT audio_blob AS audioBlob, audio_mime_type AS audioMimeType
      FROM podcast_summaries
      WHERE id = ? AND status = 'completed' AND audio_status = 'completed' AND audio_blob IS NOT NULL
      LIMIT 1
    `).get(String(podcastId || '').trim());

    if (!row?.audioBlob) {
      return null;
    }

    return {
      data: row.audioBlob,
      mimeType: row.audioMimeType || 'audio/mpeg'
    };
  }

  function countArticles(options = {}) {
    const scopeFilter = buildScopeFilter(options, 'articles');
    const retentionFilter = buildRetentionFilter(options, 'articles');
    const publishedBeforeNowFilter = buildPublishedBeforeNowFilter('articles');
    const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
    const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);
    const where = [scopeFilter.clause];
    const params = [...scopeFilter.params];
    where.push(publishedBeforeNowFilter.clause);
    params.push(...publishedBeforeNowFilter.params);

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
    const deleteSearchEntries = database.prepare(`
      DELETE FROM article_search
      WHERE article_id IN (
        SELECT id
        FROM articles
          WHERE published_at < ?
            AND NOT EXISTS (
              SELECT 1
              FROM user_read_later_articles
              WHERE user_read_later_articles.article_id = articles.id
            )
        )
    `);
    const deleteArticles = database.prepare(`
      DELETE FROM articles
      WHERE published_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM user_read_later_articles
          WHERE user_read_later_articles.article_id = articles.id
        )
    `);

    const transaction = database.transaction((threshold) => {
      deleteSearchEntries.run(threshold);
      return deleteArticles.run(threshold).changes;
    });

    return transaction(isoTimestamp);
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
    const selectUserSourceIds = database.prepare('SELECT user_id AS userId, id FROM user_sources');
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
      const deleteSearchEntries = database.prepare(`
        DELETE FROM article_search
        WHERE article_id IN (
          SELECT id
          FROM articles
          WHERE ${removedArticleFilter}
        )
      `);
      const deleteArticles = database.prepare(`
        DELETE FROM articles
        WHERE ${removedArticleFilter}
      `);
      const customSourceIdsByUserId = new Map();

      selectUserSourceIds.all().forEach((source) => {
        const sourceIds = customSourceIdsByUserId.get(source.userId) || new Set();
        sourceIds.add(source.id);
        customSourceIdsByUserId.set(source.userId, sourceIds);
      });

      deleteSearchEntries.run(...retainedGlobalSourceIds);
      const removedArticles = deleteArticles.run(...retainedGlobalSourceIds).changes;

      selectSettings.all().forEach((row) => {
        const excludedSourceIds = parseJsonArray(row.excludedSourceIds);
        const excludedSubSourceIds = parseJsonArray(row.excludedSubSourceIds);
        const customSourceIds = customSourceIdsByUserId.get(row.userId) || new Set();
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
    const publishedBeforeNowFilter = buildPublishedBeforeNowFilter('articles');
    const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
    const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);
    const where = [scopeFilter.clause];
    const params = [...scopeFilter.params];
    where.push(publishedBeforeNowFilter.clause);
    params.push(...publishedBeforeNowFilter.params);

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

    const metadataCache = options.sourceMetadataCache || new Map();
    const aggregatedRows = rows.reduce((map, row) => {
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
    }, new Map());

    const merged = configuredSources.map((source) => ({
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

  function getTopicStatsByFilters(filters = {}, limit = 20, options = {}) {
    const state = buildFilterState(filters);
    const params = [];
    const joins = ['JOIN articles a ON a.id = article_topics.article_id'];
    const where = [];
    const searchQuery = buildSearchQuery(state.search);
    const scopeFilter = buildScopeFilter(options, 'a');
    const retentionFilter = buildRetentionFilter(options, 'a');
    const publishedBeforeNowFilter = buildPublishedBeforeNowFilter('a');
    const excludedSourceFilter = getSourceExclusionClause(options.excludedSourceIds || [], options);
    const excludedSubSourceFilter = getSubSourceExclusionClause(options.excludedSubSourceIds || []);
    const canonicalTopics = topicNormalizer.CANONICAL_TOPICS;

    where.push(`article_topics.topic IN (${canonicalTopics.map(() => '?').join(', ')})`);
    params.push(...canonicalTopics);

    where.push(scopeFilter.clause);
    params.push(...scopeFilter.params);
    where.push(publishedBeforeNowFilter.clause);
    params.push(...publishedBeforeNowFilter.params);

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

  return {
    getArticles,
    getArticleById,
    getArticlesByIds,
    getReadLaterArticles,
    getArticlesForThematicSummary,
    upsertThematicSummary,
    getThematicSummary,
    listLatestThematicSummaries,
    upsertPodcastSummary,
    getPodcastSummary,
    getLatestPodcastSummary,
    getPodcastSummaryAudio,
    getReadLaterArticleIdSet,
    isReadLaterArticle,
    saveReadLaterArticles,
    removeReadLaterArticles,
    getArticleIdsPendingAiTopicProcessing,
    getArticleIdsPendingAiStoryGrouping,
    getTopicClassificationReport,
    markArticlesAiTopicProcessing,
    markArticlesAiStoryGrouping,
    assignArticlesToStoryGroup,
    getArticleIdsForStoryGroups,
    getAiStoryGroupingCandidateSet,
    mergeTopicsForArticle,
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
    getLatestIngestionRun,
    buildSearchQuery
  };
}

module.exports = createArticleRepository;
