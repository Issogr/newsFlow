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
const SQLITE_FILE_SUFFIXES = ['', '-wal', '-shm'];

let db;
let lastWriteCheckAt = null;

function replacePathSegment(targetPath, currentSegment, legacySegment) {
  return targetPath.split(path.sep).map((segment) => {
    return segment === currentSegment ? legacySegment : segment;
  }).join(path.sep);
}

function getLegacyDbPathCandidates(dbPath) {
  const candidates = new Set();
  const segmentPairs = [
    ['newsflow', 'news_aggregator'],
    ['newsFlow', 'news_aggregator']
  ];

  segmentPairs.forEach(([currentSegment, legacySegment]) => {
    const migratedPath = replacePathSegment(dbPath, currentSegment, legacySegment);
    if (migratedPath !== dbPath) {
      candidates.add(migratedPath);
    }
  });

  return [...candidates];
}

function hasSqliteArtifacts(dbPath) {
  return SQLITE_FILE_SUFFIXES.some((suffix) => fs.existsSync(`${dbPath}${suffix}`));
}

function migrateLegacyDatabaseFiles(dbPath) {
  if (hasSqliteArtifacts(dbPath)) {
    return null;
  }

  const legacyDbPath = getLegacyDbPathCandidates(dbPath).find((candidatePath) => hasSqliteArtifacts(candidatePath));
  if (!legacyDbPath) {
    return null;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  SQLITE_FILE_SUFFIXES.forEach((suffix) => {
    const legacyFilePath = `${legacyDbPath}${suffix}`;
    const nextFilePath = `${dbPath}${suffix}`;

    if (fs.existsSync(legacyFilePath) && !fs.existsSync(nextFilePath)) {
      fs.renameSync(legacyFilePath, nextFilePath);
    }
  });

  logger.info(`Migrated SQLite data from legacy path ${legacyDbPath} to ${dbPath}`);
  return legacyDbPath;
}

function chunkValues(values = [], size = 200) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function getCustomSourceGroups(userId) {
  if (!userId) {
    return new Map();
  }

  return buildDomainSourceGroups(userStateRepository.listUserSources(userId));
}

function resolveCustomSourceGroup(sourceId, sourceName, userId) {
  if (!userId) {
    return null;
  }

  const customSourceGroups = getCustomSourceGroups(userId);

  for (const group of customSourceGroups.values()) {
    if (group.id === sourceId || group.memberIds.has(sourceId) || group.memberNames.has(sourceName)) {
      return group;
    }
  }

  return null;
}

function getResolvedSourceAliases(sourceId, sourceName, userId) {
  const configuredAliases = getSourceAliases(sourceId, sourceName);
  const customSourceGroup = resolveCustomSourceGroup(sourceId, sourceName, userId);

  if (!customSourceGroup) {
    return configuredAliases;
  }

  return {
    ids: [...new Set([...configuredAliases.ids, customSourceGroup.id, ...customSourceGroup.memberIds])],
    names: [...new Set([...configuredAliases.names, customSourceGroup.name, ...customSourceGroup.memberNames])]
  };
}

function getResolvedSourceMetadata(sourceId, sourceName, userId) {
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

  const customSourceGroup = resolveCustomSourceGroup(sourceId, sourceName, userId);
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
  migrateLegacyDatabaseFiles(DB_PATH);
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

  dbSchema.initializeSchema(db);
  dbSchema.ensureSupportedSchema(db);
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
  mergeTopicsForArticle: articleRepository.mergeTopicsForArticle,
  mergeTopicsForArticles: articleRepository.mergeTopicsForArticles,
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
  createUserSession: authRepository.createUserSession,
  findSessionByTokenHash: authRepository.findSessionByTokenHash,
  deleteSessionByTokenHash: authRepository.deleteSessionByTokenHash,
  deleteSessionsByUserId: authRepository.deleteSessionsByUserId,
  createPasswordSetupToken: authRepository.createPasswordSetupToken,
  findPasswordSetupTokenByHash: authRepository.findPasswordSetupTokenByHash,
  markPasswordSetupTokenUsed: authRepository.markPasswordSetupTokenUsed,
  deleteUnusedPasswordSetupTokens: authRepository.deleteUnusedPasswordSetupTokens,
  purgeExpiredSessions: authRepository.purgeExpiredSessions,
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
  buildSearchQuery: articleRepository.buildSearchQuery,
  _getLegacyDbPathCandidates: getLegacyDbPathCandidates,
  _migrateLegacyDatabaseFiles: migrateLegacyDatabaseFiles
};
