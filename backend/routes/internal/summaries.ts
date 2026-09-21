import express from 'express';
import database from '../../services/database';
import thematicSummaryService from '../../services/thematicSummaryService';
import auth from '../../utils/auth';
import helpers from './helpers';
const { requireAuthenticatedUser } = auth;
const { getRequestIds } = helpers;

const router = express.Router();

router.get('/thematic-summaries', requireAuthenticatedUser, async (req, res) => {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({
    ...thematicSummaryService.getLatestSummaries(),
    readSummaryIds: database.listReadThematicSummaryIds(req.user.id)
  });
});

router.post('/me/thematic-summaries/read', requireAuthenticatedUser, async (req, res) => {
  const readSummaryIds = database.markThematicSummariesRead(req.user.id, getRequestIds(req, 'summaryIds', 'summaryId'));
  res.status(201).json({ success: true, readSummaryIds });
});

export default router;
