const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cookie = require('cookie');
const session = require('express-session');
const { parseIntegerEnv } = require('./env');
const {
  BFF_SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  clearBffSessionCookie,
  decryptBackendSessionCookie,
  getSessionCookieOptions,
  isValidSessionPayload,
  unsignSessionId
} = require('./sessionPolicy');

const DEFAULT_SESSION_DB_PATH = path.join(__dirname, '..', 'data', 'sessions.sqlite');
const SESSION_STORE_CLEAR_INTERVAL_MS = parseIntegerEnv('SESSION_STORE_CLEAR_INTERVAL_MS', 300000, { min: 1000 });
const SESSION_TOUCH_RENEWAL_WINDOW_MS = parseIntegerEnv('SESSION_TOUCH_RENEWAL_WINDOW_MS', 24 * 60 * 60 * 1000, { min: 1000 });

function cleanupStoredSessionUsers(sessionDb) {
  if (!sessionDb) {
    return 0;
  }

  return sessionDb.prepare(`
    DELETE FROM session_users
    WHERE NOT EXISTS (
      SELECT 1
      FROM sessions
      WHERE sessions.sid = session_users.sid
    )
  `).run().changes;
}

function getSessionExpiryTime(sessionData = {}) {
  const expiresAt = Date.parse(sessionData.cookie?.expires || '');
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

function shouldRenewSession(sessionData = {}, referenceTime = Date.now()) {
  const expiresAt = getSessionExpiryTime(sessionData);
  if (!Number.isFinite(expiresAt)) {
    return true;
  }

  return expiresAt - referenceTime <= SESSION_TOUCH_RENEWAL_WINDOW_MS;
}

function getSessionExpireValue(sessionData = {}) {
  const expiresAt = getSessionExpiryTime(sessionData) || Date.now() + SESSION_TTL_MS;
  return new Date(expiresAt).toISOString();
}

class ManagedSqliteStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.cleanupInterval = null;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);
    `);

    this.cleanupInterval = setInterval(() => this.clearExpiredSessions(), SESSION_STORE_CLEAR_INTERVAL_MS);
    this.cleanupInterval?.unref?.();
  }

  stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  clearExpiredSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expire <= ?').run(new Date().toISOString());
    cleanupStoredSessionUsers(this.db);
  }

  get(sid, callback = () => {}) {
    try {
      const row = this.db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?').get(sid);
      if (!row) {
        callback(null, null);
        return;
      }

      const expiresAt = Date.parse(row.expire);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        this.destroy(sid, () => callback(null, null));
        return;
      }

      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      this.db.prepare(`
        INSERT INTO sessions (sid, sess, expire)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
          sess = excluded.sess,
          expire = excluded.expire
      `).run(sid, JSON.stringify(sess), getSessionExpireValue(sess));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    if (!shouldRenewSession(sess)) {
      callback(null);
      return;
    }

    this.set(sid, sess, callback);
  }
}

function createSessionStore(options = {}) {
  const sessionDbPath = options.sessionDbPath || process.env.BFF_SESSION_DB_PATH || DEFAULT_SESSION_DB_PATH;
  fs.mkdirSync(path.dirname(sessionDbPath), { recursive: true });

  const db = new Database(sessionDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_users (
      sid TEXT PRIMARY KEY,
      user_id TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_users_user_id ON session_users (user_id);
  `);

  const store = new ManagedSqliteStore(db);

  return { store, db };
}

function destroyStoredSessionsByUserId(sessionStore, sessionDb, userId) {
  if (!sessionStore || !sessionDb || !userId) {
    return 0;
  }

  const matchingSessionIds = sessionDb.prepare(`
    SELECT sid
    FROM session_users
    WHERE user_id = ?
  `).all(userId).map((row) => row.sid);

  matchingSessionIds.forEach((sid) => {
    sessionStore.destroy(sid, () => {});
  });

  sessionDb.prepare('DELETE FROM session_users WHERE user_id = ?').run(userId);

  return matchingSessionIds.length;
}

