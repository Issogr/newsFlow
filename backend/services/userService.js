const crypto = require('crypto');
const database = require('./database');
const rssParser = require('./rssParser');
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
    hiddenSourceIds: []
  };
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
    customSources: database.listUserSources(user.id)
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
    hiddenSourceIds: Array.isArray(payload.hiddenSourceIds)
      ? payload.hiddenSourceIds.filter(Boolean).slice(0, 30)
      : currentSettings.hiddenSourceIds
  });

  return settings;
}

async function addUserSource(userId, payload = {}) {
  const name = String(payload.name || '').trim().slice(0, 80);
  const url = String(payload.url || '').trim();

  if (!name || !url) {
    throw createError(400, 'Name and RSS URL are required', 'INVALID_SOURCE_PAYLOAD');
  }

  try {
    await rssParser.validateFeedUrl(url);
  } catch (error) {
    throw createError(400, 'RSS URL is not valid or cannot be parsed', 'INVALID_RSS_URL', error);
  }

  const now = new Date().toISOString();
  const source = {
    id: createId(),
    userId,
    name,
    url,
    language: String(payload.language || 'it').trim().toLowerCase().slice(0, 5) || 'it',
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

function removeUserSource(userId, sourceId) {
  const removed = database.deleteUserSource(userId, sourceId);
  if (!removed) {
    throw createError(404, 'Source not found', 'RESOURCE_NOT_FOUND');
  }
}

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  getCurrentUser,
  getUserSettings,
  updateUserSettings,
  addUserSource,
  removeUserSource,
  getDefaultSettings
};
