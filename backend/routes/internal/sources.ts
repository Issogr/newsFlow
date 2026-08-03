import express = require('express');
import type { Request, Response } from 'express';
const userService = require('../../services/userService');
const { requireAuthenticatedUser } = require('../../utils/auth');
const { validateAndSanitizeParam } = require('../../utils/inputValidator');
const { getRequestAbortSignal, refreshUserSourceInBackground } = require('./helpers');

const router = express.Router();

router.post('/me/sources/discover', requireAuthenticatedUser, async (req, res) => {
  const feeds = await userService.discoverUserSourceFeeds(req.body || {}, { signal: getRequestAbortSignal(req, res) });
  res.json({ success: true, feeds });
});

router.post('/me/sources', requireAuthenticatedUser, async (req, res) => {
  const source = await userService.addUserSource(req.user.id, req.body || {}, { signal: getRequestAbortSignal(req, res) });
  refreshUserSourceInBackground(req.user.id, source.id);
  res.status(201).json({ success: true, source });
});

router.patch('/me/sources/:sourceId', [
  requireAuthenticatedUser,
  validateAndSanitizeParam('sourceId', 'Invalid source ID')
], async (req: Request, res: Response) => {
  const source = await userService.updateUserSource(req.user.id, req.params.sourceId, req.body || {}, { signal: getRequestAbortSignal(req, res) });
  refreshUserSourceInBackground(req.user.id, source.id);
  res.json({ success: true, source });
});

router.delete('/me/sources/:sourceId', [
  requireAuthenticatedUser,
  validateAndSanitizeParam('sourceId', 'Invalid source ID')
], async (req: Request, res: Response) => {
  userService.removeUserSource(req.user.id, req.params.sourceId);
  res.json({ success: true });
});

export = router;
