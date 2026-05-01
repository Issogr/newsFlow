const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const session = require('express-session');
const SqliteStoreFactory = require('better-sqlite3-session-store')(session);
const { parseIntegerEnv } = require('./env');
const {
  BFF_SESSION_COOKIE_NAME,
  clearBffSessionCookie,
  decryptBackendSessionCookie,
  getSessionCookieOptions,
  isValidSessionPayload,
  parseCookieHeader,
  unsignSessionId
} = require('./sessionPolicy');

const DEFAULT_SESSION_DB_PATH = path.join(__dirname, '..', 'data', 'sessions.sqlite');
const SESSION_STORE_CLEAR_INTERVAL_MS = parseIntegerEnv('SESSION_STORE_CLEAR_INTERVAL_MS', 300000, { min: 1000 });

function ensureSessionDbDirectory(sessionDbPath) {
  fs.mkdirSync(path.dirname(sessionDbPath), { recursive: true });
}

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

function createSessionStore(options = {}) {
  const sessionDbPath = options.sessionDbPath || process.env.BFF_SESSION_DB_PATH || DEFAULT_SESSION_DB_PATH;
  ensureSessionDbDirectory(sessionDbPath);

  const db = new Database(sessionDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_users (
      sid TEXT PRIMARY KEY,
      user_id TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_users_user_id ON session_users (user_id);
  `);

  const BaseSqliteStore = SqliteStoreFactory;
  class ManagedSqliteStore extends BaseSqliteStore {
    startInterval() {
      this.cleanupInterval = setInterval(this.clearExpiredSessions.bind(this), this.expired.intervalMs);
      this.cleanupInterval?.unref?.();
    }

    stopCleanupInterval() {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
    }

    clearExpiredSessions() {
      super.clearExpiredSessions();
      cleanupStoredSessionUsers(db);
    }
  }

  const store = new ManagedSqliteStore({
    client: db,
    expired: {
      clear: true,
      intervalMs: SESSION_STORE_CLEAR_INTERVAL_MS,
    },
  });

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
  return session({
    name: BFF_SESSION_COOKIE_NAME,
    store,
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'destroy',
    cookie: getSessionCookieOptions(),
  });
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
  const cookies = parseCookieHeader(req.headers.cookie);
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
  if (!req.session || !userId || req.session.userId === userId) {
    return;
  }

  req.session.userId = userId;
  await new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
  upsertStoredSessionUser(sessionDb, req.sessionID, userId);
}

module.exports = {
  buildSessionMiddleware,
  cleanupStoredSessionUsers,
  createSessionStore,
  destroySession,
  destroyStoredSessionsByUserId,
  getBackendSessionCookieFromRequest,
  loadUpgradeSession,
  normalizeSessionState,
  persistSessionUserId,
  upsertStoredSessionUser
};
