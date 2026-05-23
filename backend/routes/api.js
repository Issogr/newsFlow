const express = require('express');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const multer = require('multer');
const newsService = require('../services/newsAggregator');
const database = require('../services/database');
const readerService = require('../services/readerService');
const thematicSummaryService = require('../services/thematicSummaryService');
const userService = require('../services/userService');
const feedbackService = require('../services/feedbackService');
const {
  FEEDBACK_CATEGORIES,
  MAX_FEEDBACK_ATTACHMENT_BYTES,
  MAX_FEEDBACK_DESCRIPTION_LENGTH,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_TITLE_LENGTH,
  MAX_FEEDBACK_VIDEO_BYTES,
  getFeedbackAttachmentType,
} = require('../utils/feedback');
const { asyncHandler, createError } = require('../utils/errorHandler');
const { sanitizeParam, sanitizeQuery, validateParam, sanitizeBody } = require('../utils/inputValidator');
const { requireAuthenticatedUser, requireAdminUser, SESSION_COOKIE_NAME } = require('../utils/auth');
const { parseIntegerEnv } = require('../utils/env');
const { parseNewsQuery } = require('../utils/newsQuery');
const { buildUserContext } = require('../utils/userContext');
const logger = require('../utils/logger');

const router = express.Router();

function refreshUserSourceInBackground(userId, sourceId) {
  try {
    Promise.resolve(newsService.refreshUserSources(userId, { sourceIds: [sourceId], broadcast: true }))
      .catch((error) => {
        logger.warn(`Custom source refresh failed for ${sourceId}: ${error.message}`);
      });
  } catch (error) {
    logger.warn(`Custom source refresh failed for ${sourceId}: ${error.message}`);
  }
}

const feedbackRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message: 'Too many feedback submissions. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  },
});

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    return `${ipKeyGenerator(req.ip)}:${username}`;
  },
  message: {
    error: {
      message: 'Too many authentication attempts. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  },
});

const passwordSetupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const token = String(req.body?.token || req.query?.token || '').trim().slice(0, 24);
    return `${ipKeyGenerator(req.ip)}:${token}`;
  },
  message: {
    error: {
      message: 'Too many password setup attempts. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  },
});

function getSessionCookieOptions() {
  const ttlDays = parseIntegerEnv('SESSION_TTL_DAYS', 30, { min: 1 });
  const appBaseUrl = String(process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || '').trim();
  const secure = process.env.COOKIE_SECURE === 'true'
    || (process.env.COOKIE_SECURE !== 'false' && appBaseUrl.startsWith('https://'));

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

const feedbackUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_FEEDBACK_ATTACHMENT_BYTES,
  },
  fileFilter: (req, file, callback) => {
    const mimeType = String(file?.mimetype || '');

    if (mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
      callback(null, true);
      return;
    }

    callback(createError(400, 'Please attach an image or a small video.', 'INVALID_FEEDBACK_IMAGE'));
  },
});

function validateFeedbackAttachment(file) {
  if (!file) {
    return;
  }

  const attachmentType = getFeedbackAttachmentType(file);

  if (!attachmentType) {
    throw createError(400, 'Please attach an image or a small video.', 'INVALID_FEEDBACK_IMAGE');
  }

  if (attachmentType === 'image' && file.size > MAX_FEEDBACK_IMAGE_BYTES) {
    throw createError(413, 'Images must be 5 MB or smaller.', 'INVALID_FEEDBACK_IMAGE');
  }

  if (attachmentType === 'video' && file.size > MAX_FEEDBACK_VIDEO_BYTES) {
    throw createError(413, 'Videos must be 12 MB or smaller.', 'INVALID_FEEDBACK_IMAGE');
  }
}

function handleFeedbackUpload(req, res, next) {
  feedbackUpload.single('attachment')(req, res, (error) => {
    if (!error) {
      try {
        validateFeedbackAttachment(req.file || null);
        next();
        return;
      } catch (validationError) {
        next(validationError);
        return;
      }
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(createError(413, 'Attachments must be 12 MB or smaller.', 'INVALID_FEEDBACK_IMAGE'));
        return;
      }

      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        next(createError(400, 'Attach only one image or video.', 'INVALID_FEEDBACK_IMAGE'));
        return;
      }
    }

    if (error.status && error.code) {
      next(error);
      return;
    }

    next(createError(400, 'Unable to process the uploaded attachment.', 'INVALID_FEEDBACK_IMAGE', error));
  });
}

