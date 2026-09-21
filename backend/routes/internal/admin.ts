import express from 'express';
import type { Request, Response } from 'express';
import database from '../../services/database';
import userService from '../../services/userService';
import auth from '../../utils/auth';
import { createError } from '../../utils/errorHandler';
import inputValidator from '../../utils/inputValidator';
const { requireAdminUser, requireAuthenticatedUser } = auth;
const { validateAndSanitizeParam } = inputValidator;

const router = express.Router();

router.get('/admin/users', [requireAuthenticatedUser, requireAdminUser], async (req: Request, res: Response) => {
  res.json(userService.listUsersForAdmin());
});

router.post('/admin/users/:userId/password-setup-link', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateAndSanitizeParam('userId', 'Invalid user ID')
], async (req: Request, res: Response) => {
  const result = userService.createUserPasswordSetupLink(req.user.id, req.params.userId as string);
  res.json({ success: true, ...result });
});

router.delete('/admin/users/:userId', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateAndSanitizeParam('userId', 'Invalid user ID')
], async (req: Request, res: Response) => {
  const result = userService.deleteUserAsAdmin(req.user.id, req.params.userId as string);
  res.json(result);
});

router.get('/admin/articles/:articleId/topics/debug', [
  requireAuthenticatedUser,
  requireAdminUser,
  validateAndSanitizeParam('articleId', 'Invalid article ID')
], async (req: Request, res: Response) => {
  const report = database.getTopicClassificationReport(req.params.articleId as string);
  if (!report) {
    throw createError(404, 'Article not found', 'RESOURCE_NOT_FOUND');
  }

  res.json(report);
});

export default router;
