const { getCurrentPublicationDay, normalizePublicationDate } = require('../utils/publicationDate');

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
      recentHours: Number.isFinite(filters.recentHours) ? filters.recentHours : null,
      beforePubDate: typeof filters.beforePubDate === 'string' && filters.beforePubDate.trim() ? filters.beforePubDate.trim() : '',
      beforeId: typeof filters.beforeId === 'string' && filters.beforeId.trim() ? filters.beforeId.trim() : '',
      limit: Math.max(1, Math.min(Number(filters.limit) || 50, 250)),
      offset: Math.max(0, Number(filters.offset) || 0)
    };
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
        a.owner_user_id AS ownerUserId,
        a.published_at AS pubDate
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

  function getTopicDetailsByArticleIds(articleIds) {
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      return new Map();
    }

    const rows = getDb().prepare(`
      SELECT article_id AS articleId, topic, source, confidence, evidence, reason_code AS reasonCode
      FROM article_topics
      WHERE article_id IN (${articleIds.map(() => '?').join(', ')})
      ORDER BY topic ASC
    `).all(...articleIds);

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
    const normalizedArticleIds = [...new Set((Array.isArray(articleIds) ? articleIds : []).filter(Boolean))];
    if (normalizedArticleIds.length === 0) {
      return [];
    }

    return chunkValues(normalizedArticleIds).flatMap((ids) => {
      return getDb().prepare(`
        SELECT id
        FROM articles
        WHERE id IN (${ids.map(() => '?').join(', ')})
          AND ai_topics_processed_at IS NULL
      `).all(...ids).map((row) => row.id);
    });
  }

  function markArticlesAiTopicProcessing(articleIds = [], status = 'completed') {
    const normalizedArticleIds = [...new Set((Array.isArray(articleIds) ? articleIds : []).filter(Boolean))];
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
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      return [];
    }

    const params = [...articleIds];
    const where = [`a.id IN (${articleIds.map(() => '?').join(', ')})`];
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

    const rows = getDb().prepare(`
      SELECT
        a.id,
        a.source_id AS sourceId,
        a.source_name AS source,
        a.owner_user_id AS ownerUserId,
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
      ORDER BY a.published_at DESC, a.id DESC
    `).all(...params);

    return hydrateArticleRows(rows, options);
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
      )
    `);
    const deleteArticles = database.prepare(`
      DELETE FROM articles
      WHERE published_at < ?
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
        const excludedSourceIds = parseJsonArray(row.excludedSourceIds);
        const excludedSubSourceIds = parseJsonArray(row.excludedSubSourceIds);
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
    getArticleIdsPendingAiTopicProcessing,
    getTopicClassificationReport,
    markArticlesAiTopicProcessing,
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
