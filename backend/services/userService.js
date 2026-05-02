const crypto = require('crypto');
const database = require('./database');
const rssParser = require('./rssParser');
const websocketService = require('./websocketService');
const { createError } = require('../utils/errorHandler');
const { mapWithConcurrency } = require('../utils/concurrency');
const { parseIntegerEnv } = require('../utils/env');
const { getProviderIconUrl } = require('../utils/sourceIcons');
const {
  MAX_FEEDBACK_DESCRIPTION_LENGTH,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_TITLE_LENGTH,
  MAX_FEEDBACK_VIDEO_BYTES,
} = require('../utils/feedback');
const { getConfiguredSourceGroupIds, getConfiguredSourceGroups, getGroupedConfiguredSourceIds } = require('../utils/sourceCatalog');
const {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  createSessionExpiryDate,
  createApiTokenExpiryDate,
  API_TOKEN_TTL_DAYS
} = require('../utils/auth');

const GLOBAL_RETENTION_HOURS = parseIntegerEnv('ARTICLE_RETENTION_HOURS', 24);
const MAX_RECENT_HOURS = 3;
const MIN_PASSWORD_LENGTH = 8;
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'admin').trim().slice(0, 40) || 'admin';
const PASSWORD_SETUP_TTL_MINUTES = parseIntegerEnv('PASSWORD_SETUP_TTL_MINUTES', 60, { min: 1 });
const ADMIN_BOOTSTRAP_TTL_MINUTES = parseIntegerEnv('ADMIN_BOOTSTRAP_TTL_MINUTES', 30, { min: 1 });
const ONLINE_ACTIVITY_WINDOW_MINUTES = parseIntegerEnv('ONLINE_ACTIVITY_WINDOW_MINUTES', 5, { min: 0 });
const ANONYMOUS_PUBLIC_USAGE_FLUSH_INTERVAL_MS = parseIntegerEnv('ANONYMOUS_PUBLIC_USAGE_FLUSH_INTERVAL_MS', 5000, { min: 1000 });
const ANONYMOUS_PUBLIC_USAGE_FLUSH_THRESHOLD = parseIntegerEnv('ANONYMOUS_PUBLIC_USAGE_FLUSH_THRESHOLD', 100, { min: 1 });
const AUTHENTICATED_PUBLIC_USAGE_FLUSH_INTERVAL_MS = parseIntegerEnv('AUTHENTICATED_PUBLIC_USAGE_FLUSH_INTERVAL_MS', 5000, { min: 1000 });
const AUTHENTICATED_PUBLIC_USAGE_FLUSH_THRESHOLD = parseIntegerEnv('AUTHENTICATED_PUBLIC_USAGE_FLUSH_THRESHOLD', 50, { min: 1 });
const SUPPORTED_LANGUAGES = new Set(['auto', 'it', 'en']);
const SUPPORTED_THEME_MODES = new Set(['system', 'light', 'dark']);
const SUPPORTED_READER_PANEL_POSITIONS = new Set(['left', 'center', 'right']);
const SUPPORTED_READER_TEXT_SIZES = new Set(['small', 'medium', 'large']);

let pendingAnonymousPublicApiRequests = 0;
let lastAnonymousPublicApiUsageFlushAt = Date.now();
let pendingAuthenticatedPublicApiRequests = new Map();
let pendingAuthenticatedPublicApiRequestCount = 0;
let lastAuthenticatedPublicApiUsageFlushAt = Date.now();

function flushAuthenticatedPublicApiUsage({ force = false } = {}) {
  if (pendingAuthenticatedPublicApiRequestCount <= 0) {
    return 0;
  }

  const now = Date.now();
  if (
    !force
    && pendingAuthenticatedPublicApiRequestCount < AUTHENTICATED_PUBLIC_USAGE_FLUSH_THRESHOLD
    && now - lastAuthenticatedPublicApiUsageFlushAt < AUTHENTICATED_PUBLIC_USAGE_FLUSH_INTERVAL_MS
  ) {
    return 0;
  }

  const pendingEntries = [...pendingAuthenticatedPublicApiRequests.entries()];
  const flushedCount = pendingAuthenticatedPublicApiRequestCount;

  pendingAuthenticatedPublicApiRequests = new Map();
  pendingAuthenticatedPublicApiRequestCount = 0;
  lastAuthenticatedPublicApiUsageFlushAt = now;

  try {
    pendingEntries.forEach(([userId, usage]) => {
      database.incrementUserPublicApiUsage(userId, usage.usedAt, usage.count);
    });
  } catch (error) {
    pendingEntries.forEach(([userId, usage]) => {
      const current = pendingAuthenticatedPublicApiRequests.get(userId) || { count: 0, usedAt: usage.usedAt };
      pendingAuthenticatedPublicApiRequests.set(userId, {
        count: current.count + usage.count,
        usedAt: current.usedAt > usage.usedAt ? current.usedAt : usage.usedAt
      });
      pendingAuthenticatedPublicApiRequestCount += usage.count;
    });
    throw error;
  }

  return flushedCount;
}

