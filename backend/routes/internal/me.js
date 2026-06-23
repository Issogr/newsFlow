const express = require('express');
const userService = require('../../services/userService');
const { requireAuthenticatedUser } = require('../../utils/auth');
const { asyncHandler } = require('../../utils/errorHandler');
const {
  refreshUserSourcesInBackground,
  requireAuthenticatedPublicApiFeature,
} = require('./helpers');

const router = express.Router();

router.get('/me', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  res.json(userService.getCurrentUser(req.user.id));
}));

router.get('/me/api-token', [requireAuthenticatedUser, requireAuthenticatedPublicApiFeature], asyncHandler(async (req, res) => {
  res.json({ apiToken: userService.getUserApiToken(req.user.id) });
}));

router.post('/me/api-token', [requireAuthenticatedUser, requireAuthenticatedPublicApiFeature], asyncHandler(async (req, res) => {
  const result = userService.createUserApiToken(req.user.id, {
    label: req.body?.label
  });
  res.status(201).json(result);
}));

router.delete('/me/api-token', [requireAuthenticatedUser, requireAuthenticatedPublicApiFeature], asyncHandler(async (req, res) => {
  userService.revokeUserApiToken(req.user.id);
  res.json({ success: true, apiToken: null });
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
  refreshUserSourcesInBackground(req.user.id, { broadcast: true }, `imported sources for user ${req.user.id}`);
  res.json({ success: true, ...result });
}));

module.exports = router;
