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

function mapUserSourceRow(row) {
  return {
    ...row,
    isActive: Boolean(row.isActive)
  };
}

function createUserStateRepository({ getDb }) {
  function getUserSettings(userId) {
    if (!userId) {
      return null;
    }

    const row = getDb().prepare(`
      SELECT user_id AS userId, default_language AS defaultLanguage,
             article_retention_hours AS articleRetentionHours,
             recent_hours AS recentHours,
             auto_refresh_enabled AS autoRefreshEnabled,
             show_news_images AS showNewsImages,
             reader_panel_position AS readerPanelPosition,
             reader_text_size AS readerTextSize,
             last_seen_release_notes_version AS lastSeenReleaseNotesVersion,
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
        showNewsImages: row.showNewsImages !== false && row.showNewsImages !== 0,
        excludedSourceIds: parseJsonArray(row.excludedSourceIds),
        excludedSubSourceIds: parseJsonArray(row.excludedSubSourceIds)
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
        show_news_images,
        reader_panel_position,
        reader_text_size,
        last_seen_release_notes_version,
        default_source_ids,
        excluded_sub_source_ids,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        default_language = excluded.default_language,
        article_retention_hours = excluded.article_retention_hours,
        recent_hours = excluded.recent_hours,
        auto_refresh_enabled = excluded.auto_refresh_enabled,
        show_news_images = excluded.show_news_images,
        reader_panel_position = excluded.reader_panel_position,
        reader_text_size = excluded.reader_text_size,
        last_seen_release_notes_version = excluded.last_seen_release_notes_version,
        default_source_ids = excluded.default_source_ids,
        excluded_sub_source_ids = excluded.excluded_sub_source_ids,
        updated_at = excluded.updated_at
    `).run(
      userId,
      settings.defaultLanguage || 'auto',
      settings.articleRetentionHours || 24,
      settings.recentHours || 3,
      settings.autoRefreshEnabled === false ? 0 : 1,
      settings.showNewsImages === false ? 0 : 1,
      settings.readerPanelPosition || 'right',
      settings.readerTextSize || 'medium',
      settings.lastSeenReleaseNotesVersion || '',
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
    `).all(userId).map(mapUserSourceRow);
  }

  function listAllActiveUserSources() {
    return getDb().prepare(`
      SELECT id, user_id AS userId, name, url, language,
             is_active AS isActive, created_at AS createdAt,
             updated_at AS updatedAt, validated_at AS validatedAt
      FROM user_sources
      WHERE is_active = 1
      ORDER BY datetime(created_at) DESC, name ASC
    `).all().map(mapUserSourceRow);
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
        show_news_images,
        reader_panel_position,
        reader_text_size,
        last_seen_release_notes_version,
        default_source_ids,
        excluded_sub_source_ids,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        default_language = excluded.default_language,
        article_retention_hours = excluded.article_retention_hours,
        recent_hours = excluded.recent_hours,
        auto_refresh_enabled = excluded.auto_refresh_enabled,
        show_news_images = excluded.show_news_images,
        reader_panel_position = excluded.reader_panel_position,
        reader_text_size = excluded.reader_text_size,
        last_seen_release_notes_version = excluded.last_seen_release_notes_version,
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
        nextSettings.showNewsImages === false ? 0 : 1,
        nextSettings.readerPanelPosition || 'right',
        nextSettings.readerTextSize || 'medium',
        nextSettings.lastSeenReleaseNotesVersion || '',
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
    importUserState
  };
}

module.exports = createUserStateRepository;
