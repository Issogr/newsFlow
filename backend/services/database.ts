const fs = require('fs');
const path = require('path');
const Database = require('./sqliteDatabase');
const logger = require('../utils/logger');
const topicNormalizer = require('./topicNormalizer');
const createArticleRepository = require('./databaseArticles');
const createAuthRepository = require('./databaseAuth');
const createReaderCacheRepository = require('./databaseReaderCache');
const createDatabaseSchema = require('./databaseSchema');
const createUserStateRepository = require('./databaseUserState');
const {
  buildDomainSourceGroups,
  getCanonicalSourceIconUrl,
  getCanonicalSourceId,
  getCanonicalSourceName,
  getConfiguredSourceGroupIds,
  getLegacyConfiguredSourceGroupIds,
  getGroupedConfiguredSourceIds,
  getRawConfiguredSourceIds,
  getSourceAliases,
  getSourceVariantLabel
} = require('../utils/sourceCatalog');
const { normalizeArticleUrl, normalizeIdentityText } = require('../utils/articleIdentity');
import type { SourceGroup } from '../utils/types';
import SqliteDatabase = require('./sqliteDatabase');

const PACKAGE_ROOT = path.basename(path.dirname(__dirname)) === 'dist'
  ? path.resolve(__dirname, '../..')
  : path.resolve(__dirname, '..');
const DATA_DIR = path.join(PACKAGE_ROOT, 'data');
const DB_PATH = process.env.NEWS_DB_PATH || path.join(DATA_DIR, 'news.db');

let db: SqliteDatabase | null = null;
let lastWriteCheckAt: string | null = null;

function chunkValues<T>(values: T[] = [], size = 200) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function getCustomSourceGroups(userId: string | null, customSourceGroups: Map<string, SourceGroup> | null = null) {
  if (customSourceGroups instanceof Map) {
    return customSourceGroups;
  }

  if (!userId) {
    return new Map();
  }

  return buildDomainSourceGroups(userStateRepository.listUserSources(userId));
}

function resolveCustomSourceGroup(sourceId: string, sourceName: string, userId: string | null, customSourceGroups: Map<string, SourceGroup> | null = null) {
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

function getResolvedSourceAliases(sourceId: string, sourceName: string, userId: string | null, customSourceGroups: Map<string, SourceGroup> | null = null) {
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

function getResolvedSourceMetadata(sourceId: string, sourceName: string, userId: string | null, customSourceGroups: Map<string, SourceGroup> | null = null) {
  const configuredSourceId = getCanonicalSourceId(sourceId, sourceName);
  const configuredSourceName = getCanonicalSourceName(sourceId, sourceName);
  const configuredSourceIconUrl = getCanonicalSourceIconUrl(sourceId, sourceName);
  const configuredSubSource = getSourceVariantLabel(sourceId, sourceName);

  if (configuredSourceId !== sourceId || configuredSourceName !== sourceName || configuredSubSource) {
    return {
      sourceId: configuredSourceId,
      sourceName: configuredSourceName,
      sourceIconUrl: configuredSourceIconUrl,
      subSource: configuredSubSource
    };
  }

  const customSourceGroup = resolveCustomSourceGroup(sourceId, sourceName, userId, customSourceGroups);
  if (!customSourceGroup) {
    return {
      sourceId,
      sourceName,
      sourceIconUrl: '',
      subSource: null
    };
  }

  return {
    sourceId: customSourceGroup.id,
    sourceName: customSourceGroup.name,
    sourceIconUrl: customSourceGroup.iconUrl || '',
    subSource: customSourceGroup.subSources.length > 1
      ? (customSourceGroup.subSources.find((subSource: SourceGroup['subSources'][number]) => subSource.id === sourceId)?.label || null)
      : null
  };
}

const articleRepository = createArticleRepository({
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
});

const authRepository = createAuthRepository({ getDb });
const readerCacheRepository = createReaderCacheRepository({ getDb, chunkValues });
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
  const database = new Database(DB_PATH);
  db = database;
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma('foreign_keys = ON');
  database.pragma('temp_store = MEMORY');

  try {
    dbSchema.ensureSupportedSchema(database);
  } catch (error) {
    database.close();
    db = null;
    throw error;
  }
  logger.info(`SQLite database ready at ${DB_PATH}`);

  return database;
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

function verifyWriteAccess(options: { maxAgeMs?: number } = {}) {
  const maxAgeMs = Number(options.maxAgeMs) || 0;
  const lastCheckTimestamp = Date.parse(lastWriteCheckAt || '');
  if (maxAgeMs > 0 && Number.isFinite(lastCheckTimestamp) && Date.now() - lastCheckTimestamp < maxAgeMs) {
    return getWriteAccessStatus();
  }

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

export = {
  getDb,
  closeDb,
  ...articleRepository,
  ...readerCacheRepository,
  ...authRepository,
  ...userStateRepository,
  verifyWriteAccess,
  getWriteAccessStatus
};
