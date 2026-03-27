const crypto = require('crypto');
const database = require('./database');
const rssParser = require('./rssParser');
const { createError } = require('../utils/errorHandler');
const { getConfiguredSourceGroupIds, getGroupedConfiguredSourceIds } = require('../utils/sourceCatalog');
const {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  createSessionExpiryDate
} = require('../utils/auth');

const GLOBAL_RETENTION_HOURS = parseInt(process.env.ARTICLE_RETENTION_HOURS || '24', 10);
const MAX_RECENT_HOURS = 3;
const MIN_PASSWORD_LENGTH = 8;
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'admin').trim().slice(0, 40) || 'admin';
const PASSWORD_SETUP_TTL_MINUTES = parseInt(process.env.PASSWORD_SETUP_TTL_MINUTES || '60', 10);
const ADMIN_BOOTSTRAP_TTL_MINUTES = parseInt(process.env.ADMIN_BOOTSTRAP_TTL_MINUTES || '30', 10);
const ONLINE_ACTIVITY_WINDOW_MINUTES = parseInt(process.env.ONLINE_ACTIVITY_WINDOW_MINUTES || '5', 10);
const SUPPORTED_LANGUAGES = new Set(['auto', 'it', 'en']);
const SUPPORTED_READER_PANEL_POSITIONS = new Set(['left', 'center', 'right']);

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

function normalizeReaderPanelPosition(position) {
  const value = String(position || 'right').trim().toLowerCase();
  return SUPPORTED_READER_PANEL_POSITIONS.has(value) ? value : 'right';
}

function normalizeReleaseNotesVersion(version) {
  return String(version || '').trim().slice(0, 40);
}

function normalizeInt(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.floor(normalized) : fallback;
}

function normalizePositiveInt(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : fallback;
}

function getAppBaseUrl() {
  return String(process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '');
}

function buildSetupLink(pathName, token) {
  return `${getAppBaseUrl()}${pathName}?token=${encodeURIComponent(token)}`;
}

function validatePassword(password) {
  if (!password) {
    throw createError(400, 'Password is required', 'INVALID_PASSWORD');
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw createError(400, `Password must contain at least ${MIN_PASSWORD_LENGTH} characters`, 'INVALID_PASSWORD');
  }
}

function getPasswordSetupExpiryDate(ttlMinutes) {
  const safeTtlMinutes = normalizePositiveInt(ttlMinutes, PASSWORD_SETUP_TTL_MINUTES);
  return new Date(Date.now() + (safeTtlMinutes * 60 * 1000)).toISOString();
}

function isUserOnline(lastActivityAt) {
  if (!lastActivityAt) {
    return false;
  }

  const activityTime = new Date(lastActivityAt).getTime();
  if (!Number.isFinite(activityTime)) {
    return false;
  }

  return activityTime >= (Date.now() - (ONLINE_ACTIVITY_WINDOW_MINUTES * 60 * 1000));
}

function buildAdminUserSummary(user) {
  return {
    id: user.id,
    username: user.username,
    isAdmin: user.username.toLowerCase() === ADMIN_USERNAME.toLowerCase(),
    passwordConfigured: Boolean(user.passwordConfigured),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt || null,
    lastActivityAt: user.lastActivityAt || null,
    isOnline: isUserOnline(user.lastActivityAt)
  };
}

function createPasswordSetupToken({ userId, purpose, createdByUserId = null, ttlMinutes, pathName }) {
  const rawToken = generateSessionToken();
  const now = new Date().toISOString();
  const expiresAt = getPasswordSetupExpiryDate(ttlMinutes);

  database.createPasswordSetupToken({
    userId,
    tokenHash: hashSessionToken(rawToken),
    purpose,
    createdByUserId,
    createdAt: now,
    expiresAt,
    usedAt: null
  });

  return {
    token: rawToken,
    expiresAt,
    setupLink: buildSetupLink(pathName, rawToken)
  };
}

