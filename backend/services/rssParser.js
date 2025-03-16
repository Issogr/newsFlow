const RSSParser = require('rss-parser');
const axios = require('axios');
const logger = require('../utils/logger');
const ollamaService = require('./ollamaService');
const topicNormalizer = require('./topicNormalizer');
const asyncProcessor = require('./asyncProcessor');
const { sanitizeHtml } = require('../utils/inputValidator');

// Configurazione dal environment
const MAX_ARTICLES_PER_SOURCE = parseInt(process.env.MAX_ARTICLES_PER_SOURCE || '10', 10);
const RSS_MAX_RETRIES = parseInt(process.env.RSS_MAX_RETRIES || '5', 10);
const RSS_RETRY_DELAY = parseInt(process.env.RSS_RETRY_DELAY || '2000', 10);
const RSS_TIMEOUT = parseInt(process.env.RSS_TIMEOUT || '15000', 10);

// Configurazione avanzata del parser RSS
const parser = new RSSParser({
  customFields: {
    item: [
      ['media:content', 'media'],
      ['media:thumbnail', 'thumbnail'],
      ['dc:creator', 'creator'],
      ['dc:date', 'dcdate'],
      ['content:encoded', 'contentEncoded']
    ],
    feedUrl: 'feedUrl',
    lastBuildDate: 'lastBuildDate'
  },
  timeout: RSS_TIMEOUT,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36'
  }
});

// Cache delle risposte recenti per evitare richieste ripetute
const responseCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minuto

/**
 * Gestisce una fonte di feed RSS non disponibile
 * @param {Object} source - Configurazione della fonte
 * @param {Error} error - Errore rilevato
 */
function handleSourceFailure(source, error) {
  logger.error(`Failed to fetch RSS from ${source.name} (${source.url}): ${error.message}`);
  
  // Inserisci nella cache un errore per evitare tentativi ripetuti troppo frequenti
  responseCache.set(source.url, {
    error: true,
    timestamp: Date.now(),
    message: error.message
  });
}

/**
 * Converte dati in formato binario (ArrayBuffer) in stringa
 * @param {ArrayBuffer} data - Dati binari da convertire
 * @param {string} contentType - Content-Type della risposta
 * @returns {string} - Stringa convertita
 */
function convertBinaryToString(data, contentType) {
  // Determina l'encoding basandosi sul content-type
  let encoding = 'utf-8'; // Default encoding
  
  // Cerca l'encoding nel content-type
  if (contentType && contentType.includes('charset=')) {
    const charsetMatch = contentType.match(/charset=([^;]+)/i);
    if (charsetMatch && charsetMatch[1]) {
      encoding = charsetMatch[1].trim();
    }
  }
  
  try {
    // Usa TextDecoder per convertire il buffer
    return new TextDecoder(encoding).decode(data);
  } catch (error) {
    // Fallback a utf-8 se encoding specifico fallisce
    logger.warn(`Failed to decode with encoding ${encoding}, falling back to utf-8: ${error.message}`);
    return new TextDecoder('utf-8').decode(data);
  }
}

/**
 * Esegue una richiesta HTTP con retry in caso di errore
 * Implementa una logica di retry migliorata con backoff exponenziale
 * E gestisce automaticamente sia risposte testuali che binarie
 * 
 * @param {string} url - URL da recuperare
 * @param {Object} options - Opzioni axios
 * @returns {Promise<Object>} - Promise con la risposta
 */
