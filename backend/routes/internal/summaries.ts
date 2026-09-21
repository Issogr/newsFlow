import express = require('express');
const database = require('../../services/database');
const thematicSummaryService = require('../../services/thematicSummaryService');
const { requireAuthenticatedUser } = require('../../utils/auth');
const { getRequestIds } = require('./helpers');

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

export = router;