function flushAnonymousPublicApiUsage({ force = false } = {}) {
  const flushedAuthenticatedCount = flushAuthenticatedPublicApiUsage({ force });

  if (pendingAnonymousPublicApiRequests <= 0) {
    return flushedAuthenticatedCount;
  }

  const now = Date.now();
  if (
    !force
    && pendingAnonymousPublicApiRequests < ANONYMOUS_PUBLIC_USAGE_FLUSH_THRESHOLD
    && now - lastAnonymousPublicApiUsageFlushAt < ANONYMOUS_PUBLIC_USAGE_FLUSH_INTERVAL_MS
  ) {
    return flushedAuthenticatedCount;
  }

  const incrementBy = pendingAnonymousPublicApiRequests;
  pendingAnonymousPublicApiRequests = 0;
  lastAnonymousPublicApiUsageFlushAt = now;
  try {
    database.incrementAnonymousPublicApiRequestCount(incrementBy);
  } catch (error) {
    pendingAnonymousPublicApiRequests += incrementBy;
    throw error;
  }
  return incrementBy + flushedAuthenticatedCount;
}

function createId() {
  return crypto.randomBytes(16).toString('hex');
}

function sanitizeUsername(username) {
  return String(username || '').trim().slice(0, 40);
}

function normalizeExternalProvider(provider) {
  return String(provider || '').trim().toLowerCase().slice(0, 32);
}

function sanitizeExternalUsernamePart(value) {
  return String(value || '')
    .trim()
    .replace(/@.*$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
}

function createUniqueExternalUsername(identity = {}) {
  const base = sanitizeExternalUsernamePart(
    identity.username
    || identity.email
    || identity.name
    || identity.providerUserId
  ) || 'clerk-user';
  const safeBase = base.length >= 3 ? base : `clerk-${base}`;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const username = `${safeBase}${suffix}`.slice(0, 40);
    if (!database.findUserByUsername(username)) {
      return username;
    }
  }

  return `clerk-${createId().slice(0, 16)}`;
}

function normalizeLanguage(language) {
  const value = String(language || 'auto').trim().toLowerCase();
  return SUPPORTED_LANGUAGES.has(value) ? value : 'auto';
}

function normalizeThemeMode(mode) {
  const value = String(mode || 'system').trim().toLowerCase();
  return SUPPORTED_THEME_MODES.has(value) ? value : 'system';
}

function normalizeReaderPanelPosition(position) {
  const value = String(position || 'right').trim().toLowerCase();
  return SUPPORTED_READER_PANEL_POSITIONS.has(value) ? value : 'right';
}

function normalizeReaderTextSize(size) {
  const value = String(size || 'medium').trim().toLowerCase();
  return SUPPORTED_READER_TEXT_SIZES.has(value) ? value : 'medium';
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
  return `${getAppBaseUrl()}${pathName}#token=${encodeURIComponent(token)}`;
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
    publicApiLastUsedAt: user.publicApiLastUsedAt || null,
    publicApiRequestCount: Number(user.publicApiRequestCount || 0),
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

function getDefaultSettings(overrides = {}) {
  return {
    defaultLanguage: 'auto',
    themeMode: 'system',
    articleRetentionHours: GLOBAL_RETENTION_HOURS,
    recentHours: MAX_RECENT_HOURS,
    showNewsImages: true,
    compactNewsCards: false,
    compactNewsCardsMode: 'off',
    readerPanelPosition: 'right',
    readerTextSize: 'medium',
    lastSeenReleaseNotesVersion: '',
    sourceSetupCompleted: overrides.sourceSetupCompleted !== false,
    excludedSourceIds: [],
    excludedSubSourceIds: []
  };
}

function normalizeCompactNewsCardsMode(value, fallback = 'off') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['off', 'mobile', 'desktop', 'everywhere'].includes(normalized)) {
    return normalized;
  }

  return ['off', 'mobile', 'desktop', 'everywhere'].includes(fallback) ? fallback : 'off';
}

