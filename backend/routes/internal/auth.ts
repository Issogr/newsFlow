import express = require('express');
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Request, Response } from 'express';
const userService = require('../../services/userService');
const { requireAuthenticatedUser } = require('../../utils/auth');
const { buildRateLimitMessage } = require('../../utils/errorHandler');
const { sanitizeBody, sanitizeQuery } = require('../../utils/inputValidator');
const { clearSessionCookie, sendAuthResult } = require('./helpers');

const router = express.Router();

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    return `${ipKeyGenerator(req.ip || '')}:${username}`;
  },
  message: buildRateLimitMessage('Too many authentication attempts. Please try again later.'),
});

const registrationIpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || ''),
  message: buildRateLimitMessage('Too many registration attempts. Please try again later.'),
});

const passwordSetupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const token = String(req.body?.token || req.query?.token || '').trim().slice(0, 24);
    return `${ipKeyGenerator(req.ip || '')}:${token}`;
  },
  message: buildRateLimitMessage('Too many password setup attempts. Please try again later.'),
});

router.post('/auth/register', [registrationIpRateLimit, authRateLimit, sanitizeBody(['username'])], async (req: Request, res: Response) => {
  const result = await userService.registerUser(req.body || {});
  sendAuthResult(req, res, result, 201);
});

router.post('/auth/login', [authRateLimit, sanitizeBody(['username'])], async (req: Request, res: Response) => {
  const result = await userService.loginUser(req.body || {});
  sendAuthResult(req, res, result);
});

router.get('/auth/password-setup/validate', [passwordSetupRateLimit, sanitizeQuery('token')], async (req: Request, res: Response) => {
  const details = userService.getPasswordSetupTokenDetails(req.query.token);
  res.json(details);
});

router.post('/auth/password-setup/complete', passwordSetupRateLimit, async (req, res) => {
  const result = await userService.completePasswordSetup(req.body || {});
  sendAuthResult(req, res, result);
});

router.post('/auth/logout', requireAuthenticatedUser, async (req, res) => {
  userService.logoutUser(req.user.sessionToken);
  clearSessionCookie(req, res);
  res.json({ success: true });
});

export = router;
