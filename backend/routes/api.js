const express = require('express');
const newsService = require('../services/newsAggregator');
const readerService = require('../services/readerService');
const userService = require('../services/userService');
const { asyncHandler, createError } = require('../utils/errorHandler');
const { sanitizeParam, sanitizeQuery, validateParam, sanitizeBody } = require('../utils/inputValidator');
const { requireAuthenticatedUser } = require('../utils/auth');

const router = express.Router();

function parseCsvParam(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNewsQuery(query = {}) {
  return {
    search: query.search || '',
    sourceIds: parseCsvParam(query.sources),
    topics: parseCsvParam(query.topics),
    recentHours: query.recentHours ? Number(query.recentHours) : null,
    page: query.page ? Number(query.page) : 1,
    pageSize: query.pageSize ? Number(query.pageSize) : 12
  };
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

router.post('/auth/register', [sanitizeBody(['username'])], asyncHandler(async (req, res) => {
  const result = userService.registerUser(req.body || {});
  res.status(201).json(result);
}));

router.post('/auth/login', [sanitizeBody(['username'])], asyncHandler(async (req, res) => {
  const result = userService.loginUser(req.body || {});
  res.json(result);
}));

router.post('/auth/logout', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  userService.logoutUser(req.user.sessionToken);
  res.json({ success: true });
}));

router.get('/me', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  res.json(userService.getCurrentUser(req.user.id));
}));

router.patch('/me/settings', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  const settings = userService.updateUserSettings(req.user.id, req.body || {});
  res.json({ success: true, settings });
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

router.get('/news', [requireAuthenticatedUser, sanitizeQuery('search')], asyncHandler(async (req, res) => {
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
