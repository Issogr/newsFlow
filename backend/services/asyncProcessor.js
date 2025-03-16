/**
 * Servizio per l'elaborazione asincrona di attività in background
 * Implementa un sistema di code per evitare timeout nelle richieste HTTP
 */

const logger = require('../utils/logger');
const ollamaService = require('./ollamaService');
const topicNormalizer = require('./topicNormalizer');
const websocketService = require('./websocketService');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// Code di elaborazione
const topicDeductionQueue = [];
// Struttura dati per tenere traccia dei job in memoria
const activeJobs = new Map();
// Mappa di lookup per trovare rapidamente i topic per titolo di articolo
const titleToTopicsMap = new Map();
let isProcessing = false;

// File di cache per i topic
const TOPICS_CACHE_DIR = path.join(__dirname, '../data');
const TOPICS_CACHE_FILE = path.join(TOPICS_CACHE_DIR, 'topic-cache.json');

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
 * Assicura che la directory per la cache esista
 */
async function ensureDirectoryExists() {
  try {
    await fs.mkdir(TOPICS_CACHE_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      logger.error(`Error creating cache directory: ${err.message}`);
    }
  }
}

/**
 * Salva lo stato dei topic dedotti in un file
 */
async function saveTopicsToFile() {
  try {
    // Crea un oggetto con i topic per ogni articolo
    const topicsCache = {};
    
    activeJobs.forEach((job, id) => {
      if (job.status === 'completed' && job.result && job.result.length > 0) {
        // Salva sia per ID che per titolo dell'articolo per facilitare il matching successivo
        const articleTitle = job.article?.title || '';
        
        topicsCache[id] = {
          articleId: job.originalArticleId,
          title: articleTitle,
          topics: job.result,
          timestamp: job.completedAt || Date.now()
        };
      }
    });
    
    // Assicurati che la directory esista
    await ensureDirectoryExists();
    
    // Salva nel file
    await fs.writeFile(TOPICS_CACHE_FILE, JSON.stringify(topicsCache, null, 2));
    logger.info(`Cached ${Object.keys(topicsCache).length} topic entries to file`);
  } catch (error) {
    logger.error(`Error saving topics to file: ${error.message}`);
  }
}

/**
 * Carica lo stato dei topic dedotti da un file
 */
async function loadTopicsFromFile() {
  try {
    // Verifica se il file esiste
    await fs.access(TOPICS_CACHE_FILE);
    
    // Leggi e parsa il file
    const data = await fs.readFile(TOPICS_CACHE_FILE, 'utf8');
    const topicsCache = JSON.parse(data);
    
    // Ripristina i topic nella memoria
    let restoredCount = 0;
    
    Object.entries(topicsCache).forEach(([id, entry]) => {
      // Crea un job "completato" per ogni entry
      if (entry.topics && Array.isArray(entry.topics) && entry.topics.length > 0) {
        const articleTitle = entry.title || '';
        
        activeJobs.set(id, {
          id,
          originalArticleId: entry.articleId,
          article: { title: articleTitle },
          status: 'completed',
          result: entry.topics,
          completedAt: entry.timestamp
        });
        
        // Aggiungi anche alla mappa titolo->topics per trovare rapidamente per titolo
        if (articleTitle) {
          const normalizedTitle = normalizeTitle(articleTitle);
          titleToTopicsMap.set(normalizedTitle, entry.topics);
        }
        
        restoredCount++;
      }
    });
    
    logger.info(`Restored ${restoredCount} topic entries from cache file`);
    logger.info(`Created ${titleToTopicsMap.size} title-to-topics mappings for quick lookup`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info('No topics cache file found, starting with empty cache');
    } else {
      logger.error(`Error loading topics from file: ${error.message}`);
    }
  }
}

/**
 * Normalizza un titolo per il confronto
 * @param {string} title - Titolo da normalizzare
 * @returns {string} - Titolo normalizzato
 */
function normalizeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Rimuovi caratteri speciali
    .replace(/\s+/g, ' ')    // Riduci spazi multipli a singoli
    .trim();
}

// Carica i topic dal file all'avvio
(async () => {
  try {
    await loadTopicsFromFile();
  } catch (err) {
    logger.error(`Failed to load topics cache: ${err.message}`);
  }
})();

/**
 * Normalizza un ID articolo per garantire coerenza nel confronto
 * @param {string} id - ID dell'articolo da normalizzare
 * @returns {string} - ID normalizzato
 */
function normalizeArticleId(id) {
  if (!id) return '';
  
  // Rimuovi spazi e converti in lowercase per un confronto coerente
  return id.toString().trim().toLowerCase();
}

/**
 * Genera un hash unico per un articolo basato su titolo e URL
 * @param {Object} article - Oggetto articolo
 * @returns {string} - Hash unico
 */