async function fetchWithRetry(url, options) {
  // Verifica se abbiamo una risposta in cache valida
  const cachedResponse = responseCache.get(url);
  if (cachedResponse && (Date.now() - cachedResponse.timestamp) < CACHE_TTL) {
    if (cachedResponse.error) {
      throw new Error(`Cached error: ${cachedResponse.message}`);
    }
    logger.debug(`Using cached response for ${url}`);
    return { data: cachedResponse.data };
  }
  
  let lastError;
  let retryCount = 0;
  let retryDelay = RSS_RETRY_DELAY;
  
  while (retryCount < RSS_MAX_RETRIES) {
    try {
      // Usa sempre arraybuffer come responseType per poter gestire qualsiasi tipo di risposta
      const axiosOptions = {
        ...options,
        timeout: RSS_TIMEOUT,
        responseType: 'arraybuffer'
      };
      
      const response = await axios.get(url, axiosOptions);
      
      // Ottieni il content-type dalla risposta
      const contentType = response.headers['content-type'] || '';
      let responseData;
      
      // Determina se è una risposta binaria o testuale in base al content-type
      if (contentType.includes('xml') || contentType.includes('text/') || contentType.includes('application/json')) {
        // Converti l'arraybuffer in stringa per i formati testuali
        responseData = convertBinaryToString(response.data, contentType);
      } else {
        // Per altri formati, prova comunque a convertire in testo
        // perché a volte i content-type sono incorretti
        logger.info(`Unexpected content-type (${contentType}) for ${url}, attempting to convert to text`);
        try {
          responseData = convertBinaryToString(response.data, contentType);
          // Verifica se l'output sembra XML
          if (!responseData.includes('<')) {
            logger.warn(`Converted data doesn't look like XML for ${url}`);
          }
        } catch (conversionError) {
          logger.error(`Failed to convert response to string: ${conversionError.message}`);
          throw new Error(`Unsupported content type: ${contentType}`);
        }
      }
      
      // Cache la risposta valida
      responseCache.set(url, {
        data: responseData,
        timestamp: Date.now(),
        error: false
      });
      
      return { data: responseData };
    } catch (error) {
      lastError = error;
      retryCount++;
      
      // Determina se rifare la richiesta
      const shouldRetry = retryCount < RSS_MAX_RETRIES && (
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNABORTED' ||
        (error.response && (error.response.status >= 500 || error.response.status === 429))
      );
      
      if (!shouldRetry) break;
      
      // Calcola il tempo di attesa con exponential backoff e jitter
      retryDelay = Math.min(
        RSS_RETRY_DELAY * Math.pow(2, retryCount - 1) + Math.random() * 1000,
        30000 // Max 30 secondi
      );
      
      logger.warn(`Retry ${retryCount}/${RSS_MAX_RETRIES} for ${url} after ${Math.round(retryDelay)}ms - Error: ${error.message}`);
      
      // Attendi prima del prossimo tentativo
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  // Cache l'errore per evitare tentativi ripetuti troppo frequenti
  responseCache.set(url, {
    error: true,
    timestamp: Date.now(),
    message: lastError.message
  });
  
  // Se arriviamo qui, abbiamo esaurito i tentativi
  throw lastError;
}

/**
 * Funzione per recuperare e parsare un feed RSS
 * @param {Object} source - Configurazione della fonte
 * @returns {Promise<Array>} - Array di articoli parsati
 */
async function parseFeed(source) {
  try {
    const url = source.url || '';
    
    // Log dell'inizio del fetch del feed
    logger.info(`Fetching feed from ${source.name} ${source.subId ? '(' + source.subId + ')' : ''} - ${url}`);
    
    // Imposta opzioni avanzate con retry
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      validateStatus: status => status < 500, // Accetta anche risposte 3xx e 4xx
    };
    
    // Fetch con retry
    const response = await fetchWithRetry(url, options);
    
    // Verifica se la risposta contiene dati validi
    if (!response.data) {
      throw new Error('Empty response');
    }
    
    logger.info(`Successfully fetched feed from ${source.name}, parsing...`);
    
    // Parsing dell'XML con gestione errori
    let feed;
    try {
      feed = await parser.parseString(response.data);
    } catch (parseError) {
      logger.error(`Error parsing XML from ${source.name}: ${parseError.message}`);
      throw new Error(`Invalid RSS format: ${parseError.message}`);
    }
    
    // Validazione del feed
    if (!feed || !feed.items || !Array.isArray(feed.items)) {
      throw new Error('Invalid feed format: missing or invalid items');
    }
    
    logger.info(`Parsed feed from ${source.name}, found ${feed.items.length} items`);
    
    // Estrai solo gli articoli più recenti usando la variabile d'ambiente MAX_ARTICLES_PER_SOURCE
    const recentItems = feed.items.slice(0, MAX_ARTICLES_PER_SOURCE);
    
    logger.info(`Processing ${recentItems.length} recent items from ${source.name} (limit set to ${MAX_ARTICLES_PER_SOURCE})`);
    
    // Map feed items to standardized format
    const parsedItems = await Promise.all(recentItems.map(async item => {
      // Validazione dell'item
      if (!item.title) {
        logger.warn(`Skipping item from ${source.name} with missing title`);
        return null;
      }
      
      // Assegna un ID univoco e stabile
      const sourceId = source.subId || source.id; // Usa subId per feed multipli se disponibile
      const itemId = item.guid || item.id || 
        `${sourceId}-${Buffer.from(item.title).toString('base64').substring(0, 20)}-${(item.pubDate || new Date().toISOString()).substring(0, 10)}`;
      
      // Estrai il contenuto più completo disponibile
      let content = '';
      if (item.contentEncoded) {
        content = sanitizeHtml(item.contentEncoded);
      } else if (item.content) {
        content = sanitizeHtml(item.content);
      } else if (item['content:encoded']) {
        content = sanitizeHtml(item['content:encoded']);
      }
      
      // Costruisci l'articolo base
      const article = {
        id: itemId,
        title: item.title.trim(),
        description: item.description ? sanitizeHtml(item.description.trim()) : '',
        content: content,
        pubDate: item.pubDate || item.dcdate || item.isoDate || new Date().toISOString(),
        source: source.name,
        sourceId: sourceId,
        url: item.link || '',
        image: getImageUrl(item),
        author: item.creator || item.author || null,
        language: source.language
      };
      
      // Normalizza la data se necessario
      if (!(article.pubDate instanceof Date) && typeof article.pubDate === 'string') {
        try {
          article.pubDate = new Date(article.pubDate).toISOString();
        } catch (e) {
          article.pubDate = new Date().toISOString();
        }
      }
      
      // MIGLIORATO: Prima controlla se ci sono topic già dedotti in precedenza
      // usando sia ID che titolo per il matching
      let existingTopics = asyncProcessor.getTopicsForArticle(article.id, article);
      
      if (existingTopics && existingTopics.length > 0) {
        article.topics = existingTopics;
        logger.debug(`Using existing topics for "${article.title}": ${existingTopics.join(', ')}`);
      } else {
        // Se non ci sono topic esistenti, estrai i topic dai metadati dell'articolo
        article.topics = await extractInitialTopics(item, article, source.language);
        
        // Avvia l'elaborazione asincrona per la deduzione dei topic mancanti
        if (article.topics.length < 2) {
          asyncProcessor.startTopicDeduction(article.id, article, source.language);
        }
      }
      
      return article;
    }));
    
    // Filtra item nulli e con campi obbligatori mancanti
    return parsedItems.filter(item => item !== null && item.title);
  } catch (error) {
    handleSourceFailure(source, error);
    return []; // Return empty array in case of error
  }
}

/**
 * Estrae l'URL dell'immagine dall'item RSS
 * @param {Object} item - Item RSS
 * @returns {string|null} - URL dell'immagine o null
 */
function getImageUrl(item) {
  if (!item) return null;
  
  try {
    // Estrai da media:content
    if (item.media && item.media.$ && item.media.$.url) {
      return item.media.$.url;
    }
    
    // Estrai da media:thumbnail
    if (item.thumbnail && item.thumbnail.$ && item.thumbnail.$.url) {
      return item.thumbnail.$.url;
    }
    
    // Estrai da enclosure
    if (item.enclosure && item.enclosure.url) {
      return item.enclosure.url;
    }
    
    // Estrai da content HTML
    const contentToSearch = item.content || item['content:encoded'] || item.contentEncoded || item.description || '';
    
    if (typeof contentToSearch === 'string') {
      // Espressione regolare migliorata per estrarre URL immagini
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/i;
      const match = contentToSearch.match(imgRegex);
      if (match && match[1]) {
        // Filtra URL relativi o non validi
        if (match[1].startsWith('http')) {
          return match[1];
        }
      }
    }
  } catch (err) {
    logger.error(`Error extracting image URL: ${err.message}`);
  }
  
  return null;
}

/**
 * Estrae i topic iniziali da un item RSS
 * @param {Object} item - Item RSS
 * @param {Object} article - Articolo normalizzato
 * @param {string} language - Lingua dell'articolo
 * @returns {Promise<Array>} - Array di topic
 */
async function extractInitialTopics(item, article, language = 'it') {
  if (!item) return [];
  
  // Raccoglie i topic grezzi dai metadati dell'articolo
  const rawTopics = [];
  
  try {
    // Estrai dai tag o categorie dell'articolo se disponibili
    if (item.categories && Array.isArray(item.categories)) {
      rawTopics.push(...item.categories.filter(cat => typeof cat === 'string' && cat.trim().length > 0));
    }
  } catch (err) {
    logger.error(`Error extracting raw topics: ${err.message}`);
  }
  
  // Se non ci sono topic grezzi, restituisci un array vuoto
  // La deduzione completa avverrà in modo asincrono
  if (rawTopics.length === 0) {
    return [];
  }
  
  // Normalizza i topic esistenti rapidamente - versione migliorata
  // Questa parte è sincrona e rapida per evitare timeout
  let normalizedTopics = [];
  
  // Prima verifica se Ollama è disponibile e ci sono pochi topic da normalizzare
  if (ollamaService.isAvailable() && rawTopics.length <= 3) {
    try {
      // Imposta un timeout molto breve per la normalizzazione
      const normalizationPromises = rawTopics.map(topic => {
        // Promise.race tra la normalizzazione e un timeout
        return Promise.race([
          ollamaService.normalizeTopic(topic, language),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Normalization timeout')), 800))
        ]).catch(err => {
          // In caso di errore usa il normalizzatore statico come fallback
          logger.debug(`Fallback to static normalizer for topic "${topic}": ${err.message}`);
          return topicNormalizer.normalizeTopic(topic);
        });
      });
      
      // Attendi la normalizzazione con timeout
      normalizedTopics = await Promise.all(normalizationPromises);
    } catch (err) {
      // In caso di errore generale, usa il normalizzatore statico
      logger.warn(`Error in Ollama topic normalization, using static: ${err.message}`);
      normalizedTopics = rawTopics.map(topic => topicNormalizer.normalizeTopic(topic));
    }
  } else {
    // Usa direttamente il normalizzatore statico
    normalizedTopics = rawTopics.map(topic => topicNormalizer.normalizeTopic(topic));
  }
  
  // Rimuovi i duplicati e gli elementi nulli/vuoti
  return [...new Set(normalizedTopics)]
    .filter(topic => topic && typeof topic === 'string' && topic.length > 0);
}

// Pulizia periodica della cache
setInterval(() => {
  const now = Date.now();
  let expiredCount = 0;
  
  responseCache.forEach((value, key) => {
    if (now - value.timestamp > CACHE_TTL) {
      responseCache.delete(key);
      expiredCount++;
    }
  });
  
  if (expiredCount > 0) {
    logger.debug(`Cleaned up ${expiredCount} expired RSS cache entries`);
  }
}, 5 * 60 * 1000); // Ogni 5 minuti

module.exports = { parseFeed };