function getUserContext(req) {
  const settings = userService.getUserSettings(req.user.id);
  return buildUserContext(req.user.id, settings);
}

function getRequestArticleIds(req) {
  const rawArticleIds = Array.isArray(req.body?.articleIds)
    ? req.body.articleIds
    : [req.body?.articleId];

  return rawArticleIds.map((articleId) => String(articleId || '').trim()).filter(Boolean);
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
  res.set('Cache-Control', 'private, no-store, max-age=0');
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

router.post('/auth/register', [authRateLimit, sanitizeBody(['username'])], asyncHandler(async (req, res) => {
  const result = await userService.registerUser(req.body || {});
  setSessionCookie(res, result.token);
  const { token, ...safeResult } = result;
  res.status(201).json(safeResult);
}));

router.post('/auth/login', [authRateLimit, sanitizeBody(['username'])], asyncHandler(async (req, res) => {
  const result = await userService.loginUser(req.body || {});
  setSessionCookie(res, result.token);
  const { token, ...safeResult } = result;
  res.json(safeResult);
}));

router.get('/auth/password-setup/validate', [passwordSetupRateLimit, sanitizeQuery('token')], asyncHandler(async (req, res) => {
  const details = userService.getPasswordSetupTokenDetails(req.query.token);
  res.json(details);
}));

router.post('/auth/password-setup/complete', passwordSetupRateLimit, asyncHandler(async (req, res) => {
  const result = await userService.completePasswordSetup(req.body || {});
  setSessionCookie(res, result.token);
  const { token, ...safeResult } = result;
  res.json(safeResult);
}));

router.post('/auth/logout', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  userService.logoutUser(req.user.sessionToken);
  clearSessionCookie(res);
  res.json({ success: true });
}));

router.get('/me', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  res.json(userService.getCurrentUser(req.user.id));
}));

router.get('/me/api-token', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  res.json({ apiToken: userService.getUserApiToken(req.user.id) });
}));

router.post('/me/api-token', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  const result = userService.createUserApiToken(req.user.id, {
    label: req.body?.label
  });
  res.status(201).json(result);
}));

router.delete('/me/api-token', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  userService.revokeUserApiToken(req.user.id);
  res.json({ success: true, apiToken: null });
}));

router.patch('/me/settings', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  const settings = userService.updateUserSettings(req.user.id, req.body || {});
  res.json({ success: true, settings });
}));

router.post('/me/feedback', [requireAuthenticatedUser, feedbackRateLimit, handleFeedbackUpload], asyncHandler(async (req, res) => {
  const category = String(req.body?.category || '').trim().toLowerCase();
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();

  if (!FEEDBACK_CATEGORIES.has(category)) {
    throw createError(400, 'Please choose a valid feedback category.', 'INVALID_FEEDBACK_PAYLOAD');
  }

  if (title.length < 3) {
    throw createError(400, 'Title must contain at least 3 characters.', 'INVALID_FEEDBACK_PAYLOAD');
  }

  if (title.length > MAX_FEEDBACK_TITLE_LENGTH) {
    throw createError(400, `Title must be ${MAX_FEEDBACK_TITLE_LENGTH} characters or fewer.`, 'INVALID_FEEDBACK_PAYLOAD');
  }

  if (!description) {
    throw createError(400, 'Description is required.', 'INVALID_FEEDBACK_PAYLOAD');
  }

  if (description.length > MAX_FEEDBACK_DESCRIPTION_LENGTH) {
    throw createError(400, `Description must be ${MAX_FEEDBACK_DESCRIPTION_LENGTH} characters or fewer.`, 'INVALID_FEEDBACK_PAYLOAD');
  }

  await feedbackService.sendFeedback({
    user: req.user,
    category,
    title,
    description,
    attachment: req.file || null,
  });

  res.status(201).json({ success: true });
}));

router.get('/me/settings/export', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  res.json(userService.exportUserSettings(req.user.id));
}));

router.post('/me/settings/import', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  const result = await userService.importUserSettings(req.user.id, req.body || {});
  await newsService.refreshUserSources(req.user.id, { broadcast: false });
  res.json({ success: true, ...result });
}));

router.post('/me/sources', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  const source = await userService.addUserSource(req.user.id, req.body || {});
  refreshUserSourceInBackground(req.user.id, source.id);
  res.status(201).json({ success: true, source });
}));

