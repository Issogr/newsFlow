/**
 * Servizio per l'elaborazione asincrona di attività in background
 * Implementa un sistema di code per evitare timeout nelle richieste HTTP
 */

const logger = require('../utils/logger');
const cache = require('memory-cache');
const ollamaService = require('./ollamaService');
const topicNormalizer = require('./topicNormalizer');

// Cache per memorizzare i job in corso
const JOBS_CACHE_KEY = 'async_jobs';
const JOBS_CACHE_TTL = 30 * 60 * 1000; // 30 minuti

// Code di elaborazione
const topicDeductionQueue = [];
let isProcessing = false;

// Limiti e configurazione 
const MAX_QUEUE_SIZE = 1000; // Numero massimo di job in coda
const JOB_TIMEOUT = 5 * 60 * 1000; // Timeout di 5 minuti per job

// Intervallo di elaborazione in ms (più rapido = più CPU, più lento = meno reattivo)
const PROCESSING_INTERVAL = 100;

/**
 * Avvia un job asincrono per dedurre i topic di un articolo
 * @param {string} articleId - ID dell'articolo
 * @param {Object} article - Oggetto articolo
 * @param {string} language - Lingua dell'articolo
 * @returns {string[]} - Array di topic esistenti o vuoto (i topic dedotti saranno aggiunti in modo asincrono)
 */
function startTopicDeduction(articleId, article, language) {
  // Se l'articolo ha già almeno 2 topic, non avviare un nuovo job
  if (article.topics && Array.isArray(article.topics) && article.topics.length >= 2) {
    return article.topics;
  }
  
  // Se c'è già un job in corso per questo articolo, restituisci i topic esistenti
  const jobsCache = cache.get(JOBS_CACHE_KEY) || {};
  if (jobsCache[articleId] && jobsCache[articleId].status !== 'completed') {
    return article.topics || [];
  }
  
  // Verifica se la coda ha raggiunto il limite massimo
  if (topicDeductionQueue.length >= MAX_QUEUE_SIZE) {
    logger.warn(`Topic deduction queue is full (${MAX_QUEUE_SIZE} items). Skipping article ${articleId}`);
    return article.topics || [];
  }
  
  // Crea un nuovo job con timeout
  const job = {
    id: articleId,
    article,
    language,
    status: 'pending',
    createdAt: Date.now(),
    result: article.topics || [],
    timeout: setTimeout(() => {
      handleJobTimeout(articleId);
    }, JOB_TIMEOUT)
  };
  
  // Salva il job nella cache
  jobsCache[articleId] = job;
  cache.put(JOBS_CACHE_KEY, jobsCache, JOBS_CACHE_TTL);
  
  // Aggiungi il job alla coda
  topicDeductionQueue.push(job);
  
  // Avvia l'elaborazione se non è già in corso
  if (!isProcessing) {
    processNextJob();
  }
  
  // Restituisci i topic esistenti (quelli dedotti verranno aggiunti più tardi)
  return article.topics || [];
}

/**
 * Gestisce il timeout di un job
 * @param {string} jobId - ID del job
 */
function handleJobTimeout(jobId) {
  // Verifica se il job è ancora nella coda
  const queueIndex = topicDeductionQueue.findIndex(job => job.id === jobId);
  if (queueIndex !== -1) {
    // Rimuovi il job dalla coda
    const job = topicDeductionQueue.splice(queueIndex, 1)[0];
    logger.warn(`Job ${jobId} timed out after ${JOB_TIMEOUT/1000} seconds and was removed from queue`);
    
    // Aggiorna lo stato del job nella cache
    const jobsCache = cache.get(JOBS_CACHE_KEY) || {};
    if (jobsCache[jobId]) {
      jobsCache[jobId].status = 'timeout';
      jobsCache[jobId].completedAt = Date.now();
      cache.put(JOBS_CACHE_KEY, jobsCache, JOBS_CACHE_TTL);
    }
  }
}

/**
 * Processa il prossimo job nella coda
 */
