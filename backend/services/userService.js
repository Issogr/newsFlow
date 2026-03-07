const crypto = require('crypto');
const database = require('./database');
const rssParser = require('./rssParser');
const newsSources = require('../config/newsSources');
const { createError } = require('../utils/errorHandler');
const {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  createSessionExpiryDate
} = require('../utils/auth');

const GLOBAL_RETENTION_HOURS = parseInt(process.env.ARTICLE_RETENTION_HOURS || '24', 10);
const MAX_RECENT_HOURS = 3;
const SUPPORTED_LANGUAGES = new Set(['auto', 'it', 'en']);

function createId() {
  return crypto.randomBytes(16).toString('hex');
}

function sanitizeUsername(username) {
  return String(username || '').trim().slice(0, 40);
}

function normalizeLanguage(language) {
  const value = String(language || 'auto').trim().toLowerCase();
  return SUPPORTED_LANGUAGES.has(value) ? value : 'auto';
}

function normalizeInt(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.floor(normalized) : fallback;
}

function getDefaultSettings() {
  return {
    defaultLanguage: 'auto',
    articleRetentionHours: GLOBAL_RETENTION_HOURS,
    recentHours: MAX_RECENT_HOURS,
    excludedSourceIds: []
  };
}

function getGlobalSourceIds() {
  return new Set(newsSources.map((source) => source.id));
}

function getUserSettings(userId) {
  return database.getUserSettings(userId) || getDefaultSettings();
}

function buildUserPayload(user) {
  return {
    id: user.id,
    username: user.username
  };
}

function buildAuthResponse(user, sessionToken) {
  return {
    token: sessionToken,
    user: buildUserPayload(user),
    settings: getUserSettings(user.id),
    limits: getUserLimits(),
    customSources: database.listUserSources(user.id)
  };
}

function getUserLimits() {
  return {
    articleRetentionHoursMax: GLOBAL_RETENTION_HOURS,
    recentHoursMax: MAX_RECENT_HOURS
  };
}

function registerUser(payload = {}) {
  const username = sanitizeUsername(payload.username);
  const password = String(payload.password || '');

  if (username.length < 3) {
    throw createError(400, 'Username must contain at least 3 characters', 'INVALID_USERNAME');
  }

  if (database.findUserByUsername(username)) {
    throw createError(409, 'Username already exists', 'USER_ALREADY_EXISTS');
  }

  const now = new Date().toISOString();
  const user = {
    id: createId(),
    username,
    passwordHash: hashPassword(password),
    createdAt: now,
    updatedAt: now
  };

  database.createUser(user);
  database.upsertUserSettings(user.id, getDefaultSettings());

  const sessionToken = generateSessionToken();
  database.createUserSession({
    tokenHash: hashSessionToken(sessionToken),
    userId: user.id,
    createdAt: now,
    expiresAt: createSessionExpiryDate()
  });

  return buildAuthResponse(user, sessionToken);
}

function loginUser(payload = {}) {
  const username = sanitizeUsername(payload.username);
  const password = String(payload.password || '');

  const user = database.findUserByUsername(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw createError(401, 'Invalid username or password', 'UNAUTHORIZED');
  }

  const sessionToken = generateSessionToken();
  database.createUserSession({
    tokenHash: hashSessionToken(sessionToken),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: createSessionExpiryDate()
  });

  return buildAuthResponse(user, sessionToken);
}

function logoutUser(sessionToken) {
  return database.deleteSessionByTokenHash(hashSessionToken(sessionToken));
}

function getCurrentUser(userId) {
  const user = database.findUserById(userId);
  if (!user) {
    throw createError(404, 'User not found', 'RESOURCE_NOT_FOUND');
  }

  return {
    user: buildUserPayload(user),
    settings: getUserSettings(userId),
    limits: getUserLimits(),
    customSources: database.listUserSources(userId)
  };
}

function updateUserSettings(userId, payload = {}) {
  const currentSettings = getUserSettings(userId);
  const articleRetentionHours = Math.min(
    GLOBAL_RETENTION_HOURS,
    Math.max(1, normalizeInt(payload.articleRetentionHours, currentSettings.articleRetentionHours))
  );
  const recentHours = Math.min(
    MAX_RECENT_HOURS,
    Math.max(1, normalizeInt(payload.recentHours, currentSettings.recentHours))
  );

  const settings = database.upsertUserSettings(userId, {
    defaultLanguage: normalizeLanguage(payload.defaultLanguage || currentSettings.defaultLanguage),
    articleRetentionHours,
    recentHours,
    excludedSourceIds: Array.isArray(payload.excludedSourceIds)
      ? payload.excludedSourceIds.filter(Boolean).slice(0, 30)
      : currentSettings.excludedSourceIds
  });

  return settings;
}

async function addUserSource(userId, payload = {}) {
  const url = String(payload.url || '').trim();

  if (!url) {
    throw createError(400, 'RSS URL is required', 'INVALID_SOURCE_PAYLOAD');
  }

  const preview = await previewUserSource({ url });
  const name = String(payload.name || preview.name || '').trim().slice(0, 80);
  const language = String(payload.language || preview.language || 'it').trim().toLowerCase().slice(0, 5) || 'it';

  if (!name) {
    throw createError(400, 'Could not detect a valid feed title from the RSS URL', 'INVALID_SOURCE_PAYLOAD');
  }

  const now = new Date().toISOString();
  const source = {
    id: createId(),
    userId,
    name,
    url,
    language,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    validatedAt: now
  };

  try {
    database.createUserSource(source);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      throw createError(409, 'This RSS source already exists for the user', 'SOURCE_ALREADY_EXISTS', error);
    }
    throw error;
  }

  return source;
}

