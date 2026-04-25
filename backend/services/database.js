const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const logger = require('../utils/logger');
const topicNormalizer = require('./topicNormalizer');
const createArticleRepository = require('./databaseArticles');
const createAuthRepository = require('./databaseAuth');
const createReaderCacheRepository = require('./databaseReaderCache');
const createDatabaseSchema = require('./databaseSchema');
const createUserStateRepository = require('./databaseUserState');
const {
  buildDomainSourceGroups,
  getCanonicalSourceId,
  getCanonicalSourceName,
  getConfiguredSourceGroupIds,
  getLegacyConfiguredSourceGroupIds,
  getGroupedConfiguredSourceIds,
  getRawConfiguredSourceIds,
  getSourceAliases,
  getSourceVariantLabel
} = require('../utils/sourceCatalog');
const { normalizeArticleUrl } = require('../utils/articleIdentity');

const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = process.env.NEWS_DB_PATH || path.join(DATA_DIR, 'news.db');

let db;
let lastWriteCheckAt = null;

function chunkValues(values = [], size = 200) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function getCustomSourceGroups(userId, customSourceGroups = null) {
  if (customSourceGroups instanceof Map) {
    return customSourceGroups;
  }

  if (!userId) {
    return new Map();
  }

  return buildDomainSourceGroups(userStateRepository.listUserSources(userId));
}

function resolveCustomSourceGroup(sourceId, sourceName, userId, customSourceGroups = null) {
  if (!userId) {
    return null;
  }

  const resolvedCustomSourceGroups = getCustomSourceGroups(userId, customSourceGroups);

  for (const group of resolvedCustomSourceGroups.values()) {
    if (group.id === sourceId || group.memberIds.has(sourceId) || group.memberNames.has(sourceName)) {
      return group;
    }
  }

  return null;
}

function getResolvedSourceAliases(sourceId, sourceName, userId, customSourceGroups = null) {
  const configuredAliases = getSourceAliases(sourceId, sourceName);
  const customSourceGroup = resolveCustomSourceGroup(sourceId, sourceName, userId, customSourceGroups);

  if (!customSourceGroup) {
    return configuredAliases;
  }

  return {
    ids: [...new Set([...configuredAliases.ids, customSourceGroup.id, ...customSourceGroup.memberIds])],
    names: [...new Set([...configuredAliases.names, customSourceGroup.name, ...customSourceGroup.memberNames])]
  };
}

function getResolvedSourceMetadata(sourceId, sourceName, userId, customSourceGroups = null) {
  const configuredSourceId = getCanonicalSourceId(sourceId, sourceName);
  const configuredSourceName = getCanonicalSourceName(sourceId, sourceName);
  const configuredSubSource = getSourceVariantLabel(sourceId, sourceName);

  if (configuredSourceId !== sourceId || configuredSourceName !== sourceName || configuredSubSource) {
    return {
      sourceId: configuredSourceId,
      sourceName: configuredSourceName,
      subSource: configuredSubSource
    };
  }

  const customSourceGroup = resolveCustomSourceGroup(sourceId, sourceName, userId, customSourceGroups);
  if (!customSourceGroup) {
    return {
      sourceId,
      sourceName,
      subSource: null
    };
  }

  return {
    sourceId: customSourceGroup.id,
    sourceName: customSourceGroup.name,
    subSource: customSourceGroup.subSources.length > 1
      ? (customSourceGroup.subSources.find((subSource) => subSource.id === sourceId)?.label || null)
      : null
  };
}

const articleRepository = createArticleRepository({
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
});

const authRepository = createAuthRepository({ getDb });
const readerCacheRepository = createReaderCacheRepository({ getDb });
const userStateRepository = createUserStateRepository({ getDb });
const dbSchema = createDatabaseSchema({
  logger
});

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

  const legacySchemaVersion = dbSchema.inferLegacySchemaVersion(db);
  dbSchema.initializeSchema(db);
  dbSchema.ensureSupportedSchema(db, { legacySchemaVersion });
  logger.info(`SQLite database ready at ${DB_PATH}`);

  return db;
}

function closeDb() {
  if (!db) {
    lastWriteCheckAt = null;
    return;
  }

  db.close();
  db = null;
  lastWriteCheckAt = null;
}

