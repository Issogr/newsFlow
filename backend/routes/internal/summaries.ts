import express = require('express');
import type { Request, Response } from 'express';
const database = require('../../services/database');
const thematicSummaryService = require('../../services/thematicSummaryService');
const { requireAuthenticatedUser } = require('../../utils/auth');
const { createError } = require('../../utils/errorHandler');
const { sanitizeQuery, validateAndSanitizeParam } = require('../../utils/inputValidator');
const { getRequestIds, sendAudioResponse } = require('./helpers');

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

router.get('/podcast-summary/:summaryId/audio', [
  requireAuthenticatedUser,
  sanitizeQuery('locale'),
  validateAndSanitizeParam('summaryId', 'Invalid podcast summary ID')
], async (req: Request, res: Response) => {
  const summaryId = String(req.params.summaryId || '').trim();
  if (summaryId.length < 5) {
    throw createError(400, 'Invalid podcast summary ID', 'INVALID_PODCAST_SUMMARY_ID');
  }

  const audio = database.getPodcastSummaryAudio(summaryId, req.query.locale);
  if (!audio?.data) {
    throw createError(404, 'Podcast audio not found', 'RESOURCE_NOT_FOUND');
  }

  sendAudioResponse(req, res, audio);
});

export = router;
