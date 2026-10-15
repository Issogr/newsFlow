import express from 'express';
import type { Request, Response } from 'express';
import newsService from '../../services/newsAggregator';
import auth from '../../utils/auth';
import newsQuery from '../../utils/newsQuery';
import helpers from './helpers';
const { requireAuthenticatedUser } = auth;
const { parseNewsQuery } = newsQuery;
const { getRequestIds, getUserContext } = helpers;

const router = express.Router();

router.get('/news', requireAuthenticatedUser, async (req: Request, res: Response) => {
  const filters = parseNewsQuery(req.query);
  const result = await newsService.getNewsFeed(filters, getUserContext(req));
  res.json(result);
});

router.get('/read-later', requireAuthenticatedUser, async (req: Request, res: Response) => {
  const filters = parseNewsQuery(req.query);
  const result = await newsService.getReadLaterFeed(filters, getUserContext(req));
  res.json(result);
});

router.post('/me/read-later', requireAuthenticatedUser, async (req, res) => {
  const result = newsService.saveReadLaterArticles(getUserContext(req), getRequestIds(req, 'articleIds', 'articleId'));
  res.status(201).json(result);
});

router.post('/me/read-later/remove', requireAuthenticatedUser, async (req, res) => {
  const result = newsService.removeReadLaterArticles(getUserContext(req), getRequestIds(req, 'articleIds', 'articleId'));
  res.json(result);
});

export default router;
