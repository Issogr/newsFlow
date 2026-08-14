import fs = require('node:fs');
import path = require('node:path');
import type { IncomingMessage } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import cookie = require('cookie');
import type { NextFunction, Request, Response } from 'express';
import session = require('express-session');
import { parseIntegerEnv } from './env';
import {
  BFF_SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  clearBffSessionCookie,
  decryptBackendSessionCookie,
  getSessionCookieOptions,
  isValidSessionPayload,
  unsignSessionId
} from './sessionPolicy';

declare module 'express-session' {
  interface SessionData {
    backendSessionCookie?: string;
    renewedAt?: string;
    version?: number;
  }
}

const packageRoot = path.basename(path.dirname(__dirname)) === 'dist'
  ? path.join(__dirname, '..', '..')
  : path.join(__dirname, '..');
const DEFAULT_SESSION_DB_PATH = path.join(packageRoot, 'data', 'sessions.sqlite');
const SESSION_STORE_CLEAR_INTERVAL_MS = parseIntegerEnv('SESSION_STORE_CLEAR_INTERVAL_MS', 300000, { min: 1000 });
const SESSION_TOUCH_RENEWAL_WINDOW_MS = parseIntegerEnv('SESSION_TOUCH_RENEWAL_WINDOW_MS', 24 * 60 * 60 * 1000, { min: 1000 });
const BACKEND_SESSION_COOKIE_CACHE = Symbol('backendSessionCookieCache');

const noop = (): void => {};

export interface CreateSessionStoreOptions {
  sessionDbPath?: string;
}

interface SessionAwareRequest extends IncomingMessage {
  session?: session.SessionData | (session.Session & Partial<session.SessionData>);
  [BACKEND_SESSION_COOKIE_CACHE]?: {
    encryptedCookie: string;
    backendSessionCookie: string;
  };
}

interface DestroyableSessionRequest extends IncomingMessage {
  session?: session.Session & Partial<session.SessionData>;
}

type StoreCallback = (error?: unknown) => void;
type GetStoreCallback = (error: unknown, sessionData?: session.SessionData | null) => void;
type SessionExpiryState = { cookie?: { expires?: Date | string | null } };

function getSessionExpiryTime(sessionData: SessionExpiryState = {}): number | null {
  const expires = sessionData.cookie?.expires;
  const expiresAt = expires instanceof Date ? expires.getTime() : Date.parse(expires || '');
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

function shouldRenewSession(
  sessionData: SessionExpiryState = {},
  referenceTime = Date.now(),
): boolean {
  const expiresAt = getSessionExpiryTime(sessionData);
  if (expiresAt === null) {
    return true;
  }

  return expiresAt - referenceTime <= SESSION_TOUCH_RENEWAL_WINDOW_MS;
}

function getSessionExpireValue(sessionData: SessionExpiryState = {}): string {
  const expiresAt = getSessionExpiryTime(sessionData) || Date.now() + SESSION_TTL_MS;
  return new Date(expiresAt).toISOString();
}

class ManagedSqliteStore extends session.Store {
  readonly db: DatabaseSync;
  private cleanupInterval: NodeJS.Timeout | null;

  constructor(db: DatabaseSync) {
    super();
    this.db = db;

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

  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  clearExpiredSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expire <= ?').run(new Date().toISOString());
  }

  get(sid: string, callback: GetStoreCallback): void {
    try {
      const row = this.db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?').get(sid) as
        | { sess: string; expire: string }
        | undefined;
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

  set(sid: string, sess: session.SessionData, callback: StoreCallback = noop): void {
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

  destroy(sid: string, callback: StoreCallback = noop): void {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid: string, sess: session.SessionData, callback: StoreCallback = noop): void {
    if (!shouldRenewSession(sess)) {
      callback(null);
      return;
    }

    this.set(sid, sess, callback);
  }
}

export function createSessionStore(options: CreateSessionStoreOptions = {}): {
  store: ManagedSqliteStore;
  db: DatabaseSync;
} {
  const sessionDbPath = options.sessionDbPath || process.env.BFF_SESSION_DB_PATH || DEFAULT_SESSION_DB_PATH;
  fs.mkdirSync(path.dirname(sessionDbPath), { recursive: true });

  const db = new DatabaseSync(sessionDbPath);
  const closeDatabase = db.close.bind(db);
  let closed = false;

  db.close = (): void => {
    if (closed) {
      return;
    }

    closed = true;
    closeDatabase();
  };

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  const store = new ManagedSqliteStore(db);

  return { store, db };
}

export function destroySession(req: DestroyableSessionRequest): Promise<void> {
  const sessionData = req.session;
  if (!sessionData) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    sessionData.destroy(() => resolve());
  });
}

export function saveExpressSession(sessionData: session.Session): Promise<void> {
  return new Promise((resolve, reject) => {
    sessionData.save((error) => (error ? reject(error) : resolve()));
  });
}

export function buildSessionMiddleware(store: session.Store, secret: string): ReturnType<typeof session> {
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

export function normalizeSessionState(req: Request, res: Response, next: NextFunction): void {
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
    if (shouldRenewSession(req.session)) {
      req.session.cookie.maxAge = SESSION_TTL_MS;
      req.session.renewedAt = new Date().toISOString();
    }
    next();
    return;
  }

  destroySession(req).then(() => {
    clearBffSessionCookie(res);
    next();
  });
}

export function loadUpgradeSession(
  req: SessionAwareRequest,
  sessionStore: ManagedSqliteStore,
  secret: string,
): Promise<void> {
  const cookies = typeof req.headers.cookie === 'string' ? cookie.parseCookie(req.headers.cookie) : {};
  const sessionId = unsignSessionId(cookies[BFF_SESSION_COOKIE_NAME], secret);

  if (!sessionId) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    sessionStore.get(sessionId, (error, sessionData) => {
      if (error || !sessionData || !isValidSessionPayload(sessionData)) {
        if (sessionData) {
          sessionStore.destroy(sessionId, () => resolve());
          return;
        }

        resolve();
        return;
      }

      req.session = sessionData;
      sessionStore.touch(sessionId, sessionData, () => resolve());
    });
  });
}

export function getBackendSessionCookieFromRequest(req: SessionAwareRequest): string {
  const encryptedCookie = req.session?.backendSessionCookie || '';
  if (req[BACKEND_SESSION_COOKIE_CACHE]?.encryptedCookie === encryptedCookie) {
    return req[BACKEND_SESSION_COOKIE_CACHE].backendSessionCookie;
  }

  const backendSessionCookie = decryptBackendSessionCookie(encryptedCookie);
  req[BACKEND_SESSION_COOKIE_CACHE] = { encryptedCookie, backendSessionCookie };
  return backendSessionCookie;
}