function getUserSettings(userId) {
  return database.getUserSettings(userId) || getDefaultSettings();
}

function buildUserPayload(user) {
  const authProviders = database.listUserAuthIdentities(user.id).map((identity) => identity.provider);

  return {
    id: user.id,
    username: user.username,
    isAdmin: String(user.username || '').toLowerCase() === ADMIN_USERNAME.toLowerCase(),
    passwordConfigured: user.passwordConfigured !== false && Boolean(user.passwordHash || user.passwordConfigured),
    authProviders
  };
}

function isClerkOnlyPasswordlessUser({ userId = '', passwordHash = null } = {}) {
  if (!userId || passwordHash) {
    return false;
  }

  return Boolean(database.findUserAuthIdentityByUserProvider(userId, 'clerk'));
}

function assertLocalPasswordCanBeEnabled({ userId = '', passwordHash = null, purpose = '' } = {}) {
  if (purpose === 'admin-bootstrap') {
    return;
  }

  if (isClerkOnlyPasswordlessUser({ userId, passwordHash })) {
    throw createError(
      403,
      'Clerk-only accounts must be merged with an existing local account before local password login can be enabled',
      'CLERK_ONLY_ACCOUNT_PASSWORD_DISABLED'
    );
  }
}

function createUserSessionForAuthResponse(userId, now = new Date().toISOString()) {
  const sessionToken = generateSessionToken();

  database.createUserSession({
    tokenHash: hashSessionToken(sessionToken),
    userId,
    createdAt: now,
    expiresAt: createSessionExpiryDate()
  });
  database.updateUserLogin(userId, now);

  return sessionToken;
}

function buildAuthResponse(user, sessionToken) {
  return {
    token: sessionToken,
    user: buildUserPayload(user),
    settings: getUserSettings(user.id),
    limits: getUserLimits(),
    sourceCatalog: getConfiguredSourceGroups(),
    customSources: database.listUserSources(user.id),
    apiToken: getUserApiToken(user.id)
  };
}

function getUserLimits() {
  return {
    articleRetentionHoursMax: GLOBAL_RETENTION_HOURS,
    recentHoursMax: MAX_RECENT_HOURS,
    feedbackTitleMaxLength: MAX_FEEDBACK_TITLE_LENGTH,
    feedbackDescriptionMaxLength: MAX_FEEDBACK_DESCRIPTION_LENGTH,
    feedbackImageMaxBytes: MAX_FEEDBACK_IMAGE_BYTES,
    feedbackVideoMaxBytes: MAX_FEEDBACK_VIDEO_BYTES,
    apiTokenTtlDays: API_TOKEN_TTL_DAYS
  };
}

function mapApiTokenForUser(tokenRecord) {
  if (!tokenRecord) {
    return null;
  }

  return {
    tokenPrefix: tokenRecord.tokenPrefix,
    label: tokenRecord.label || '',
    createdAt: tokenRecord.createdAt,
    expiresAt: tokenRecord.expiresAt,
    lastUsedAt: tokenRecord.lastUsedAt || null
  };
}