function getPasswordSetupTokenRecord(rawToken) {
  const token = String(rawToken || '').trim();

  if (!token) {
    throw createError(400, 'Password setup token is required', 'INVALID_PASSWORD_SETUP_TOKEN');
  }

  const tokenRecord = database.findPasswordSetupTokenByHash(hashSessionToken(token));
  if (!tokenRecord) {
    throw createError(404, 'Password setup link is invalid or expired', 'INVALID_PASSWORD_SETUP_TOKEN');
  }

  if (tokenRecord.usedAt) {
    throw createError(410, 'Password setup link has already been used', 'INVALID_PASSWORD_SETUP_TOKEN');
  }

  if (new Date(tokenRecord.expiresAt) < new Date()) {
    throw createError(410, 'Password setup link has expired', 'INVALID_PASSWORD_SETUP_TOKEN');
  }

  return tokenRecord;
}

function ensureAdminAccount() {
  const existingAdmin = database.findUserByUsername(ADMIN_USERNAME);
  if (existingAdmin) {
    return existingAdmin;
  }

  const now = new Date().toISOString();
  const adminUser = {
    id: createId(),
    username: ADMIN_USERNAME,
    passwordHash: null,
    createdAt: now,
    updatedAt: now
  };

  database.createUser(adminUser);
  database.upsertUserSettings(adminUser.id, getDefaultSettings());

  return database.findUserById(adminUser.id);
}

function getDefaultSettings() {
  return {
    defaultLanguage: 'auto',
    articleRetentionHours: GLOBAL_RETENTION_HOURS,
    recentHours: MAX_RECENT_HOURS,
    autoRefreshEnabled: true,
    showNewsImages: true,
    readerPanelPosition: 'right',
    lastSeenReleaseNotesVersion: '',
    excludedSourceIds: [],
    excludedSubSourceIds: []
  };
}

function getUserSettings(userId) {
  return database.getUserSettings(userId) || getDefaultSettings();
}