async function processNextJob() {
  // Se la coda è vuota, termina l'elaborazione
  if (topicDeductionQueue.length === 0) {
    isProcessing = false;
    return;
  }
  
  isProcessing = true;
  
  // Estrai il prossimo job dalla coda
  const job = topicDeductionQueue.shift();
  
  try {
    // Cancella il timeout perché stiamo elaborando il job
    if (job.timeout) {
      clearTimeout(job.timeout);
    }
    
    // Aggiorna lo stato del job
    const jobsCache = cache.get(JOBS_CACHE_KEY) || {};
    if (jobsCache[job.id]) {
      jobsCache[job.id].status = 'processing';
      cache.put(JOBS_CACHE_KEY, jobsCache, JOBS_CACHE_TTL);
    }
    
    // Esegui la deduzione dei topic con timeout di sicurezza
    const existingTopics = job.result || [];
    let deducedTopics = [];
    
    try {
      // Imposta un timeout esplicito per la deduzione
      const deductionPromise = ollamaService.deduceTopics(job.article, job.language);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Topic deduction timeout')), 4000)
      );
      
      // Attendi il primo tra completamento e timeout
      deducedTopics = await Promise.race([deductionPromise, timeoutPromise]);
    } catch (error) {
      logger.warn(`Topic deduction timed out or failed for article ${job.id}: ${error.message}`);
      
      // Fallback: usa il metodo statico se Ollama fallisce
      deducedTopics = deduceTopicsStatically(job.article);
    }
    
    // Combina i topic esistenti con quelli dedotti e rimuovi duplicati
    const combinedTopics = [...new Set([...existingTopics, ...deducedTopics])];
    
    // Aggiorna la cache con il risultato
    const updatedJobsCache = cache.get(JOBS_CACHE_KEY) || {};
    if (updatedJobsCache[job.id]) {
      updatedJobsCache[job.id].status = 'completed';
      updatedJobsCache[job.id].result = combinedTopics;
      updatedJobsCache[job.id].completedAt = Date.now();
      cache.put(JOBS_CACHE_KEY, updatedJobsCache, JOBS_CACHE_TTL);
    }
    
    // Aggiorna l'articolo nella cache delle notizie se esiste
    updateArticleTopics(job.id, combinedTopics);
    
    logger.info(`Successfully deduced topics for article ${job.id}: ${combinedTopics.join(', ')}`);
  } catch (error) {
    logger.error(`Error processing job ${job.id}: ${error.message}`);
    
    // Aggiorna lo stato del job in caso di errore
    const jobsCache = cache.get(JOBS_CACHE_KEY) || {};
    if (jobsCache[job.id]) {
      jobsCache[job.id].status = 'error';
      jobsCache[job.id].error = error.message;
      jobsCache[job.id].completedAt = Date.now();
      cache.put(JOBS_CACHE_KEY, jobsCache, JOBS_CACHE_TTL);
    }
  }
  
  // Pianifica l'elaborazione del prossimo job dopo un breve intervallo
  // Questo previene il blocco del thread principale e consente altre operazioni
  setTimeout(processNextJob, PROCESSING_INTERVAL);
}

/**
 * Aggiorna i topic di un articolo nella cache delle notizie
 * @param {string} articleId - ID dell'articolo
 * @param {string[]} topics - Nuovi topic
 */
function updateArticleTopics(articleId, topics) {
  // Ottieni la cache delle notizie
  const allNewsCache = cache.get('all_news');
  if (!allNewsCache) return;
  
  let updated = false;
  
  // Cerca l'articolo in tutti i gruppi
  allNewsCache.forEach(group => {
    if (!group.items) return;
    
    // Cerca l'articolo nel gruppo
    const articleIndex = group.items.findIndex(item => item.id === articleId);
    if (articleIndex >= 0) {
      // Aggiorna i topic dell'articolo
      group.items[articleIndex].topics = topics;
      
      // Aggiorna anche i topic del gruppo
      const allGroupTopics = group.items.flatMap(item => item.topics || []);
      group.topics = [...new Set(allGroupTopics)];
      
      updated = true;
    }
  });
  
  // Salva la cache aggiornata
  if (updated) {
    cache.put('all_news', allNewsCache);
    logger.info(`Updated topics for article ${articleId} in news cache`);
  }
}

/**
 * Deduce topic staticamente usando parole chiave nel testo
 * @param {Object} article - Articolo da analizzare
 * @returns {string[]} - Topic dedotti
 */
function deduceTopicsStatically(article) {
  const topics = [];
  
  if (!article || !article.title) return topics;
  
  // Testo da analizzare
  const text = `${article.title} ${article.description || ''} ${article.content || ''}`.toLowerCase();
  
  // Verifica le equivalenze in tutte le lingue
  Object.entries(topicNormalizer.topicEquivalents).forEach(([normalizedTopic, variants]) => {
    for (const variant of variants) {
      if (text.includes(variant.toLowerCase())) {
        topics.push(normalizedTopic);
        break; // Una volta trovata una corrispondenza per questo topic, passa al prossimo
      }
    }
  });
  
  return topics;
}

/**
 * Recupera i topic attuali per un articolo (inclusi quelli dedotti)
 * @param {string} articleId - ID dell'articolo
 * @returns {string[]} - Topic dedotti o vuoto se il job non esiste
 */
function getTopicsForArticle(articleId) {
  const jobsCache = cache.get(JOBS_CACHE_KEY) || {};
  const job = jobsCache[articleId];
  
  if (job && (job.status === 'completed' || job.status === 'error' || job.status === 'timeout')) {
    return job.result || [];
  }
  
  return [];
}

/**
 * Pulisce i job completati o troppo vecchi dalla cache
 * Chiamato periodicamente dal server
 */
function cleanupJobs() {
  const jobsCache = cache.get(JOBS_CACHE_KEY) || {};
  const now = Date.now();
  let cleaned = 0;
  
  Object.keys(jobsCache).forEach(jobId => {
    const job = jobsCache[jobId];
    
    // Rimuovi job completati più vecchi di 1 ora
    if ((job.status === 'completed' || job.status === 'error' || job.status === 'timeout') && 
        job.completedAt && (now - job.completedAt > 60 * 60 * 1000)) {
      delete jobsCache[jobId];
      cleaned++;
    }
    
    // Rimuovi job pendenti troppo vecchi (più di 2 ore)
    if (job.status === 'pending' && (now - job.createdAt > 2 * 60 * 60 * 1000)) {
      delete jobsCache[jobId];
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    cache.put(JOBS_CACHE_KEY, jobsCache, JOBS_CACHE_TTL);
    logger.info(`Cleaned up ${cleaned} old jobs from cache`);
  }
}

module.exports = {
  startTopicDeduction,
  getTopicsForArticle,
  cleanupJobs
};