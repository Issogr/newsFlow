function createAuthRepository({ getDb }) {
  function normalizeTouchIntervalSeconds(minIntervalSeconds) {
    const parsed = Number(minIntervalSeconds);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  }

  function mapUserRow(row) {
    if (!row) {
      return null;
    }

    return {
      ...row,
      passwordConfigured: Boolean(row.passwordConfigured)
    };
  }

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

    return mapUserRow(getDb().prepare(`
      SELECT id, username, password_hash AS passwordHash,
             last_login_at AS lastLoginAt, last_activity_at AS lastActivityAt,
             created_at AS createdAt, updated_at AS updatedAt,
             CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END AS passwordConfigured
      FROM users
      WHERE lower(username) = lower(?)
    `).get(username));
  }

  function findUserById(userId) {
    if (!userId) {
      return null;
    }

    return mapUserRow(getDb().prepare(`
      SELECT id, username, password_hash AS passwordHash,
             last_login_at AS lastLoginAt, last_activity_at AS lastActivityAt,
             created_at AS createdAt, updated_at AS updatedAt,
             CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END AS passwordConfigured
      FROM users
      WHERE id = ?
    `).get(userId));
  }

  function listUsers() {
    return getDb().prepare(`
      SELECT id, username, last_login_at AS lastLoginAt, last_activity_at AS lastActivityAt,
             created_at AS createdAt, updated_at AS updatedAt,
             CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END AS passwordConfigured
      FROM users
      ORDER BY lower(username) ASC
    `).all().map(mapUserRow);
  }

  function updateUserLogin(userId, loginAt) {
    if (!userId) {
      return 0;
    }

    return getDb().prepare(`
      UPDATE users
      SET last_login_at = ?, last_activity_at = ?
      WHERE id = ?
    `).run(loginAt, loginAt, userId).changes;
  }

  function touchUserActivity(userId, activityAt, minIntervalSeconds = 60) {
    if (!userId) {
      return 0;
    }

    const safeIntervalSeconds = normalizeTouchIntervalSeconds(minIntervalSeconds);
    const cutoffIso = new Date(new Date(activityAt).getTime() - (safeIntervalSeconds * 1000)).toISOString();

    return getDb().prepare(`
      UPDATE users
      SET last_activity_at = ?
      WHERE id = ?
        AND (
          last_activity_at IS NULL
          OR last_activity_at < ?
        )
    `).run(activityAt, userId, cutoffIso).changes;
  }

  function updateUserPassword(userId, passwordHash, updatedAt) {
    if (!userId) {
      return 0;
    }

    return getDb().prepare(`
      UPDATE users
      SET password_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(passwordHash || null, updatedAt, userId).changes;
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

  function deleteSessionsByUserId(userId, exceptTokenHash = null) {
    if (!userId) {
      return 0;
    }

    if (exceptTokenHash) {
      return getDb().prepare(`
        DELETE FROM user_sessions
        WHERE user_id = ? AND token_hash != ?
      `).run(userId, exceptTokenHash).changes;
    }

    return getDb().prepare(`
      DELETE FROM user_sessions
      WHERE user_id = ?
    `).run(userId).changes;
  }

  function createPasswordSetupToken(token = {}) {
    getDb().prepare(`
      INSERT INTO password_setup_tokens (
        user_id, token_hash, purpose, created_by_user_id, created_at, expires_at, used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      token.userId,
      token.tokenHash,
      token.purpose,
      token.createdByUserId || null,
      token.createdAt,
      token.expiresAt,
      token.usedAt || null
    );
  }

  function findPasswordSetupTokenByHash(tokenHash) {
    if (!tokenHash) {
      return null;
    }

    return getDb().prepare(`
      SELECT password_setup_tokens.id, password_setup_tokens.user_id AS userId,
             password_setup_tokens.token_hash AS tokenHash,
             password_setup_tokens.purpose,
             password_setup_tokens.created_by_user_id AS createdByUserId,
             password_setup_tokens.created_at AS createdAt,
             password_setup_tokens.expires_at AS expiresAt,
             password_setup_tokens.used_at AS usedAt,
             users.username AS username,
             users.password_hash AS passwordHash
      FROM password_setup_tokens
      JOIN users ON users.id = password_setup_tokens.user_id
      WHERE password_setup_tokens.token_hash = ?
    `).get(tokenHash) || null;
  }

  function markPasswordSetupTokenUsed(tokenHash, usedAt) {
    if (!tokenHash) {
      return 0;
    }

    return getDb().prepare(`
      UPDATE password_setup_tokens
      SET used_at = ?
      WHERE token_hash = ? AND used_at IS NULL
    `).run(usedAt, tokenHash).changes;
  }

  function deleteUnusedPasswordSetupTokens({ userId = null, purpose = null, excludeTokenHash = null } = {}) {
    const conditions = ['used_at IS NULL'];
    const params = [];

    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }

    if (Array.isArray(purpose) && purpose.length > 0) {
      conditions.push(`purpose IN (${purpose.map(() => '?').join(', ')})`);
      params.push(...purpose);
    } else if (purpose) {
      conditions.push('purpose = ?');
      params.push(purpose);
    }

    if (excludeTokenHash) {
      conditions.push('token_hash != ?');
      params.push(excludeTokenHash);
    }

    return getDb().prepare(`
      DELETE FROM password_setup_tokens
      WHERE ${conditions.join(' AND ')}
    `).run(...params).changes;
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
    listUsers,
    updateUserLogin,
    touchUserActivity,
    updateUserPassword,
    createUserSession,
    findSessionByTokenHash,
    deleteSessionByTokenHash,
    deleteSessionsByUserId,
    createPasswordSetupToken,
    findPasswordSetupTokenByHash,
    markPasswordSetupTokenUsed,
    deleteUnusedPasswordSetupTokens,
    purgeExpiredSessions
  };
}

module.exports = createAuthRepository;