function buildUserPayload(user) {
  return {
    id: user.id,
    username: user.username,
    isAdmin: String(user.username || '').toLowerCase() === ADMIN_USERNAME.toLowerCase()
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

function normalizeUserSettingsPayload(payload = {}, currentSettings = {}, overrides = {}) {
  const articleRetentionHours = Math.min(
    GLOBAL_RETENTION_HOURS,
    Math.max(1, normalizeInt(payload.articleRetentionHours, currentSettings.articleRetentionHours))
  );
  const recentHours = Math.min(
    MAX_RECENT_HOURS,
    Math.max(1, normalizeInt(payload.recentHours, currentSettings.recentHours))
  );

  return {
    defaultLanguage: normalizeLanguage(payload.defaultLanguage || currentSettings.defaultLanguage),
    articleRetentionHours,
    recentHours,
    autoRefreshEnabled: typeof payload.autoRefreshEnabled === 'boolean'
      ? payload.autoRefreshEnabled
      : currentSettings.autoRefreshEnabled !== false,
    showNewsImages: typeof payload.showNewsImages === 'boolean'
      ? payload.showNewsImages
      : currentSettings.showNewsImages !== false,
    readerPanelPosition: normalizeReaderPanelPosition(payload.readerPanelPosition || currentSettings.readerPanelPosition),
    lastSeenReleaseNotesVersion: Object.prototype.hasOwnProperty.call(payload, 'lastSeenReleaseNotesVersion')
      ? normalizeReleaseNotesVersion(payload.lastSeenReleaseNotesVersion)
      : normalizeReleaseNotesVersion(currentSettings.lastSeenReleaseNotesVersion),
    excludedSourceIds: Array.isArray(overrides.excludedSourceIds)
      ? overrides.excludedSourceIds
      : (Array.isArray(payload.excludedSourceIds)
        ? payload.excludedSourceIds.filter(Boolean).slice(0, 30)
        : currentSettings.excludedSourceIds),
    excludedSubSourceIds: Array.isArray(overrides.excludedSubSourceIds)
      ? overrides.excludedSubSourceIds
      : (Array.isArray(payload.excludedSubSourceIds)
        ? payload.excludedSubSourceIds.filter(Boolean).slice(0, 60)
        : currentSettings.excludedSubSourceIds)
  };
}

async function mapWithConcurrency(items = [], concurrency = 4, iteratee = async (item) => item) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function registerUser(payload = {}) {
  const username = sanitizeUsername(payload.username);
  const password = String(payload.password || '');

  if (username.length < 3) {
    throw createError(400, 'Username must contain at least 3 characters', 'INVALID_USERNAME');
  }

  if (username.toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
    throw createError(403, 'This username is reserved', 'FORBIDDEN');
  }

  validatePassword(password);

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
  database.updateUserLogin(user.id, now);

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
  const now = new Date().toISOString();
  database.createUserSession({
    tokenHash: hashSessionToken(sessionToken),
    userId: user.id,
    createdAt: now,
    expiresAt: createSessionExpiryDate()
  });
  database.updateUserLogin(user.id, now);

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
  const settings = database.upsertUserSettings(userId, normalizeUserSettingsPayload(payload, currentSettings));

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
    version: 6,
    exportedAt: new Date().toISOString(),
    settings: {
      defaultLanguage: settings.defaultLanguage,
      articleRetentionHours: settings.articleRetentionHours,
      recentHours: settings.recentHours,
      autoRefreshEnabled: settings.autoRefreshEnabled !== false,
      showNewsImages: settings.showNewsImages !== false,
      readerPanelPosition: settings.readerPanelPosition || 'right',
      lastSeenReleaseNotesVersion: settings.lastSeenReleaseNotesVersion || '',
      excludedSourceIds: settings.excludedSourceIds.filter((sourceId) => !customSourceIds.has(sourceId)),
      excludedSubSourceIds: settings.excludedSubSourceIds
    },
    customSources: customSources.map((source) => ({
      name: source.name,
      url: source.url,
      language: source.language,
      isExcluded: settings.excludedSourceIds.includes(source.id)
    }))
  };
}

function ensureAdminBootstrap() {
  const adminUser = ensureAdminAccount();

  if (adminUser.passwordHash) {
    return {
      required: false,
      user: buildUserPayload(adminUser),
      setupLink: null,
      expiresAt: null,
      token: null
    };
  }

  database.deleteUnusedPasswordSetupTokens({ userId: adminUser.id, purpose: 'admin-bootstrap' });

  return {
    required: true,
    user: buildUserPayload(adminUser),
    ...createPasswordSetupToken({
      userId: adminUser.id,
      purpose: 'admin-bootstrap',
      ttlMinutes: ADMIN_BOOTSTRAP_TTL_MINUTES,
      pathName: '/admin/setup'
    })
  };
}

function getPasswordSetupTokenDetails(rawToken) {
  const tokenRecord = getPasswordSetupTokenRecord(rawToken);

  return {
    username: tokenRecord.username,
    isAdmin: tokenRecord.username.toLowerCase() === ADMIN_USERNAME.toLowerCase(),
    purpose: tokenRecord.purpose,
    expiresAt: tokenRecord.expiresAt
  };
}

function completePasswordSetup(payload = {}) {
  const rawToken = String(payload.token || '').trim();
  const password = String(payload.password || '');

  validatePassword(password);

  const tokenHash = hashSessionToken(rawToken);
  const sessionToken = generateSessionToken();
  const sessionTokenHash = hashSessionToken(sessionToken);
  const now = new Date().toISOString();
  const nextPasswordHash = hashPassword(password);
  const user = database.getDb().transaction(() => {
    const tokenRecord = getPasswordSetupTokenRecord(rawToken);

    const markedUsed = database.markPasswordSetupTokenUsed(tokenHash, now);
    if (!markedUsed) {
      throw createError(410, 'Password setup link has already been used', 'INVALID_PASSWORD_SETUP_TOKEN');
    }

    database.deleteUnusedPasswordSetupTokens({
      userId: tokenRecord.userId,
      purpose: tokenRecord.purpose,
      excludeTokenHash: tokenHash
    });
    database.updateUserPassword(tokenRecord.userId, nextPasswordHash, now);
    database.deleteSessionsByUserId(tokenRecord.userId);
    database.createUserSession({
      tokenHash: sessionTokenHash,
      userId: tokenRecord.userId,
      createdAt: now,
      expiresAt: createSessionExpiryDate()
    });
    database.updateUserLogin(tokenRecord.userId, now);

    return database.findUserById(tokenRecord.userId);
  })();

  return buildAuthResponse(user, sessionToken);
}

function listUsersForAdmin() {
  const users = database.listUsers()
    .map(buildAdminUserSummary)
    .sort((left, right) => {
      if (left.isAdmin !== right.isAdmin) {
        return left.isAdmin ? -1 : 1;
      }

      const rightActivity = right.lastActivityAt ? new Date(right.lastActivityAt).getTime() : 0;
      const leftActivity = left.lastActivityAt ? new Date(left.lastActivityAt).getTime() : 0;
      if (left.isOnline !== right.isOnline) {
        return left.isOnline ? -1 : 1;
      }
      if (rightActivity !== leftActivity) {
        return rightActivity - leftActivity;
      }

      return left.username.localeCompare(right.username);
    });

  return {
    users,
    summary: {
      totalUsers: users.length,
      onlineUsers: users.filter((user) => user.isOnline).length,
      activeUsers: users.filter((user) => user.lastActivityAt).length,
      onlineWindowMinutes: ONLINE_ACTIVITY_WINDOW_MINUTES
    }
  };
}

function createUserPasswordSetupLink(adminUserId, targetUserId) {
  const targetUser = database.findUserById(targetUserId);
  if (!targetUser) {
    throw createError(404, 'User not found', 'RESOURCE_NOT_FOUND');
  }

  database.deleteUnusedPasswordSetupTokens({ userId: targetUser.id, purpose: 'password-setup' });

  const setupToken = createPasswordSetupToken({
    userId: targetUser.id,
    createdByUserId: adminUserId,
    purpose: 'password-setup',
    ttlMinutes: PASSWORD_SETUP_TTL_MINUTES,
    pathName: '/password/setup'
  });

  return {
    user: buildUserPayload(targetUser),
    expiresAt: setupToken.expiresAt,
    setupLink: setupToken.setupLink
  };
}

async function importUserSettings(userId, payload = {}) {
  const importedSettings = payload.settings || {};
  const importedCustomSources = Array.isArray(payload.customSources) ? payload.customSources : [];
  const globalSourceIds = getConfiguredSourceGroupIds();
  const groupedSubSourceIds = getGroupedConfiguredSourceIds();

  await mapWithConcurrency(importedCustomSources, 4, async (source) => {
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
  });

  const now = new Date().toISOString();
  const recreatedSources = importedCustomSources.map((source) => {
    return {
      id: createId(),
      userId,
      name: String(source.name).trim().slice(0, 80),
      url: String(source.url).trim(),
      language: String(source.language || 'it').trim().toLowerCase().slice(0, 5) || 'it',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      validatedAt: now,
      isExcluded: Boolean(source.isExcluded)
    };
  });

  const excludedGlobalSourceIds = Array.isArray(importedSettings.excludedSourceIds)
    ? importedSettings.excludedSourceIds.filter((sourceId) => globalSourceIds.has(sourceId))
    : [];
  const excludedSubSourceIds = Array.isArray(importedSettings.excludedSubSourceIds)
    ? importedSettings.excludedSubSourceIds.filter((sourceId) => groupedSubSourceIds.has(sourceId))
    : [];
  const excludedCustomSourceIds = recreatedSources
    .filter((source) => source.isExcluded)
    .map((source) => source.id);
  const nextSettings = normalizeUserSettingsPayload(importedSettings, getUserSettings(userId), {
    excludedSourceIds: [...excludedGlobalSourceIds, ...excludedCustomSourceIds],
    excludedSubSourceIds
  });

  return database.importUserState(
    userId,
    recreatedSources.map(({ isExcluded, ...source }) => source),
    nextSettings
  );
}

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  getCurrentUser,
  getUserSettings,
  ensureAdminBootstrap,
  getPasswordSetupTokenDetails,
  completePasswordSetup,
  listUsersForAdmin,
  createUserPasswordSetupLink,
  updateUserSettings,
  addUserSource,
  updateUserSource,
  removeUserSource,
  exportUserSettings,
  importUserSettings,
  getDefaultSettings
};
