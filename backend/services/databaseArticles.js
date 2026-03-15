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
  getResolvedSourceAliases,
  getResolvedSourceMetadata,
  getRawConfiguredSourceIds,
  getConfiguredSourceGroupIds,
  getLegacyConfiguredSourceGroupIds,
  getGroupedConfiguredSourceIds
}) {
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

    const rows = getDb().prepare(`
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
    const selectArticleByCanonicalUrlStmt = database.prepare(`
      SELECT id
      FROM articles
      WHERE source_id = ?
        AND canonical_url = ?
        AND COALESCE(owner_user_id, '') = ?
      ORDER BY datetime(updated_at) DESC, datetime(published_at) DESC, datetime(created_at) DESC, id DESC
      LIMIT 1
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
        const storedSourceId = article.rawSourceId || article.sourceId;
        const storedSourceName = article.rawSource || article.source;
        const canonicalUrl = normalizeArticleUrl(article.canonicalUrl || article.url || '');
        const canonicalMatch = !existingIdSet.has(article.id) && canonicalUrl
          ? selectArticleByCanonicalUrlStmt.get(storedSourceId, canonicalUrl, article.ownerUserId || '')
          : null;
        const persistedArticleId = canonicalMatch?.id || article.id;
        const exists = existingIdSet.has(persistedArticleId) || Boolean(canonicalMatch);
        const normalizedPubDate = normalizePublicationDate(article.pubDate, now);

        article.id = persistedArticleId;
        article.canonicalUrl = canonicalUrl;
        article.pubDate = normalizedPubDate;

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

        deleteSearchStmt.run(persistedArticleId);
        insertSearchStmt.run(persistedArticleId, article.title, article.description || '', article.content || '');

        if (exists) {
          updatedIds.push(persistedArticleId);
        } else {
          insertedIds.push(persistedArticleId);
          existingIdSet.add(persistedArticleId);
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

  return {
    getArticles,
    getArticleById,
    getArticlesByIds,
    mergeTopicsForArticle,
    mergeTopicsForArticles,
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