function verifyWriteAccess() {
  const database = getDb();
  const probeValue = new Date().toISOString();
  const writeProbe = database.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES ('__write_check__', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const rollbackError = new Error('__ROLLBACK_WRITE_CHECK__');

  try {
    database.transaction(() => {
      writeProbe.run(probeValue);
      throw rollbackError;
    })();
  } catch (error) {
    if (error !== rollbackError) {
      throw error;
    }
  }

  lastWriteCheckAt = new Date().toISOString();
  return {
    writable: true,
    checkedAt: lastWriteCheckAt
  };
}

function getWriteAccessStatus() {
  return {
    writable: Boolean(lastWriteCheckAt),
    checkedAt: lastWriteCheckAt
  };
}

module.exports = {
  getDb,
  closeDb,
  getArticles: articleRepository.getArticles,
  getArticleById: articleRepository.getArticleById,
  getArticlesByIds: articleRepository.getArticlesByIds,
  getArticleIdsPendingAiTopicProcessing: articleRepository.getArticleIdsPendingAiTopicProcessing,
  markArticlesAiTopicProcessing: articleRepository.markArticlesAiTopicProcessing,
  mergeTopicsForArticle: articleRepository.mergeTopicsForArticle,
  mergeTopicsForArticles: articleRepository.mergeTopicsForArticles,
  replaceTopicsForArticles: articleRepository.replaceTopicsForArticles,
  upsertArticles: articleRepository.upsertArticles,
  countArticles: articleRepository.countArticles,
  deleteArticlesOlderThan: articleRepository.deleteArticlesOlderThan,
  normalizeFuturePublicationDates: articleRepository.normalizeFuturePublicationDates,
  cleanupRemovedConfiguredSourceData: articleRepository.cleanupRemovedConfiguredSourceData,
  getSourceStats: articleRepository.getSourceStats,
  getTopicStatsByFilters: articleRepository.getTopicStatsByFilters,
  createIngestionRun: articleRepository.createIngestionRun,
  completeIngestionRun: articleRepository.completeIngestionRun,
  getLatestIngestionRun: articleRepository.getLatestIngestionRun,
  getReaderCache: readerCacheRepository.getReaderCache,
  upsertReaderCache: readerCacheRepository.upsertReaderCache,
  createUser: authRepository.createUser,
  findUserByUsername: authRepository.findUserByUsername,
  findUserById: authRepository.findUserById,
  listUsers: authRepository.listUsers,
  updateUserLogin: authRepository.updateUserLogin,
  touchUserActivity: authRepository.touchUserActivity,
  updateUserPassword: authRepository.updateUserPassword,
  deleteUser: authRepository.deleteUser,
  incrementUserPublicApiUsage: authRepository.incrementUserPublicApiUsage,
  getAnonymousPublicApiRequestCount: authRepository.getAnonymousPublicApiRequestCount,
  incrementAnonymousPublicApiRequestCount: authRepository.incrementAnonymousPublicApiRequestCount,
  createUserSession: authRepository.createUserSession,
  createApiToken: authRepository.createApiToken,
  findSessionByTokenHash: authRepository.findSessionByTokenHash,
  refreshSessionExpiry: authRepository.refreshSessionExpiry,
  getLatestActiveApiTokenForUser: authRepository.getLatestActiveApiTokenForUser,
  findActiveApiTokenByHash: authRepository.findActiveApiTokenByHash,
  deleteSessionByTokenHash: authRepository.deleteSessionByTokenHash,
  deleteSessionsByUserId: authRepository.deleteSessionsByUserId,
  revokeApiTokensByUserId: authRepository.revokeApiTokensByUserId,
  touchApiTokenUsage: authRepository.touchApiTokenUsage,
  createPasswordSetupToken: authRepository.createPasswordSetupToken,
  findPasswordSetupTokenByHash: authRepository.findPasswordSetupTokenByHash,
  markPasswordSetupTokenUsed: authRepository.markPasswordSetupTokenUsed,
  deleteUnusedPasswordSetupTokens: authRepository.deleteUnusedPasswordSetupTokens,
  purgeExpiredSessions: authRepository.purgeExpiredSessions,
  purgeExpiredApiTokens: authRepository.purgeExpiredApiTokens,
  getUserSettings: userStateRepository.getUserSettings,
  upsertUserSettings: userStateRepository.upsertUserSettings,
  listUserSources: userStateRepository.listUserSources,
  listAllActiveUserSources: userStateRepository.listAllActiveUserSources,
  createUserSource: userStateRepository.createUserSource,
  findUserSourceById: userStateRepository.findUserSourceById,
  updateUserSource: userStateRepository.updateUserSource,
  deleteArticlesForUserSource: userStateRepository.deleteArticlesForUserSource,
  deleteUserSource: userStateRepository.deleteUserSource,
  deleteAllUserSources: userStateRepository.deleteAllUserSources,
  importUserState: userStateRepository.importUserState,
  verifyWriteAccess,
  getWriteAccessStatus,
  buildSearchQuery: articleRepository.buildSearchQuery
};
