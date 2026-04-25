const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const newsService = require('../services/newsAggregator');
const readerService = require('../services/readerService');
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
const { parseNewsQuery } = require('../utils/newsQuery');

const router = express.Router();

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
    return `${req.ip}:${username}`;
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
    return `${req.ip}:${token}`;
  },
  message: {
    error: {
      message: 'Too many password setup attempts. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  },
});

function getSessionCookieOptions() {
  const ttlDays = parseInt(process.env.SESSION_TTL_DAYS || '30', 10);
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
  return {
    userId: req.user.id,
    articleRetentionHours: settings.articleRetentionHours,
    excludedSourceIds: settings.excludedSourceIds,
    excludedSubSourceIds: settings.excludedSubSourceIds,
    settings
  };
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
  await newsService.refreshUserSources(req.user.id, { sourceIds: [source.id], broadcast: false });
  res.status(201).json({ success: true, source });
}));

router.patch('/me/sources/:sourceId', [
  requireAuthenticatedUser,
  validateParam('sourceId', 'Invalid source ID'),
  sanitizeParam('sourceId')
], asyncHandler(async (req, res) => {
  const source = await userService.updateUserSource(req.user.id, req.params.sourceId, req.body || {});
  await newsService.refreshUserSources(req.user.id, { sourceIds: [source.id], broadcast: false });
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

router.get('/news', [requireAuthenticatedUser, sanitizeQuery('search'), sanitizeQuery('beforePubDate'), sanitizeQuery('beforeId')], asyncHandler(async (req, res) => {
  const filters = parseNewsQuery(req.query);
  const result = await newsService.getNewsFeed(filters, getUserContext(req));
  res.json(result);
}));

router.get('/articles/:articleId/reader', [
  requireAuthenticatedUser,
  validateParam('articleId', 'ID articolo non valido'),
  sanitizeParam('articleId')
], asyncHandler(async (req, res) => {
  const { articleId } = req.params;

  if (articleId.length < 5) {
    throw createError(400, 'ID articolo non valido', 'INVALID_ARTICLE_ID');
  }

  const readerArticle = await readerService.getReaderArticle(articleId, {
    forceRefresh: req.query.refresh === 'true',
    userId: req.user.id,
    maxArticleAgeHours: getUserContext(req).articleRetentionHours
  });

  res.json(readerArticle);
}));

module.exports = router;
