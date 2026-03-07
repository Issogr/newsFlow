const axios = require('axios');
const logger = require('../utils/logger');
const topicNormalizer = require('./topicNormalizer');

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:1b';
const USE_OLLAMA = process.env.USE_OLLAMA === 'true';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '4000', 10);
const MAX_CONCURRENT_REQUESTS = parseInt(process.env.OLLAMA_MAX_CONCURRENT || '2', 10);

let currentRequests = 0;
let availabilityCheckInterval;
let ollamaAvailable = false;
const pendingRequests = [];

function processNextRequest() {
  if (currentRequests >= MAX_CONCURRENT_REQUESTS || pendingRequests.length === 0) {
    return;
  }

  const nextRequest = pendingRequests.shift();
  nextRequest();
}

function queueRequest(requestFn) {
  if (!USE_OLLAMA || !ollamaAvailable) {
    return Promise.reject(new Error('Ollama unavailable'));
  }

  return new Promise((resolve, reject) => {
    const execute = async () => {
      currentRequests += 1;

      try {
        const result = await requestFn();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        currentRequests -= 1;
        processNextRequest();
      }
    };

    if (currentRequests < MAX_CONCURRENT_REQUESTS) {
      execute();
      return;
    }

    pendingRequests.push(execute);
  });
}

async function deduceTopics(article, language = 'it') {
  if (!article?.title || !USE_OLLAMA || !ollamaAvailable) {
    return [];
  }

  const limitedText = [article.title, article.description || '', article.content || '']
    .join(' ')
    .trim()
    .slice(0, 900);

  if (limitedText.length < 20) {
    return [];
  }

  try {
    const response = await queueRequest(() => axios.post(`${OLLAMA_API_URL}/generate`, {
      model: OLLAMA_MODEL,
      prompt: buildPrompt(limitedText, language),
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 24
      }
    }, {
      timeout: OLLAMA_TIMEOUT
    }));

    const rawTopics = String(response.data?.response || '')
      .split(/[,;\n]/)
      .map((topic) => topicNormalizer.normalizeTopic(topic))
      .filter(Boolean);

    return topicNormalizer.limitTopics(rawTopics, 3);
  } catch (error) {
    logger.warn(`Ollama topic deduction failed: ${error.message}`);
    return [];
  }
}

function buildPrompt(text, language) {
  const categories = topicNormalizer.CANONICAL_TOPICS.join(', ');
  return [
    `Language: ${language}`,
    `Choose up to 3 topics from this exact list: ${categories}.`,
    'Return only comma-separated topic names, with no explanations.',
    `News text: ${text}`
  ].join(' ');
}

async function checkOllamaAvailability() {
  if (!USE_OLLAMA) {
    ollamaAvailable = false;
    return false;
  }

  try {
    await axios.get(`${OLLAMA_API_URL}/version`, { timeout: 2000 });
    ollamaAvailable = true;
    return true;
  } catch (error) {
    ollamaAvailable = false;
    logger.warn(`Ollama unavailable at ${OLLAMA_API_URL}: ${error.message}`);
    return false;
  }
}

function startAvailabilityChecks() {
  if (!USE_OLLAMA || availabilityCheckInterval) {
    return;
  }

  checkOllamaAvailability().catch(() => {});
  availabilityCheckInterval = setInterval(() => {
    checkOllamaAvailability().catch(() => {});
  }, 60000);
}

function isAvailable() {
  return USE_OLLAMA && ollamaAvailable;
}

startAvailabilityChecks();

process.on('exit', () => {
  if (availabilityCheckInterval) {
    clearInterval(availabilityCheckInterval);
  }
});

module.exports = {
  deduceTopics,
  checkOllamaAvailability,
  isAvailable
};
