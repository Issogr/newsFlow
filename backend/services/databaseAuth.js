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

  function createApiToken(token = {}) {
    getDb().prepare(`
      INSERT INTO api_tokens (
        id, user_id, token_hash, token_prefix, label, created_at, expires_at, revoked_at, last_used_at, created_by_ip, last_used_ip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      token.id,
      token.userId,
      token.tokenHash,
      token.tokenPrefix,
      token.label || null,
      token.createdAt,
      token.expiresAt,
      token.revokedAt || null,
      token.lastUsedAt || null,
      token.createdByIp || null,
      token.lastUsedIp || null
    );
  }

  function mapApiTokenRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      tokenPrefix: row.tokenPrefix,
      label: row.label || '',
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt || null,
      lastUsedAt: row.lastUsedAt || null,
      createdByIp: row.createdByIp || null,
      lastUsedIp: row.lastUsedIp || null,
      username: row.username || null
    };
  }

  function getLatestActiveApiTokenForUser(userId) {
    if (!userId) {
      return null;
    }

    return mapApiTokenRow(getDb().prepare(`
      SELECT id, user_id AS userId, token_hash AS tokenHash, token_prefix AS tokenPrefix,
             label, created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt,
             last_used_at AS lastUsedAt, created_by_ip AS createdByIp, last_used_ip AS lastUsedIp
      FROM api_tokens
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND expires_at >= ?
      ORDER BY datetime(created_at) DESC
      LIMIT 1
    `).get(userId, new Date().toISOString()));
  }

  function findActiveApiTokenByHash(tokenHash) {
    if (!tokenHash) {
      return null;
    }

    return mapApiTokenRow(getDb().prepare(`
      SELECT api_tokens.id, api_tokens.user_id AS userId, api_tokens.token_hash AS tokenHash,
             api_tokens.token_prefix AS tokenPrefix, api_tokens.label,
             api_tokens.created_at AS createdAt, api_tokens.expires_at AS expiresAt,
             api_tokens.revoked_at AS revokedAt, api_tokens.last_used_at AS lastUsedAt,
             api_tokens.created_by_ip AS createdByIp, api_tokens.last_used_ip AS lastUsedIp,
             users.username AS username
      FROM api_tokens
      JOIN users ON users.id = api_tokens.user_id
      WHERE api_tokens.token_hash = ?
        AND api_tokens.revoked_at IS NULL
        AND api_tokens.expires_at >= ?
      LIMIT 1
    `).get(tokenHash, new Date().toISOString()));
  }

  function revokeApiTokensByUserId(userId, revokedAt) {
    if (!userId) {
      return 0;
    }

    return getDb().prepare(`
      DELETE FROM api_tokens
      WHERE user_id = ? AND revoked_at IS NULL
    `).run(userId).changes;
  }

  function touchApiTokenUsage(tokenId, usedAt, usedIp = null) {
    if (!tokenId) {
      return 0;
    }

    return getDb().prepare(`
      UPDATE api_tokens
      SET last_used_at = ?, last_used_ip = ?
      WHERE id = ?
    `).run(usedAt, usedIp || null, tokenId).changes;
  }

  function purgeExpiredApiTokens() {
    return getDb().prepare(`
      DELETE FROM api_tokens
      WHERE expires_at < ? OR revoked_at IS NOT NULL
    `).run(new Date().toISOString()).changes;
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

  function refreshSessionExpiry(tokenHash, expiresAt) {
    if (!tokenHash || !expiresAt) {
      return 0;
    }

    return getDb().prepare(`
      UPDATE user_sessions
      SET expires_at = ?
      WHERE token_hash = ?
    `).run(expiresAt, tokenHash).changes;
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
    createApiToken,
    findSessionByTokenHash,
    refreshSessionExpiry,
    getLatestActiveApiTokenForUser,
    findActiveApiTokenByHash,
    deleteSessionByTokenHash,
    deleteSessionsByUserId,
    revokeApiTokensByUserId,
    touchApiTokenUsage,
    createPasswordSetupToken,
    findPasswordSetupTokenByHash,
    markPasswordSetupTokenUsed,
    deleteUnusedPasswordSetupTokens,
    purgeExpiredSessions,
    purgeExpiredApiTokens
  };
}

module.exports = createAuthRepository;
