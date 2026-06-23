const express = require('express');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const userService = require('../../services/userService');
const { requireAuthenticatedUser } = require('../../utils/auth');
const { asyncHandler, buildRateLimitMessage } = require('../../utils/errorHandler');
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
    return `${ipKeyGenerator(req.ip)}:${username}`;
  },
  message: buildRateLimitMessage('Too many authentication attempts. Please try again later.'),
});

const passwordSetupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const token = String(req.body?.token || req.query?.token || '').trim().slice(0, 24);
    return `${ipKeyGenerator(req.ip)}:${token}`;
  },
  message: buildRateLimitMessage('Too many password setup attempts. Please try again later.'),
});

router.post('/auth/register', [authRateLimit, sanitizeBody(['username'])], asyncHandler(async (req, res) => {
  const result = await userService.registerUser(req.body || {});
  sendAuthResult(res, result, 201);
}));

router.post('/auth/login', [authRateLimit, sanitizeBody(['username'])], asyncHandler(async (req, res) => {
  const result = await userService.loginUser(req.body || {});
  sendAuthResult(res, result);
}));

router.get('/auth/password-setup/validate', [passwordSetupRateLimit, sanitizeQuery('token')], asyncHandler(async (req, res) => {
  const details = userService.getPasswordSetupTokenDetails(req.query.token);
  res.json(details);
}));

router.post('/auth/password-setup/complete', passwordSetupRateLimit, asyncHandler(async (req, res) => {
  const result = await userService.completePasswordSetup(req.body || {});
  sendAuthResult(res, result);
}));

router.post('/auth/logout', requireAuthenticatedUser, asyncHandler(async (req, res) => {
  userService.logoutUser(req.user.sessionToken);
  clearSessionCookie(res);
  res.json({ success: true });
}));

module.exports = router;
