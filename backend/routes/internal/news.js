const express = require('express');
const newsService = require('../../services/newsAggregator');
const { requireAuthenticatedUser } = require('../../utils/auth');
const { asyncHandler } = require('../../utils/errorHandler');
const { sanitizeQuery } = require('../../utils/inputValidator');
const { parseNewsQuery } = require('../../utils/newsQuery');
const { getRequestIds, getUserContext } = require('./helpers');

const router = express.Router();

router.get('/news', [requireAuthenticatedUser, sanitizeQuery(['search', 'beforePubDate', 'beforeId'])], asyncHandler(async (req, res) => {
  const filters = parseNewsQuery(req.query);
  const result = await newsService.getNewsFeed(filters, getUserContext(req));
  res.json(result);
}));

router.get('/read-later', [requireAuthenticatedUser, sanitizeQuery('search')], asyncHandler(async (req, res) => {
  const filters = parseNewsQuery(req.query);
  const result = await newsService.getReadLaterFeed(filters, getUserContext(req));
  res.json(result);
}));

router.post('/me/read-later', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  const result = newsService.saveReadLaterArticles(getUserContext(req), getRequestIds(req, 'articleIds', 'articleId'));
  res.status(201).json(result);
}));

router.post('/me/read-later/remove', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  const result = newsService.removeReadLaterArticles(getUserContext(req), getRequestIds(req, 'articleIds', 'articleId'));
  res.json(result);
}));

module.exports = router;