function getUserApiToken(userId) {
  return mapApiTokenForUser(database.getLatestActiveApiTokenForUser(userId));
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
    compactNewsCardsMode: normalizeCompactNewsCardsMode(
      payload.compactNewsCardsMode,
      currentSettings.compactNewsCardsMode || (currentSettings.compactNewsCards === true ? 'everywhere' : 'off')
    ),
    defaultLanguage: normalizeLanguage(payload.defaultLanguage || currentSettings.defaultLanguage),
    themeMode: normalizeThemeMode(payload.themeMode || currentSettings.themeMode),
    articleRetentionHours,
    recentHours,
    showNewsImages: typeof payload.showNewsImages === 'boolean'
      ? payload.showNewsImages
      : currentSettings.showNewsImages !== false,
    compactNewsCards: (() => {
      if (typeof payload.compactNewsCardsMode === 'string') {
        return normalizeCompactNewsCardsMode(payload.compactNewsCardsMode) !== 'off';
      }

      if (typeof payload.compactNewsCards === 'boolean') {
        return payload.compactNewsCards;
      }

      return normalizeCompactNewsCardsMode(
        currentSettings.compactNewsCardsMode,
        currentSettings.compactNewsCards === true ? 'everywhere' : 'off'
      ) !== 'off';
    })(),
    readerPanelPosition: normalizeReaderPanelPosition(payload.readerPanelPosition || currentSettings.readerPanelPosition),
    readerTextSize: normalizeReaderTextSize(payload.readerTextSize || currentSettings.readerTextSize),
    lastSeenReleaseNotesVersion: Object.prototype.hasOwnProperty.call(payload, 'lastSeenReleaseNotesVersion')
      ? normalizeReleaseNotesVersion(payload.lastSeenReleaseNotesVersion)
      : normalizeReleaseNotesVersion(currentSettings.lastSeenReleaseNotesVersion),
    sourceSetupCompleted: typeof payload.sourceSetupCompleted === 'boolean'
      ? payload.sourceSetupCompleted
      : currentSettings.sourceSetupCompleted !== false,
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

async function registerUser(payload = {}) {
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
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now
  };

  database.createUser(user);
  database.upsertUserSettings(user.id, getDefaultSettings({ sourceSetupCompleted: false }));
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

async function loginUser(payload = {}) {
  const username = sanitizeUsername(payload.username);
  const password = String(payload.password || '');

  const user = database.findUserByUsername(username);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
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

function validateClerkIdentity(identity = {}) {
  const provider = normalizeExternalProvider(identity.provider || 'clerk');
  const providerUserId = String(identity.providerUserId || '').trim().slice(0, 128);

  if (provider !== 'clerk' || !providerUserId) {
    throw createError(400, 'Invalid Clerk identity', 'INVALID_CLERK_IDENTITY');
  }

  return {
    provider,
    providerUserId,
    email: String(identity.email || '').trim().toLowerCase().slice(0, 320),
    username: String(identity.username || '').trim().slice(0, 80),
    name: String(identity.name || '').trim().slice(0, 120)
  };
}

function loginWithClerkIdentity(payload = {}) {
  const identity = validateClerkIdentity(payload);
  const now = new Date().toISOString();

  const user = database.getDb().transaction(() => {
    const existingIdentity = database.findUserAuthIdentity(identity.provider, identity.providerUserId);
    if (existingIdentity) {
      database.upsertUserAuthIdentity({
        ...identity,
        userId: existingIdentity.userId,
        createdAt: existingIdentity.createdAt,
        updatedAt: now,
        lastLoginAt: now
      });
      return database.findUserById(existingIdentity.userId);
    }

    const nextUser = {
      id: createId(),
      username: createUniqueExternalUsername(identity),
      passwordHash: null,
      createdAt: now,
      updatedAt: now
    };

    database.createUser(nextUser);
    database.upsertUserSettings(nextUser.id, getDefaultSettings({ sourceSetupCompleted: false }));
    database.upsertUserAuthIdentity({
      ...identity,
      userId: nextUser.id,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now
    });

    return database.findUserById(nextUser.id);
  })();

  const sessionToken = createUserSessionForAuthResponse(user.id, now);
  return buildAuthResponse(user, sessionToken);
}

async function mergeCurrentUserWithLocalAccount(currentUserId, payload = {}) {
  const currentUser = database.findUserById(currentUserId);
  if (!currentUser) {
    throw createError(401, 'Authentication required', 'UNAUTHORIZED');
  }

  const currentClerkIdentity = database.findUserAuthIdentityByUserProvider(currentUserId, 'clerk');
  if (!currentClerkIdentity) {
    throw createError(400, 'Current account is not authenticated with Clerk', 'CLERK_IDENTITY_REQUIRED');
  }

  const username = sanitizeUsername(payload.username);
  const password = String(payload.password || '');
  const localUser = database.findUserByUsername(username);
  if (!localUser || !(await verifyPassword(password, localUser.passwordHash))) {
    throw createError(401, 'Invalid username or password', 'UNAUTHORIZED');
  }

  const now = new Date().toISOString();
  const sessionToken = generateSessionToken();
  const targetUser = database.getDb().transaction(() => {
    const existingTargetClerkIdentity = database.findUserAuthIdentityByUserProvider(localUser.id, 'clerk');
    if (
      existingTargetClerkIdentity
      && existingTargetClerkIdentity.providerUserId !== currentClerkIdentity.providerUserId
    ) {
      throw createError(409, 'Local account is already linked to another Clerk account', 'CLERK_ACCOUNT_ALREADY_LINKED');
    }

    database.upsertUserAuthIdentity({
      provider: currentClerkIdentity.provider,
      providerUserId: currentClerkIdentity.providerUserId,
      userId: localUser.id,
      email: currentClerkIdentity.email,
      createdAt: currentClerkIdentity.createdAt,
      updatedAt: now,
      lastLoginAt: now
    });

    database.deleteSessionsByUserId(currentUserId);
    if (currentUserId !== localUser.id) {
      database.deleteAllUserSources(currentUserId);
      database.deleteUser(currentUserId);
    }

    database.createUserSession({
      tokenHash: hashSessionToken(sessionToken),
      userId: localUser.id,
      createdAt: now,
      expiresAt: createSessionExpiryDate()
    });
    database.updateUserLogin(localUser.id, now);

    return database.findUserById(localUser.id);
  })();

  return buildAuthResponse(targetUser, sessionToken);
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
    sourceCatalog: getConfiguredSourceGroups(),
    customSources: database.listUserSources(userId),
    apiToken: getUserApiToken(userId)
  };
}

function createApiTokenLabel(label) {
  return String(label || '').trim().slice(0, 80);
}

function createUserApiToken(userId, options = {}) {
  const user = database.findUserById(userId);
  if (!user) {
    throw createError(404, 'User not found', 'RESOURCE_NOT_FOUND');
  }

  const rawSecret = generateSessionToken();
  const rawToken = `nfapi_${rawSecret}`;
  const tokenHash = hashSessionToken(rawToken);
  const createdAt = new Date().toISOString();
  const expiresAt = createApiTokenExpiryDate();
  const tokenId = createId();
  const label = createApiTokenLabel(options.label);
  const revokedAt = createdAt;

  database.getDb().transaction(() => {
    database.revokeApiTokensByUserId(userId, revokedAt);
    database.createApiToken({
      id: tokenId,
      userId,
      tokenHash,
      tokenPrefix: rawToken.slice(0, 12),
      label,
      createdAt,
      expiresAt
    });
  })();

  return {
    token: rawToken,
    tokenInfo: mapApiTokenForUser(database.getLatestActiveApiTokenForUser(userId))
  };
}

function revokeUserApiToken(userId) {
  return database.revokeApiTokensByUserId(userId, new Date().toISOString()) > 0;
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
    iconUrl: preview.iconUrl,
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
  const urlChanged = url !== existingSource.url;
  const preview = urlChanged ? await previewUserSource({ url }) : null;

  const nextSource = {
    name: String(payload.name || preview?.name || existingSource.name).trim().slice(0, 80),
    url,
    language: String(payload.language || preview?.language || existingSource.language).trim().toLowerCase().slice(0, 5) || existingSource.language,
    iconUrl: urlChanged ? preview?.iconUrl || getProviderIconUrl(url) : existingSource.iconUrl || getProviderIconUrl(url),
    isActive: typeof payload.isActive === 'boolean' ? payload.isActive : existingSource.isActive !== false,
    updatedAt: new Date().toISOString(),
    validatedAt: urlChanged ? new Date().toISOString() : existingSource.validatedAt
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
      iconUrl: getProviderIconUrl(preview.siteUrl || url),
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
    version: 9,
    exportedAt: new Date().toISOString(),
    settings: {
      defaultLanguage: settings.defaultLanguage,
      themeMode: settings.themeMode || 'system',
      articleRetentionHours: settings.articleRetentionHours,
      recentHours: settings.recentHours,
      showNewsImages: settings.showNewsImages !== false,
      compactNewsCards: settings.compactNewsCards === true,
      compactNewsCardsMode: normalizeCompactNewsCardsMode(settings.compactNewsCardsMode, settings.compactNewsCards === true ? 'everywhere' : 'off'),
      readerPanelPosition: settings.readerPanelPosition || 'right',
      readerTextSize: settings.readerTextSize || 'medium',
      lastSeenReleaseNotesVersion: settings.lastSeenReleaseNotesVersion || '',
      excludedSourceIds: settings.excludedSourceIds.filter((sourceId) => !customSourceIds.has(sourceId)),
      excludedSubSourceIds: settings.excludedSubSourceIds
    },
    customSources: customSources.map((source) => ({
      name: source.name,
      url: source.url,
      language: source.language,
      iconUrl: source.iconUrl || getProviderIconUrl(source.url),
      isActive: source.isActive !== false,
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

async function completePasswordSetup(payload = {}) {
  const rawToken = String(payload.token || '').trim();
  const password = String(payload.password || '');

  validatePassword(password);

  const tokenHash = hashSessionToken(rawToken);
  const sessionToken = generateSessionToken();
  const sessionTokenHash = hashSessionToken(sessionToken);
  const now = new Date().toISOString();
  const nextPasswordHash = await hashPassword(password);
  const user = database.getDb().transaction(() => {
    const tokenRecord = getPasswordSetupTokenRecord(rawToken);

    assertLocalPasswordCanBeEnabled({
      userId: tokenRecord.userId,
      passwordHash: tokenRecord.passwordHash,
      purpose: tokenRecord.purpose
    });

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
  flushAnonymousPublicApiUsage({ force: true });

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
      anonymousPublicApiRequests: database.getAnonymousPublicApiRequestCount(),
      onlineWindowMinutes: ONLINE_ACTIVITY_WINDOW_MINUTES
    }
  };
}

function recordPublicApiRequestUsage({ authenticated = false, userId = null, usedAt = new Date().toISOString() } = {}) {
  if (authenticated && userId) {
    const current = pendingAuthenticatedPublicApiRequests.get(userId) || { count: 0, usedAt };
    pendingAuthenticatedPublicApiRequests.set(userId, {
      count: current.count + 1,
      usedAt: current.usedAt > usedAt ? current.usedAt : usedAt
    });
    pendingAuthenticatedPublicApiRequestCount += 1;
    flushAuthenticatedPublicApiUsage();
    return;
  }

  pendingAnonymousPublicApiRequests += 1;
  flushAnonymousPublicApiUsage();
}

function createUserPasswordSetupLink(adminUserId, targetUserId) {
  const targetUser = database.findUserById(targetUserId);
  if (!targetUser) {
    throw createError(404, 'User not found', 'RESOURCE_NOT_FOUND');
  }

  assertLocalPasswordCanBeEnabled({
    userId: targetUser.id,
    passwordHash: targetUser.passwordHash,
    purpose: 'password-setup'
  });

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

function deleteUserAsAdmin(adminUserId, targetUserId) {
  const adminUser = database.findUserById(adminUserId);
  const targetUser = database.findUserById(targetUserId);

  if (!adminUser) {
    throw createError(401, 'Authentication required', 'UNAUTHORIZED');
  }

  if (!targetUser) {
    throw createError(404, 'User not found', 'RESOURCE_NOT_FOUND');
  }

  if (String(targetUser.username || '').toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
    throw createError(403, 'The admin account cannot be deleted', 'FORBIDDEN');
  }

  if (targetUser.id === adminUser.id) {
    throw createError(403, 'You cannot delete your own account', 'FORBIDDEN');
  }

  database.deleteAllUserSources(targetUser.id);
  const deleted = database.deleteUser(targetUser.id);

  if (!deleted) {
    throw createError(500, 'Unable to delete user', 'DELETE_USER_FAILED');
  }

  websocketService.disconnectUserSockets(targetUser.id);

  return {
    success: true,
    user: buildUserPayload(targetUser)
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
      iconUrl: getProviderIconUrl(source.url),
      isActive: source.isActive !== false,
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
  loginWithClerkIdentity,
  mergeCurrentUserWithLocalAccount,
  logoutUser,
  getCurrentUser,
  getUserSettings,
  ensureAdminBootstrap,
  getPasswordSetupTokenDetails,
  completePasswordSetup,
  listUsersForAdmin,
  recordPublicApiRequestUsage,
  flushAnonymousPublicApiUsage,
  createUserPasswordSetupLink,
  deleteUserAsAdmin,
  updateUserSettings,
  getUserApiToken,
  createUserApiToken,
  revokeUserApiToken,
  addUserSource,
  updateUserSource,
  removeUserSource,
  exportUserSettings,
  importUserSettings,
  getDefaultSettings
};
