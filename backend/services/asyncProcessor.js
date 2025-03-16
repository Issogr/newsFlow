/**
 * Servizio per l'elaborazione asincrona di attività in background
 * Implementa un sistema di code per evitare timeout nelle richieste HTTP
 */

const logger = require('../utils/logger');
const ollamaService = require('./ollamaService');
const topicNormalizer = require('./topicNormalizer');

// Code di elaborazione
const topicDeductionQueue = [];
// Struttura dati per tenere traccia dei job in memoria
const activeJobs = new Map();
let isProcessing = false;

// Intervallo di elaborazione in ms (più rapido = più CPU, più lento = meno reattivo)
const PROCESSING_INTERVAL = parseInt(process.env.PROCESSING_INTERVAL || '100', 10);
// Massimo numero di job attivi
const MAX_ACTIVE_JOBS = parseInt(process.env.MAX_ACTIVE_JOBS || '500', 10);
// Età massima in ms per i job completati (30 minuti)
const MAX_JOB_AGE = parseInt(process.env.MAX_JOB_AGE || '1800000', 10);
// Priorità per tipologia di job
const JOB_PRIORITIES = {
  'topic_deduction': 1,
  'default': 10
};

/**
 * Avvia un job asincrono per dedurre i topic di un articolo
 * @param {string} articleId - ID dell'articolo
 * @param {Object} article - Oggetto articolo
 * @param {string} language - Lingua dell'articolo
 * @returns {string[]} - Array di topic esistenti o vuoto (i topic dedotti saranno aggiunti in modo asincrono)
 */