function upsertStoredSessionUser(sessionDb, sid, userId) {
  if (!sessionDb || !sid || !userId) {
    return;
  }

  sessionDb.prepare(`
    INSERT INTO session_users (sid, user_id)
    VALUES (?, ?)
    ON CONFLICT(sid) DO UPDATE SET user_id = excluded.user_id
  `).run(sid, userId);
}

function removeStoredSessionUser(sessionDb, sid) {
  if (!sessionDb || !sid) {
    return;
  }

  sessionDb.prepare('DELETE FROM session_users WHERE sid = ?').run(sid);
}

function destroySession(req, sessionDb = null) {
  if (!req.session) {
    return Promise.resolve();
  }

  const sessionId = req.sessionID;

  return new Promise((resolve) => {
    req.session.destroy(() => {
      removeStoredSessionUser(sessionDb, sessionId);
      resolve();
    });
  });
}

function buildSessionMiddleware(store, secret) {
  const cookieOptions = getSessionCookieOptions();

  return session({
    name: BFF_SESSION_COOKIE_NAME,
    store,
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    unset: 'destroy',
    // Let express-session honor X-Forwarded-Proto for Secure cookies without
    // enabling global proxy trust for req.ip and forwarded-header handling.
    ...(cookieOptions.secure === true ? { proxy: true } : {}),
    cookie: cookieOptions,
  });
}

function renewSessionExpiryIfNeeded(req, res, next) {
  if (!req.session || !isValidSessionPayload(req.session) || !shouldRenewSession(req.session)) {
    next();
    return;
  }

  req.session.cookie.maxAge = SESSION_TTL_MS;
  req.session.renewedAt = new Date().toISOString();
  next();
}

function normalizeSessionState(req, res, next, sessionDb = null) {
  if (!req.session) {
    next();
    return;
  }

  const hasSessionData = Boolean(req.session.version || req.session.backendSessionCookie);
  if (!hasSessionData) {
    next();
    return;
  }

  if (isValidSessionPayload(req.session)) {
    next();
    return;
  }

  destroySession(req, sessionDb).then(() => {
    clearBffSessionCookie(res);
    next();
  });
}

function loadUpgradeSession(req, sessionStore, secret) {
  const cookies = typeof req.headers.cookie === 'string' ? cookie.parse(req.headers.cookie) : {};
  const sessionId = unsignSessionId(cookies[BFF_SESSION_COOKIE_NAME], secret);

  if (!sessionId) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    sessionStore.get(sessionId, (error, sessionData) => {
      if (error || !isValidSessionPayload(sessionData)) {
        if (sessionData) {
          sessionStore.destroy(sessionId, () => resolve(null));
          return;
        }

        resolve(null);
        return;
      }

      req.session = sessionData;
      req.sessionID = sessionId;
      if (typeof sessionStore.touch === 'function') {
        sessionStore.touch(sessionId, sessionData, () => resolve(sessionData));
        return;
      }

      resolve(sessionData);
    });
  });
}

function getBackendSessionCookieFromRequest(req) {
  return decryptBackendSessionCookie(req.session?.backendSessionCookie || '');
}

async function persistSessionUserId(req, userId, sessionDb = null) {
  if (!req.session || !userId) {
    return;
  }

  if (req.session.userId !== userId) {
    req.session.userId = userId;
    await new Promise((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()));
    });
  }

  upsertStoredSessionUser(sessionDb, req.sessionID, userId);
}

module.exports = {
  buildSessionMiddleware,
  createSessionStore,
  destroySession,
  destroyStoredSessionsByUserId,
  getBackendSessionCookieFromRequest,
  loadUpgradeSession,
  normalizeSessionState,
  persistSessionUserId,
  renewSessionExpiryIfNeeded,
  upsertStoredSessionUser
};
