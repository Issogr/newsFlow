const logger = require('../utils/logger');
const database = require('./database');
const ollamaService = require('./ollamaService');
const topicNormalizer = require('./topicNormalizer');
const websocketService = require('./websocketService');

const pendingQueue = [];
const queuedArticleIds = new Set();
const activeArticleIds = new Set();
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_TOPIC_JOBS || '2', 10);

function getTopicsForArticle(articleId) {
  return database.getTopicsForArticle(articleId);
}

function enqueueArticle(article) {
  if (!article?.id || !article?.title || !ollamaService.isAvailable()) {
    return false;
  }

  if (queuedArticleIds.has(article.id) || activeArticleIds.has(article.id)) {
    return false;
  }

  const existingTopics = database.getTopicsForArticle(article.id);
  if (existingTopics.length >= 3) {
    return false;
  }

  queuedArticleIds.add(article.id);
  pendingQueue.push({
    id: article.id,
    title: article.title,
    description: article.description || '',
    content: article.content || '',
    language: article.language || 'it',
    source: article.source,
    sourceId: article.sourceId,
    ownerUserId: article.ownerUserId || null
  });

  scheduleProcessing();
  return true;
}

function scheduleProcessing() {
  while (activeArticleIds.size < MAX_CONCURRENT_JOBS && pendingQueue.length > 0) {
    const job = pendingQueue.shift();
    queuedArticleIds.delete(job.id);
    activeArticleIds.add(job.id);
    processArticle(job).finally(() => {
      activeArticleIds.delete(job.id);
      scheduleProcessing();
    });
  }
}

async function processArticle(article) {
  try {
    const aiTopics = await ollamaService.deduceTopics(article, article.language);
    const normalizedTopics = topicNormalizer.limitTopics(aiTopics, 3);
    const existingTopics = database.getTopicsForArticle(article.id);
    const mergedTopics = topicNormalizer.limitTopics([...existingTopics, ...normalizedTopics], 4);

    if (mergedTopics.length === existingTopics.length) {
      return;
    }

    database.mergeTopicsForArticle(article.id, mergedTopics, { isAiGenerated: true });
    websocketService.broadcastTopicUpdate(article.id, mergedTopics, {
      sourceId: article.sourceId,
      source: article.source,
      ownerUserId: article.ownerUserId || null
    });
    logger.info(`Async topic enrichment completed for article ${article.id}`);
  } catch (error) {
    logger.warn(`Async topic enrichment failed for ${article.id}: ${error.message}`);
  }
}

module.exports = {
  enqueueArticle,
  getTopicsForArticle,
  _getPendingJobsCount: () => pendingQueue.length,
  _getActiveJobsCount: () => activeArticleIds.size
};