function startTopicDeduction(articleId, article, language) {
  // Validazione input
  if (!articleId || !article || !article.title) {
    logger.warn(`Invalid input for topic deduction job: ${articleId}`);
    return [];
  }
  
  // Se l'articolo ha già almeno 3 topic, non avviare un nuovo job
  if (article.topics && Array.isArray(article.topics) && article.topics.length >= 3) {
    return article.topics;
  }
  
  // Se c'è già un job in corso per questo articolo, restituisci i topic esistenti
  if (activeJobs.has(articleId) && activeJobs.get(articleId).status !== 'completed') {
    return article.topics || [];
  }
  
  // Limita il numero di job attivi per prevenire memory leak
  if (activeJobs.size >= MAX_ACTIVE_JOBS) {
    cleanupCompletedJobs(true); // Pulizia forzata
    
    // Se siamo ancora oltre il limite, non creare nuovi job
    if (activeJobs.size >= MAX_ACTIVE_JOBS) {
      logger.warn(`Too many active jobs (${activeJobs.size}/${MAX_ACTIVE_JOBS}), skipping topic deduction for ${articleId}`);
      return article.topics || [];
    }
  }
  
  // Crea un nuovo job
  const job = {
    id: articleId,
    article: {
      id: article.id,
      title: article.title,
      description: article.description || '',
      language: language
    }, // Memorizza solo i campi necessari per dedurre i topic
    type: 'topic_deduction',
    priority: JOB_PRIORITIES['topic_deduction'],
    language,
    status: 'pending',
    createdAt: Date.now(),
    result: article.topics || [],
    attempts: 0,
    maxAttempts: 2
  };
  
  // Salva il job nella memoria
  activeJobs.set(articleId, job);
  
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
 * Processa il prossimo job nella coda
 */
async function processNextJob() {
  // Se la coda è vuota, termina l'elaborazione
  if (topicDeductionQueue.length === 0) {
    isProcessing = false;
    return;
  }
  
  isProcessing = true;
  
  // Ordina per priorità e prendi il prossimo job
  topicDeductionQueue.sort((a, b) => a.priority - b.priority);
  const job = topicDeductionQueue.shift();
  
  try {
    // Aggiorna lo stato del job
    if (activeJobs.has(job.id)) {
      const updatedJob = activeJobs.get(job.id);
      updatedJob.status = 'processing';
      updatedJob.attempts += 1;
      updatedJob.processingStartedAt = Date.now();
      activeJobs.set(job.id, updatedJob);
    } else {
      // Se il job non esiste più (pulizia), passa al prossimo
      setImmediate(processNextJob);
      return;
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
      
      // Se siamo all'ultimo tentativo, registra l'errore
      if (job.attempts >= job.maxAttempts) {
        logger.error(`Final attempt failed for job ${job.id}: ${error.message}`);
      } else {
        // Altrimenti rimetti in coda con priorità inferiore 
        // per un nuovo tentativo, ma solo se abbiamo pochi topic
        if (existingTopics.length < 2 && deducedTopics.length < 1) {
          const retryJob = {...job, priority: job.priority + 5};
          topicDeductionQueue.push(retryJob);
        }
      }
    }
    
    // Combina i topic esistenti con quelli dedotti e rimuovi duplicati (case-insensitive)
    const caseFoldedSet = new Set();
    const combinedTopics = [];
    
    [...existingTopics, ...deducedTopics].forEach(topic => {
      if (!topic) return;
      
      const lowerTopic = topic.toLowerCase();
      if (!caseFoldedSet.has(lowerTopic)) {
        caseFoldedSet.add(lowerTopic);
        combinedTopics.push(topic);
      }
    });
    
    // Aggiorna lo stato del job con il risultato
    if (activeJobs.has(job.id)) {
      const updatedJob = activeJobs.get(job.id);
      updatedJob.status = 'completed';
      updatedJob.result = combinedTopics;
      updatedJob.completedAt = Date.now();
      activeJobs.set(job.id, updatedJob);
    }
    
    // Aggiorna l'articolo originale (tenta di aggiornare direttamente l'articolo)
    updateArticleTopics(job.id, combinedTopics);
    
    logger.info(`Successfully deduced topics for article ${job.id}: ${combinedTopics.join(', ')}`);
  } catch (error) {
    logger.error(`Error processing job ${job.id}: ${error.message}`);
    
    // Aggiorna lo stato del job in caso di errore
    if (activeJobs.has(job.id)) {
      const updatedJob = activeJobs.get(job.id);
      updatedJob.status = 'error';
      updatedJob.error = error.message;
      updatedJob.completedAt = Date.now();
      activeJobs.set(job.id, updatedJob);
    }
  }
  
  // Pianifica l'elaborazione del prossimo job dopo un breve intervallo
  // Questo previene il blocco del thread principale e consente altre operazioni
  setTimeout(processNextJob, PROCESSING_INTERVAL);
}

/**
 * Aggiorna i topic di un articolo
 * @param {string} articleId - ID dell'articolo
 * @param {string[]} topics - Nuovi topic
 */
function updateArticleTopics(articleId, topics) {
  // Questa funzione è di fatto un noop, ma pronta per future estensioni
  // come un sistema di websocket o event bus
  
  logger.debug(`Topics updated for article ${articleId}: ${topics.join(', ')}`);
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
  const text = `${article.title} ${article.description || ''}`.toLowerCase();
  
  // Verifica le equivalenze in tutte le lingue con un approccio più preciso
  // Per evitare falsi positivi, richiede una corrispondenza più forte
  const wordsInText = text.split(/\s+/);
  
  Object.entries(topicNormalizer.topicEquivalents).forEach(([normalizedTopic, variants]) => {
    for (const variant of variants) {
      // Per varianti di 1-2 caratteri richiedi match esatto della parola
      if (variant.length <= 2) {
        if (wordsInText.includes(variant)) {
          topics.push(normalizedTopic);
          break;
        }
      } 
      // Per varianti brevi (3-4 caratteri) richiedi match all'inizio di una parola o parola esatta
      else if (variant.length <= 4) {
        const variantRegex = new RegExp(`\\b${variant}\\w*\\b`, 'i');
        if (variantRegex.test(text)) {
          topics.push(normalizedTopic);
          break;
        }
      }
      // Per varianti più lunghe controlla inclusione normale
      else if (text.includes(variant.toLowerCase())) {
        topics.push(normalizedTopic);
        break;
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
  const job = activeJobs.get(articleId);
  
  if (job) {
    return job.result || [];
  }
  
  return [];
}

/**
 * Pulisce i job completati dalla memoria
 * @param {boolean} force - Se true, forza una pulizia anche per job recenti
 */
function cleanupCompletedJobs(force = false) {
  const MAX_AGE_MS = force ? 60 * 1000 : MAX_JOB_AGE; // 1 minuto in caso di force, altrimenti 30 minuti
  const now = Date.now();
  let deletedCount = 0;
  
  for (const [jobId, job] of activeJobs.entries()) {
    // Rimuovi job completati o in errore che sono più vecchi di MAX_AGE_MS
    if ((job.status === 'completed' || job.status === 'error') && 
        job.completedAt && 
        (now - job.completedAt > MAX_AGE_MS)) {
      activeJobs.delete(jobId);
      deletedCount++;
    }
    
    // Rimuovi job bloccati (timeout su processing)
    if (job.status === 'processing' && 
        job.processingStartedAt && 
        (now - job.processingStartedAt > 60000)) { // 1 minuto di timeout
      activeJobs.delete(jobId);
      deletedCount++;
    }
    
    // Rimuovi job troppo vecchi
    if (job.createdAt && (now - job.createdAt > 3600000)) { // 1 ora max vita
      activeJobs.delete(jobId);
      deletedCount++;
    }
  }
  
  if (deletedCount > 0) {
    logger.info(`Cleaned up ${deletedCount} completed/stuck jobs. Active jobs: ${activeJobs.size}`);
  }
}

// Esegui la pulizia ogni 5 minuti
const cleanupInterval = setInterval(cleanupCompletedJobs, 5 * 60 * 1000);

// Assicurati che l'interval sia terminato quando il processo termina
process.on('exit', () => {
  clearInterval(cleanupInterval);
});

module.exports = {
  startTopicDeduction,
  getTopicsForArticle,
  // Espone queste funzioni per i test
  _cleanupCompletedJobs: cleanupCompletedJobs,
  _getActiveJobsCount: () => activeJobs.size
};