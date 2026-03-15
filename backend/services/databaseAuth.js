function createAuthRepository({ getDb }) {
  function createUser(user = {}) {
    getDb().prepare(`
      INSERT INTO users (id, username, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      user.id,
      user.username,
      user.passwordHash || null,
      user.createdAt,
      user.updatedAt
    );
  }

  function findUserByUsername(username) {
    if (!username) {
      return null;
    }

    return getDb().prepare(`
      SELECT id, username, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt
      FROM users
      WHERE lower(username) = lower(?)
    `).get(username);
  }

  function findUserById(userId) {
    if (!userId) {
      return null;
    }

    return getDb().prepare(`
      SELECT id, username, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt
      FROM users
      WHERE id = ?
    `).get(userId);
  }

  function createUserSession(session = {}) {
    getDb().prepare(`
      INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(session.tokenHash, session.userId, session.createdAt, session.expiresAt);
  }

  function findSessionByTokenHash(tokenHash) {
    if (!tokenHash) {
      return null;
    }

    return getDb().prepare(`
      SELECT user_sessions.token_hash AS tokenHash, user_sessions.user_id AS userId,
             user_sessions.created_at AS createdAt, user_sessions.expires_at AS expiresAt,
             users.username AS username
      FROM user_sessions
      JOIN users ON users.id = user_sessions.user_id
      WHERE user_sessions.token_hash = ?
    `).get(tokenHash);
  }

  function deleteSessionByTokenHash(tokenHash) {
    if (!tokenHash) {
      return 0;
    }

    return getDb().prepare(`
      DELETE FROM user_sessions
      WHERE token_hash = ?
    `).run(tokenHash).changes;
  }

  function purgeExpiredSessions() {
    return getDb().prepare(`
      DELETE FROM user_sessions
      WHERE expires_at < ?
    `).run(new Date().toISOString()).changes;
  }

  return {
    createUser,
    findUserByUsername,
    findUserById,
    createUserSession,
    findSessionByTokenHash,
    deleteSessionByTokenHash,
    purgeExpiredSessions
  };
}

module.exports = createAuthRepository;