async function updateUserSource(userId, sourceId, payload = {}) {
  const existingSource = database.findUserSourceById(userId, sourceId);
  if (!existingSource) {
    throw createError(404, 'Source not found', 'RESOURCE_NOT_FOUND');
  }

  const url = String(payload.url || existingSource.url).trim();
  if (!url) {
    throw createError(400, 'RSS URL is required', 'INVALID_SOURCE_PAYLOAD');
  }

  const preview = await previewUserSource({ url });
  const nextSource = {
    name: String(payload.name || preview.name || existingSource.name).trim().slice(0, 80),
    url,
    language: String(payload.language || preview.language || existingSource.language).trim().toLowerCase().slice(0, 5) || existingSource.language,
    updatedAt: new Date().toISOString(),
    validatedAt: new Date().toISOString()
  };

  if (!nextSource.name) {
    throw createError(400, 'Could not determine a valid source name for this RSS URL', 'INVALID_SOURCE_PAYLOAD');
  }

  try {
    database.updateUserSource(userId, sourceId, nextSource);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      throw createError(409, 'This RSS source already exists for the user', 'SOURCE_ALREADY_EXISTS', error);
    }
    throw error;
  }

  database.deleteArticlesForUserSource(userId, sourceId);
  return database.findUserSourceById(userId, sourceId);
}

async function previewUserSource(payload = {}) {
  const url = String(payload.url || '').trim();

  if (!url) {
    throw createError(400, 'RSS URL is required', 'INVALID_SOURCE_PAYLOAD');
  }

  try {
    const preview = await rssParser.validateFeedUrl(url);
    return {
      name: preview.title || '',
      language: preview.language || 'it',
      itemCount: preview.itemCount || 0
    };
  } catch (error) {
    throw createError(400, 'RSS URL is not valid or cannot be parsed', 'INVALID_RSS_URL', error);
  }
}

function removeUserSource(userId, sourceId) {
  const removed = database.deleteUserSource(userId, sourceId);
  if (!removed) {
    throw createError(404, 'Source not found', 'RESOURCE_NOT_FOUND');
  }
}

function exportUserSettings(userId) {
  const settings = getUserSettings(userId);
  const customSources = database.listUserSources(userId);
  const customSourceIds = new Set(customSources.map((source) => source.id));

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: {
      defaultLanguage: settings.defaultLanguage,
      articleRetentionHours: settings.articleRetentionHours,
      recentHours: settings.recentHours,
      excludedSourceIds: settings.excludedSourceIds.filter((sourceId) => !customSourceIds.has(sourceId))
    },
    customSources: customSources.map((source) => ({
      name: source.name,
      url: source.url,
      language: source.language,
      isExcluded: settings.excludedSourceIds.includes(source.id)
    }))
  };
}

async function importUserSettings(userId, payload = {}) {
  const importedSettings = payload.settings || {};
  const importedCustomSources = Array.isArray(payload.customSources) ? payload.customSources : [];
  const globalSourceIds = getGlobalSourceIds();

  for (const source of importedCustomSources) {
    const name = String(source?.name || '').trim();
    const url = String(source?.url || '').trim();
    if (!name || !url) {
      throw createError(400, 'Imported custom sources must include a name and RSS URL', 'INVALID_IMPORT_PAYLOAD');
    }

    try {
      await rssParser.validateFeedUrl(url);
    } catch (error) {
      throw createError(400, `Imported RSS URL is not valid: ${url}`, 'INVALID_RSS_URL', error);
    }
  }

  database.deleteAllUserSources(userId);

  const now = new Date().toISOString();
  const recreatedSources = importedCustomSources.map((source) => {
    const createdSource = {
      id: createId(),
      userId,
      name: String(source.name).trim().slice(0, 80),
      url: String(source.url).trim(),
      language: String(source.language || 'it').trim().toLowerCase().slice(0, 5) || 'it',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      validatedAt: now
    };

    database.createUserSource(createdSource);
      return {
        ...createdSource,
        isExcluded: Boolean(source.isExcluded)
      };
    });

  const excludedGlobalSourceIds = Array.isArray(importedSettings.excludedSourceIds)
    ? importedSettings.excludedSourceIds.filter((sourceId) => globalSourceIds.has(sourceId))
    : [];
  const excludedCustomSourceIds = recreatedSources
    .filter((source) => source.isExcluded)
    .map((source) => source.id);

  const settings = updateUserSettings(userId, {
    defaultLanguage: importedSettings.defaultLanguage,
    articleRetentionHours: importedSettings.articleRetentionHours,
    recentHours: importedSettings.recentHours,
    excludedSourceIds: [...excludedGlobalSourceIds, ...excludedCustomSourceIds]
  });

  return {
    settings,
    customSources: database.listUserSources(userId)
  };
}

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  getCurrentUser,
  getUserSettings,
  updateUserSettings,
  addUserSource,
  updateUserSource,
  removeUserSource,
  exportUserSettings,
  importUserSettings,
  getDefaultSettings
};