function generateArticleHash(article) {
  if (!article || !article.title) return '';
  
  const data = article.title + (article.url || '') + (article.pubDate || '');
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Controlla se due ID articolo corrispondono usando un approccio migliorato
 * @param {string} id1 - Primo ID
 * @param {string} id2 - Secondo ID
 * @returns {boolean} - true se gli ID corrispondono
 */
function articleIdsMatch(id1, id2) {
  if (!id1 || !id2) return false;
  
  // Normalizzazione degli ID
  const normalizedId1 = normalizeArticleId(id1);
  const normalizedId2 = normalizeArticleId(id2);
  
  // Confronto esatto
  if (normalizedId1 === normalizedId2) return true;
  
  // Evita falsi positivi con stringhe troppo corte
  if (normalizedId1.length < 5 || normalizedId2.length < 5) {
    return false;
  }
  
  // Controllo se uno è contenuto nell'altro ma solo per ID abbastanza lunghi
  // e se la lunghezza dell'ID più corto è almeno il 70% di quello più lungo
  const longerLength = Math.max(normalizedId1.length, normalizedId2.length);
  const shorterLength = Math.min(normalizedId1.length, normalizedId2.length);
  
  if (shorterLength / longerLength >= 0.7) {
    return normalizedId1.includes(normalizedId2) || normalizedId2.includes(normalizedId1);
  }
  
  return false;
}

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
  
  // Normalizza l'ID
  const normalizedArticleId = normalizeArticleId(articleId);
  
  // Genera un hash univoco per l'articolo
  const articleHash = generateArticleHash(article);
  const jobId = articleHash || normalizedArticleId;
  
  // Debug dell'ID articolo
  logger.debug(`Starting topic deduction for article ID: "${jobId}" with title "${article.title}"`);
  
  // Se l'articolo ha già almeno 3 topic, non avviare un nuovo job
  if (article.topics && Array.isArray(article.topics) && article.topics.length >= 3) {
    return article.topics;
  }
  
  // NOVITÀ: Cerca topic anche per titolo
  const normalizedTitle = normalizeTitle(article.title);
  const topicsByTitle = titleToTopicsMap.get(normalizedTitle);
  
  if (topicsByTitle && topicsByTitle.length > 0) {
    logger.info(`Found topics by title match for "${article.title}": ${topicsByTitle.join(', ')}`);
    return topicsByTitle;
  }
  
  // Se c'è già un job in corso per questo articolo, restituisci i topic esistenti
  if (activeJobs.has(jobId) && activeJobs.get(jobId).status !== 'completed') {
    return article.topics || [];
  }
  
  // Limita il numero di job attivi per prevenire memory leak
  if (activeJobs.size >= MAX_ACTIVE_JOBS) {
    cleanupCompletedJobs(true); // Pulizia forzata
    
    // Se siamo ancora oltre il limite, non creare nuovi job
    if (activeJobs.size >= MAX_ACTIVE_JOBS) {
      logger.warn(`Too many active jobs (${activeJobs.size}/${MAX_ACTIVE_JOBS}), skipping topic deduction for ${jobId}`);
      return article.topics || [];
    }
  }
  
  // Cerca tra i job completati
  const existingJob = activeJobs.get(jobId);
  if (existingJob && existingJob.status === 'completed' && existingJob.result && existingJob.result.length > 0) {
    logger.info(`Using cached topics for article ${jobId}: ${existingJob.result.join(', ')}`);
    
    // Aggiorna anche la mappa per titolo
    if (normalizedTitle) {
      titleToTopicsMap.set(normalizedTitle, existingJob.result);
    }
    
    return existingJob.result;
  }
  
  // Debug dei topic attuali dell'articolo
  logger.debug(`Current topics for article ${jobId}: ${JSON.stringify(article.topics || [])}`);
  
  // Crea un nuovo job
  const job = {
    id: jobId,
    article: {
      id: article.id,
      title: article.title,
      description: article.description || '',
      language: language
    }, // Memorizza solo i campi necessari per dedurre i topic
    originalArticleId: articleId, // Memorizza l'ID originale non normalizzato
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
  activeJobs.set(jobId, job);
  
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
    
    // Debug dell'inizio elaborazione
    logger.info(`Processing topic deduction job for article ${job.id}`);
    
    // Esegui la deduzione dei topic con timeout di sicurezza
    const existingTopics = job.result || [];
    let deducedTopics = [];
    
    try {
      // Verifica se Ollama è disponibile
      const ollamaAvailable = ollamaService.isAvailable();
      
      if (ollamaAvailable) {
        // Imposta un timeout esplicito per la deduzione
        const deductionPromise = ollamaService.deduceTopics(job.article, job.language);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Topic deduction timeout')), 4000)
        );
        
        // Attendi il primo tra completamento e timeout
        deducedTopics = await Promise.race([deductionPromise, timeoutPromise]);
        logger.info(`Deduced topics via Ollama for article ${job.id}: ${JSON.stringify(deducedTopics)}`);
      } else {
        // Usa metodo statico se Ollama non è disponibile
        deducedTopics = deduceTopicsStatically(job.article);
        logger.info(`Deduced topics statically for article ${job.id}: ${JSON.stringify(deducedTopics)}`);
      }
    } catch (error) {
      logger.warn(`Topic deduction failed for article ${job.id}: ${error.message}`);
      
      // Fallback: usa il metodo statico se Ollama fallisce
      deducedTopics = deduceTopicsStatically(job.article);
      logger.info(`Deduced topics statically for article ${job.id}: ${JSON.stringify(deducedTopics)}`);
      
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
        combinedTopics.push(topic.charAt(0).toUpperCase() + topic.slice(1).toLowerCase());
      }
    });
    
    // Aggiorna lo stato del job con il risultato
    if (activeJobs.has(job.id)) {
      const updatedJob = activeJobs.get(job.id);
      updatedJob.status = 'completed';
      updatedJob.result = combinedTopics;
      updatedJob.completedAt = Date.now();
      activeJobs.set(job.id, updatedJob);
      
      // Aggiorna anche la mappa titolo->topics
      if (job.article && job.article.title) {
        const normalizedTitle = normalizeTitle(job.article.title);
        titleToTopicsMap.set(normalizedTitle, combinedTopics);
      }
      
      // Salva i topic nel file (con throttling per evitare troppe scritture)
      if (Math.random() < 0.1) { // 10% di probabilità di salvare ad ogni aggiornamento
        saveTopicsToFile().catch(err => {
          logger.error(`Failed to save topics cache: ${err.message}`);
        });
      }
    }
    
    // Aggiorna l'articolo originale e notifica i client tramite WebSocket
    updateArticleTopics(job.originalArticleId, combinedTopics);
    
    // Notifica i client tramite WebSocket solo se ci sono nuovi topic dedotti
    if (combinedTopics.length > existingTopics.length && combinedTopics.length > 0) {
      try {
        // Debug pre-invio WebSocket
        logger.info(`Broadcasting topics for article ${job.originalArticleId}: ${JSON.stringify(combinedTopics)}`);
        
        // Invia aggiornamento tramite WebSocket
        websocketService.broadcastTopicUpdate(job.originalArticleId, combinedTopics);
      } catch (wsError) {
        logger.error(`Error broadcasting topic update: ${wsError.message}`, wsError);
      }
    }
    
    logger.info(`Successfully deduced topics for article ${job.id}: ${combinedTopics.join(', ')}`);
  } catch (error) {
    logger.error(`Error processing job ${job.id}: ${error.message}`, error);
    
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
  // Registra l'aggiornamento
  logger.info(`Topics updated for article ${articleId}: ${topics.join(', ')}`);
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
 * @param {Object} [article] - Articolo completo (opzionale)
 * @returns {string[]} - Topic dedotti o vuoto se il job non esiste
 */
function getTopicsForArticle(articleId, article = null) {
  if (!articleId && !article) return [];
  
  // Nuova logica: se abbiamo l'oggetto articolo completo, proviamo anche il match per titolo
  if (article && article.title) {
    const normalizedTitle = normalizeTitle(article.title);
    const topicsByTitle = titleToTopicsMap.get(normalizedTitle);
    
    if (topicsByTitle && topicsByTitle.length > 0) {
      logger.debug(`Found topics by title for "${article.title}": ${topicsByTitle.join(', ')}`);
      return topicsByTitle;
    }
  }
  
  // Logica originale per ID articolo
  if (articleId) {
    // Normalizza l'ID per la ricerca
    const normalizedId = normalizeArticleId(articleId);
    
    // Cerca per corrispondenza esatta
    if (activeJobs.has(normalizedId)) {
      return activeJobs.get(normalizedId).result || [];
    }
    
    // Cerca per corrispondenza flessibile
    for (const [jobId, job] of activeJobs.entries()) {
      if (articleIdsMatch(normalizedId, jobId) || 
          articleIdsMatch(normalizedId, job.originalArticleId)) {
        return job.result || [];
      }
    }
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

// Pianifica la pulizia periodica dei job completati
// Esegui la pulizia ogni 5 minuti
const cleanupInterval = setInterval(cleanupCompletedJobs, 5 * 60 * 1000);

// Pianifica il salvataggio periodico dei topic su file
const saveInterval = setInterval(saveTopicsToFile, 10 * 60 * 1000); // Ogni 10 minuti

// Assicurati che gli interval siano terminati quando il processo termina
process.on('exit', () => {
  clearInterval(cleanupInterval);
  clearInterval(saveInterval);
  
  // Salva i topic prima di terminare
  saveTopicsToFile().catch(() => {});
});

module.exports = {
  startTopicDeduction,
  getTopicsForArticle,
  // Espone queste funzioni per i test
  _cleanupCompletedJobs: cleanupCompletedJobs,
  _getActiveJobsCount: () => activeJobs.size,
  // Esposta per scopi di ricerca
  deduceTopicsStatically,
  // Espone la funzione di normalizzazione ID per uso in altri moduli
  articleIdsMatch,
  normalizeArticleId
};