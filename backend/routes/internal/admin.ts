import express = require('express');
import type { Request, Response } from 'express';
const database = require('../../services/database');
const userService = require('../../services/userService');
const { requireAdminUser, requireAuthenticatedUser } = require('../../utils/auth');
const { createError } = require('../../utils/errorHandler');
const { validateAndSanitizeParam } = require('../../utils/inputValidator');

const router = express.Router();

router.get('/admin/users', [requireAuthenticatedUser, requireAdminUser], async (req: Request, res: Response) => {
  res.json(userService.listUsersForAdmin());
});

router.post('/admin/users/:userId/password-setup-link', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateAndSanitizeParam('userId', 'Invalid user ID')
], async (req: Request, res: Response) => {
  const result = userService.createUserPasswordSetupLink(req.user.id, req.params.userId);
  res.json({ success: true, ...result });
});

router.delete('/admin/users/:userId', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateAndSanitizeParam('userId', 'Invalid user ID')
], async (req: Request, res: Response) => {
  const result = userService.deleteUserAsAdmin(req.user.id, req.params.userId);
  res.json(result);
});

router.get('/admin/articles/:articleId/topics/debug', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateAndSanitizeParam('articleId', 'Invalid article ID')
], async (req: Request, res: Response) => {
  const report = database.getTopicClassificationReport(req.params.articleId);
  if (!report) {
    throw createError(404, 'Article not found', 'RESOURCE_NOT_FOUND');
  }

  res.json(report);
});

export = router;
