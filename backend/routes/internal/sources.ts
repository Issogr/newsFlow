import express from 'express';
import type { Request, Response } from 'express';
import userService from '../../services/userService';
import auth from '../../utils/auth';
import inputValidator from '../../utils/inputValidator';
import helpers from './helpers';
const { requireAuthenticatedUser } = auth;
const { validateAndSanitizeParam } = inputValidator;
const { getRequestAbortSignal, refreshUserSourceInBackground } = helpers;

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
  const source = await userService.updateUserSource(req.user.id, req.params.sourceId as string, req.body || {}, { signal: getRequestAbortSignal(req, res) });
  refreshUserSourceInBackground(req.user.id, source!.id);
  res.json({ success: true, source });
});

router.delete('/me/sources/:sourceId', [
  requireAuthenticatedUser,
  validateAndSanitizeParam('sourceId', 'Invalid source ID')
], async (req: Request, res: Response) => {
  userService.removeUserSource(req.user.id, req.params.sourceId as string);
  res.json({ success: true });
});

export default router;
