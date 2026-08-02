const { parseJsonArray } = require('../utils/json');

function mapUserSourceRow(row) {
  return {
    ...row,
    isActive: Boolean(row.isActive),
    iconUrl: row.iconUrl || ''
  };
}

function normalizeReadThematicSummaryIds(summaryIds = []) {
  return [...new Set((Array.isArray(summaryIds) ? summaryIds : [])
    .map((summaryId) => String(summaryId || '').trim())
    .filter((summaryId) => summaryId.length > 0 && summaryId.length <= 200))]
    .slice(0, 100);
}

function deleteOwnedArticles(database, ownerId, sourceId = '') {
  const sourceScoped = Boolean(sourceId);
  const ownerFilter = sourceScoped
    ? 'owner_user_id = ? AND source_id = ?'
    : 'owner_user_id = ?';
  const params = sourceScoped ? [ownerId, sourceId] : [ownerId];

  return database.prepare(`
    DELETE FROM articles
    WHERE ${ownerFilter}
  `).run(...params).changes;
}

const USER_SETTINGS_COLUMNS = [
  'default_language',
  'theme_mode',
  'show_news_images',
  'compact_news_cards',
  'compact_news_cards_mode',
  'reader_panel_position',
  'reader_text_size',
  'reader_text_width',
  'last_seen_release_notes_version',
  'source_setup_completed',
  'excluded_source_ids',
  'excluded_sub_source_ids',
  'updated_at'
];

const USER_SETTINGS_UPSERT_SQL = `
  INSERT INTO user_settings (
    user_id,
    ${USER_SETTINGS_COLUMNS.join(',\n    ')}
  ) VALUES (${['user_id', ...USER_SETTINGS_COLUMNS].map(() => '?').join(', ')})
  ON CONFLICT(user_id) DO UPDATE SET
    ${USER_SETTINGS_COLUMNS.map((column) => `${column} = excluded.${column}`).join(',\n    ')}
`;

