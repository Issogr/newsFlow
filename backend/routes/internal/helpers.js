const newsService = require('../../services/newsAggregator');
const userService = require('../../services/userService');
const { isAuthenticatedPublicApiEnabled } = require('../../config/publicApi');
const { SESSION_COOKIE_NAME } = require('../../utils/auth');
const { createError } = require('../../utils/errorHandler');
const { parseIntegerEnv } = require('../../utils/env');
const { buildUserContext } = require('../../utils/userContext');
const logger = require('../../utils/logger');

function refreshUserSourcesInBackground(userId, options = {}, label = 'user sources') {
  try {
    Promise.resolve(newsService.refreshUserSources(userId, options))
      .catch((error) => {
        logger.warn(`Background refresh failed for ${label}: ${error.message}`);
      });
  } catch (error) {
    logger.warn(`Background refresh failed for ${label}: ${error.message}`);
  }
}

function refreshUserSourceInBackground(userId, sourceId) {
  refreshUserSourcesInBackground(userId, { sourceIds: [sourceId], broadcast: true }, `custom source ${sourceId}`);
}

function getSessionCookieOptions() {
  const ttlDays = parseIntegerEnv('SESSION_TTL_DAYS', 30, { min: 1 });
  const appBaseUrl = String(process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || '').trim();
  const cookieSecureValue = String(process.env.COOKIE_SECURE || 'auto').trim().toLowerCase();
  const secure = cookieSecureValue === 'true'
    || (cookieSecureValue === 'auto' && appBaseUrl.startsWith('https://'));

  return {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: ttlDays * 24 * 60 * 60 * 1000,
  };
}

function setSessionCookie(res, sessionToken) {
  res.cookie(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());
}

function clearSessionCookie(res) {
  const { maxAge, ...cookieOptions } = getSessionCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
}

function sendAuthResult(res, result, status = 200) {
  setSessionCookie(res, result.token);
  const { token, ...safeResult } = result;
  res.status(status).json(safeResult);
}

function getUserContext(req) {
  const settings = userService.getUserSettings(req.user.id);
  return buildUserContext(req.user.id, settings);
}

function getRequestIds(req, pluralKey, singularKey) {
  const rawIds = Array.isArray(req.body?.[pluralKey])
    ? req.body[pluralKey]
    : [req.body?.[singularKey]];

  return rawIds.map((id) => String(id || '').trim()).filter(Boolean);
}

function requireAuthenticatedPublicApiFeature(req, res, next) {
  if (isAuthenticatedPublicApiEnabled()) {
    next();
    return;
  }

  next(createError(404, 'Public API token access is disabled.', 'PUBLIC_API_DISABLED'));
}

function parseSingleByteRange(rangeHeader = '', size = 0) {
  const match = String(rangeHeader || '').match(/^bytes=(\d*)-(\d*)$/u);
  if (!match || size <= 0) {
    return null;
  }

  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;

  if (start === null && end === null) {
    return null;
  }

  if (start === null) {
    const suffixLength = end;
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    if (!Number.isFinite(start) || start < 0) {
      return null;
    }
    end = Number.isFinite(end) ? Math.min(end, size - 1) : size - 1;
  }

  if (!Number.isFinite(end) || start >= size || end < start) {
    return null;
  }

  return { start, end };
}

function sniffAudioMimeType(audioBuffer, fallbackMimeType = 'audio/mpeg') {
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < 4) {
    return fallbackMimeType;
  }

  const signature = audioBuffer.subarray(0, 12).toString('ascii');
  if (signature.startsWith('RIFF') && signature.slice(8, 12) === 'WAVE') {
    return 'audio/wav';
  }
  if (signature.startsWith('ID3') || (audioBuffer[0] === 0xff && (audioBuffer[1] & 0xe0) === 0xe0)) {
    return 'audio/mpeg';
  }
  if (signature.startsWith('OggS')) {
    return 'audio/ogg';
  }
  if (signature.startsWith('fLaC')) {
    return 'audio/flac';
  }
  if (audioBuffer.length >= 8 && audioBuffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return 'audio/mp4';
  }
  if (audioBuffer[0] === 0xff && (audioBuffer[1] === 0xf1 || audioBuffer[1] === 0xf9)) {
    return 'audio/aac';
  }

  return fallbackMimeType;
}

function sendAudioResponse(req, res, audio) {
  const audioBuffer = Buffer.isBuffer(audio.data) ? audio.data : Buffer.from(audio.data || []);
  const audioSize = audioBuffer.length;
  const mimeType = sniffAudioMimeType(audioBuffer, audio.mimeType || 'audio/mpeg');

  res.set('Content-Type', mimeType);
  res.set('Cache-Control', 'private, max-age=86400, immutable');
  res.set('Accept-Ranges', 'bytes');
  res.set('Content-Disposition', 'inline');

  if (!req.headers.range) {
    res.set('Content-Length', String(audioSize));
    res.send(audioBuffer);
    return;
  }

  const range = parseSingleByteRange(req.headers.range, audioSize);
  if (!range) {
    res.set('Content-Range', `bytes */${audioSize}`);
    res.status(416).end();
    return;
  }

  const chunk = audioBuffer.subarray(range.start, range.end + 1);
  res.status(206);
  res.set('Content-Range', `bytes ${range.start}-${range.end}/${audioSize}`);
  res.set('Content-Length', String(chunk.length));
  res.send(chunk);
}

module.exports = {
  clearSessionCookie,
  getRequestIds,
  getUserContext,
  refreshUserSourceInBackground,
  refreshUserSourcesInBackground,
  requireAuthenticatedPublicApiFeature,
  sendAudioResponse,
  sendAuthResult,
};
