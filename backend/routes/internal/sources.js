const express = require('express');
const userService = require('../../services/userService');
const { requireAuthenticatedUser } = require('../../utils/auth');
const { validateAndSanitizeParam } = require('../../utils/inputValidator');
const { refreshUserSourceInBackground } = require('./helpers');

const router = express.Router();

router.post('/me/sources', requireAuthenticatedUser, async (req, res) => {
  const source = await userService.addUserSource(req.user.id, req.body || {});
  refreshUserSourceInBackground(req.user.id, source.id);
  res.status(201).json({ success: true, source });
});

router.patch('/me/sources/:sourceId', [
  requireAuthenticatedUser,
  validateAndSanitizeParam('sourceId', 'Invalid source ID')
], async (req, res) => {
  const source = await userService.updateUserSource(req.user.id, req.params.sourceId, req.body || {});
  refreshUserSourceInBackground(req.user.id, source.id);
  res.json({ success: true, source });
});

router.delete('/me/sources/:sourceId', [
  requireAuthenticatedUser,
  validateAndSanitizeParam('sourceId', 'Invalid source ID')
], async (req, res) => {
  userService.removeUserSource(req.user.id, req.params.sourceId);
  res.json({ success: true });
});

module.exports = router;