const USER_SOURCE_INSERT_SQL = `
  INSERT INTO user_sources (
    id, user_id, name, url, language, icon_url, is_active, created_at, updated_at, validated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function getUserSettingsValues(userId, settings = {}, updatedAt = new Date().toISOString()) {
  return [
    userId,
    settings.defaultLanguage || 'auto',
    settings.themeMode || 'system',
    settings.showNewsImages === false ? 0 : 1,
    settings.compactNewsCardsMode && settings.compactNewsCardsMode !== 'off' ? 1 : 0,
    settings.compactNewsCardsMode || 'off',
    settings.readerPanelPosition || 'right',
    settings.readerTextSize || 'medium',
    settings.readerTextWidth || 'default',
    settings.lastSeenReleaseNotesVersion || '',
    settings.sourceSetupCompleted === false ? 0 : 1,
    JSON.stringify(settings.excludedSourceIds || []),
    JSON.stringify(settings.excludedSubSourceIds || []),
    updatedAt
  ];
}

function getUserSourceValues(source = {}, userId = source.userId) {
  return [
    source.id,
    userId,
    source.name,
    source.url,
    source.language || 'it',
    source.iconUrl || '',
    source.isActive ? 1 : 0,
    source.createdAt,
    source.updatedAt,
    source.validatedAt || null
  ];
}

function createUserStateRepository({ getDb }) {
  function getUserSettings(userId) {
    if (!userId) {
      return null;
    }

    const row = getDb().prepare(`
      SELECT user_id AS userId, default_language AS defaultLanguage,
               theme_mode AS themeMode,
               show_news_images AS showNewsImages,
             compact_news_cards AS compactNewsCards,
             compact_news_cards_mode AS compactNewsCardsMode,
               reader_panel_position AS readerPanelPosition,
               reader_text_size AS readerTextSize,
               reader_text_width AS readerTextWidth,
              last_seen_release_notes_version AS lastSeenReleaseNotesVersion,
              source_setup_completed AS sourceSetupCompleted,
              excluded_source_ids AS excludedSourceIds,
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
        showNewsImages: row.showNewsImages !== false && row.showNewsImages !== 0,
        compactNewsCards: Boolean(row.compactNewsCards),
        compactNewsCardsMode: row.compactNewsCardsMode || (row.compactNewsCards ? 'everywhere' : 'off'),
        sourceSetupCompleted: row.sourceSetupCompleted !== false && row.sourceSetupCompleted !== 0,
        excludedSourceIds: parseJsonArray(row.excludedSourceIds),
        excludedSubSourceIds: parseJsonArray(row.excludedSubSourceIds)
      };
  }

  function upsertUserSettings(userId, settings = {}) {
    const now = new Date().toISOString();

    getDb().prepare(USER_SETTINGS_UPSERT_SQL).run(...getUserSettingsValues(userId, settings, now));

    return getUserSettings(userId);
  }

  function listUserSources(userId) {
    if (!userId) {
      return [];
    }

    return getDb().prepare(`
      SELECT id, user_id AS userId, name, url, language, icon_url AS iconUrl,
             is_active AS isActive, created_at AS createdAt,
             updated_at AS updatedAt, validated_at AS validatedAt
      FROM user_sources
      WHERE user_id = ?
      ORDER BY datetime(created_at) DESC, name ASC
    `).all(userId).map(mapUserSourceRow);
  }

  function listAllActiveUserSources() {
    return getDb().prepare(`
      SELECT id, user_id AS userId, name, url, language, icon_url AS iconUrl,
             is_active AS isActive, created_at AS createdAt,
             updated_at AS updatedAt, validated_at AS validatedAt
      FROM user_sources
      WHERE is_active = 1
      ORDER BY datetime(created_at) DESC, name ASC
    `).all().map(mapUserSourceRow);
  }

  function createUserSource(source = {}) {
    getDb().prepare(USER_SOURCE_INSERT_SQL).run(...getUserSourceValues(source));
  }

  function findUserSourceById(userId, sourceId) {
    if (!userId || !sourceId) {
      return null;
    }

    const row = getDb().prepare(`
      SELECT id, user_id AS userId, name, url, language, icon_url AS iconUrl,
             is_active AS isActive, created_at AS createdAt,
             updated_at AS updatedAt, validated_at AS validatedAt
      FROM user_sources
      WHERE user_id = ? AND id = ?
    `).get(userId, sourceId);

    return row ? mapUserSourceRow(row) : null;
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
          icon_url = ?,
          is_active = ?,
          updated_at = ?,
          validated_at = ?
      WHERE user_id = ? AND id = ?
    `).run(
      updates.name,
      updates.url,
      updates.language,
      updates.iconUrl || '',
      updates.isActive !== false ? 1 : 0,
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
      return deleteOwnedArticles(database, ownerId, customSourceId);
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

      deleteOwnedArticles(database, ownerId, customSourceId);

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
      deleteOwnedArticles(database, ownerId);

      return database.prepare(`
        DELETE FROM user_sources
        WHERE user_id = ?
      `).run(ownerId).changes;
    });

    return transaction(userId);
  }

  function listReadThematicSummaryIds(userId) {
    if (!userId) {
      return [];
    }

    return getDb().prepare(`
      SELECT summary_id AS summaryId
      FROM user_read_thematic_summaries
      WHERE user_id = ?
      ORDER BY datetime(read_at) DESC, summary_id DESC
      LIMIT 500
    `).all(userId).map((row) => row.summaryId);
  }

  function markThematicSummariesRead(userId, summaryIds = []) {
    const normalizedSummaryIds = normalizeReadThematicSummaryIds(summaryIds);
    if (!userId || normalizedSummaryIds.length === 0) {
      return listReadThematicSummaryIds(userId);
    }

    const database = getDb();
    const now = new Date().toISOString();
    const statement = database.prepare(`
      INSERT INTO user_read_thematic_summaries (user_id, summary_id, read_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, summary_id) DO UPDATE SET read_at = excluded.read_at
    `);
    const transaction = database.transaction((ownerId, ids) => {
      ids.forEach((summaryId) => statement.run(ownerId, summaryId, now));
    });

    transaction(userId, normalizedSummaryIds);

    return listReadThematicSummaryIds(userId);
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
    const insertSourceStmt = database.prepare(USER_SOURCE_INSERT_SQL);
    const upsertSettingsStmt = database.prepare(USER_SETTINGS_UPSERT_SQL);

    const transaction = database.transaction((ownerId, importedSources, nextSettings) => {
      deleteOwnedArticles(database, ownerId);

      database.prepare(`
        DELETE FROM user_sources
        WHERE user_id = ?
      `).run(ownerId);

      importedSources.forEach((source) => {
        insertSourceStmt.run(...getUserSourceValues(source, ownerId));
      });

      upsertSettingsStmt.run(...getUserSettingsValues(ownerId, nextSettings, nextSettings.updatedAt || now));
    });

    transaction(userId, sources, settings);

    return {
      settings: getUserSettings(userId),
      customSources: listUserSources(userId)
    };
  }

  return {
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
    listReadThematicSummaryIds,
    markThematicSummariesRead,
    importUserState
  };
}

module.exports = createUserStateRepository;
