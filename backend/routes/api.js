const express = require('express');
const adminRoutes = require('./internal/admin');
const authRoutes = require('./internal/auth');
const feedbackRoutes = require('./internal/feedback');
const meRoutes = require('./internal/me');
const newsRoutes = require('./internal/news');
const readerRoutes = require('./internal/reader');
const sourceRoutes = require('./internal/sources');
const summaryRoutes = require('./internal/summaries');

const router = express.Router();

router.use(authRoutes);
router.use(meRoutes);
router.use(feedbackRoutes);
router.use(sourceRoutes);
router.use(adminRoutes);
router.use(newsRoutes);
router.use(summaryRoutes);
router.use(readerRoutes);

module.exports = router;
