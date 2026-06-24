const express = require('express');
const database = require('../../services/database');
const userService = require('../../services/userService');
const { requireAdminUser, requireAuthenticatedUser } = require('../../utils/auth');
const { createError } = require('../../utils/errorHandler');
const { validateAndSanitizeParam } = require('../../utils/inputValidator');

const router = express.Router();

router.get('/admin/users', [requireAuthenticatedUser, requireAdminUser], async (req, res) => {
  res.json(userService.listUsersForAdmin());
});

router.post('/admin/users/:userId/password-setup-link', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateAndSanitizeParam('userId', 'Invalid user ID')
], async (req, res) => {
  const result = userService.createUserPasswordSetupLink(req.user.id, req.params.userId);
  res.json({ success: true, ...result });
});

router.delete('/admin/users/:userId', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateAndSanitizeParam('userId', 'Invalid user ID')
], async (req, res) => {
  const result = userService.deleteUserAsAdmin(req.user.id, req.params.userId);
  res.json(result);
});

router.get('/admin/articles/:articleId/topics/debug', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateAndSanitizeParam('articleId', 'Invalid article ID')
], async (req, res) => {
  const report = database.getTopicClassificationReport(req.params.articleId);
  if (!report) {
    throw createError(404, 'Article not found', 'RESOURCE_NOT_FOUND');
  }

  res.json(report);
});

module.exports = router;