router.patch('/me/sources/:sourceId', [
  requireAuthenticatedUser,
  validateParam('sourceId', 'Invalid source ID'),
  sanitizeParam('sourceId')
], asyncHandler(async (req, res) => {
  const source = await userService.updateUserSource(req.user.id, req.params.sourceId, req.body || {});
  refreshUserSourceInBackground(req.user.id, source.id);
  res.json({ success: true, source });
}));

router.delete('/me/sources/:sourceId', [
  requireAuthenticatedUser,
  validateParam('sourceId', 'Invalid source ID'),
  sanitizeParam('sourceId')
], asyncHandler(async (req, res) => {
  userService.removeUserSource(req.user.id, req.params.sourceId);
  res.json({ success: true });
}));

router.get('/admin/users', [requireAuthenticatedUser, requireAdminUser], asyncHandler(async (req, res) => {
  res.json(userService.listUsersForAdmin());
}));

router.post('/admin/users/:userId/password-setup-link', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateParam('userId', 'Invalid user ID'),
  sanitizeParam('userId')
], asyncHandler(async (req, res) => {
  const result = userService.createUserPasswordSetupLink(req.user.id, req.params.userId);
  res.json({ success: true, ...result });
}));

router.delete('/admin/users/:userId', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateParam('userId', 'Invalid user ID'),
  sanitizeParam('userId')
], asyncHandler(async (req, res) => {
  const result = userService.deleteUserAsAdmin(req.user.id, req.params.userId);
  res.json(result);
}));

router.get('/admin/articles/:articleId/topics/debug', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateParam('articleId', 'Invalid article ID'),
  sanitizeParam('articleId')
], asyncHandler(async (req, res) => {
  const report = database.getTopicClassificationReport(req.params.articleId);
  if (!report) {
    throw createError(404, 'Article not found', 'RESOURCE_NOT_FOUND');
  }

  res.json(report);
}));

router.get('/news', [requireAuthenticatedUser, sanitizeQuery('search'), sanitizeQuery('beforePubDate'), sanitizeQuery('beforeId')], asyncHandler(async (req, res) => {
  const filters = parseNewsQuery(req.query);
  const result = await newsService.getNewsFeed(filters, getUserContext(req));
  res.json(result);
}));

router.get('/read-later', [requireAuthenticatedUser, sanitizeQuery('search')], asyncHandler(async (req, res) => {
  const filters = parseNewsQuery(req.query);
  const result = await newsService.getReadLaterFeed(filters, getUserContext(req));
  res.json(result);
}));

router.get('/thematic-summaries', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json(thematicSummaryService.getLatestSummaries());
}));

router.get('/podcast-summary', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({ item: thematicSummaryService.getLatestPodcastSummary() });
}));

router.get('/podcast-summary/:summaryId/audio', [
  requireAuthenticatedUser,
  validateParam('summaryId', 'Invalid podcast summary ID'),
  sanitizeParam('summaryId')
], asyncHandler(async (req, res) => {
  const summaryId = String(req.params.summaryId || '').trim();
  if (summaryId.length < 5) {
    throw createError(400, 'Invalid podcast summary ID', 'INVALID_PODCAST_SUMMARY_ID');
  }

  const audio = database.getPodcastSummaryAudio(summaryId);
  if (!audio?.data) {
    throw createError(404, 'Podcast audio not found', 'RESOURCE_NOT_FOUND');
  }

  sendAudioResponse(req, res, audio);
}));

router.post('/me/read-later', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  const result = newsService.saveReadLaterArticles(getUserContext(req), getRequestArticleIds(req));
  res.status(201).json(result);
}));

router.post('/me/read-later/remove', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  const result = newsService.removeReadLaterArticles(getUserContext(req), getRequestArticleIds(req));
  res.json(result);
}));

router.get('/articles/:articleId/reader', [
  requireAuthenticatedUser,
  validateParam('articleId', 'ID articolo non valido'),
  sanitizeParam('articleId')
], asyncHandler(async (req, res) => {
  const { articleId } = req.params;
  const userContext = getUserContext(req);

  if (articleId.length < 5) {
    throw createError(400, 'ID articolo non valido', 'INVALID_ARTICLE_ID');
  }

  const readerArticle = await readerService.getReaderArticle(articleId, {
    forceRefresh: req.query.refresh === 'true',
    userId: req.user.id,
    maxArticleAgeHours: database.isReadLaterArticle(req.user.id, articleId) ? null : userContext.articleRetentionHours
  });

  res.json(readerArticle);
}));

module.exports = router;
