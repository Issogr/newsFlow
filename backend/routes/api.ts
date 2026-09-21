import express from 'express';
import adminRoutes from './internal/admin';
import authRoutes from './internal/auth';
import feedbackRoutes from './internal/feedback';
import meRoutes from './internal/me';
import newsRoutes from './internal/news';
import readerRoutes from './internal/reader';
import sourceRoutes from './internal/sources';
import summaryRoutes from './internal/summaries';

const router = express.Router();

router.use(authRoutes);
router.use(meRoutes);
router.use(feedbackRoutes);
router.use(sourceRoutes);
router.use(adminRoutes);
router.use(newsRoutes);
router.use(summaryRoutes);
router.use(readerRoutes);

export default router;
