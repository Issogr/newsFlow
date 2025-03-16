const RSSParser = require('rss-parser');
const axios = require('axios');
const logger = require('../utils/logger');
const ollamaService = require('./ollamaService');
const topicNormalizer = require('./topicNormalizer');
const asyncProcessor = require('./asyncProcessor');
const { createError } = require('../utils/errorHandler');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

// Configurazione dal environment
const MAX_ARTICLES_PER_SOURCE = parseInt(process.env.MAX_ARTICLES_PER_SOURCE || '10', 10);
const MAX_RETRIES = parseInt(process.env.RSS_MAX_RETRIES || '3', 10);
const INITIAL_RETRY_DELAY = parseInt(process.env.RSS_RETRY_DELAY || '1000', 10);
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB limite per risposte RSS

// Setup DOMPurify per sanitizzazione HTML
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Configurazione parser RSS
const parser = new RSSParser({
  customFields: {
    item: [
      ['media:content', 'media'],
      ['media:thumbnail', 'thumbnail'],
      ['dc:creator', 'creator'],
      ['dc:date', 'dcdate']
    ]
  },
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  }
});

/**
 * Funzione per effettuare richieste HTTP con retry e backoff esponenziale
 * @param {string} url - URL da richiedere
 * @param {Object} options - Opzioni axios
 * @param {number} retries - Numero di tentativi rimasti
 * @param {number} delay - Ritardo iniziale in ms
 * @returns {Promise<Object>} - Risposta axios
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES, delay = INITIAL_RETRY_DELAY) {
  try {
    return await axios.get(url, options);
  } catch (error) {
    // Migliora il logging per errori DNS
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      logger.error(`DNS resolution failed for ${url}: ${error.code}`, { 
        errorCode: error.code,
        hostname: new URL(url).hostname
      });
      
      // Se è l'ultimo tentativo, aggiungi suggerimenti utili
      if (retries <= 1) {
        logger.error(`Persistent DNS failure for ${url}. Possible issues:
          1. Check if domain is valid and accessible from outside Docker
          2. Verify DNS configuration in docker-compose.yml
          3. Try using IP address if possible
          4. Consider adding custom DNS servers to the container`);
      }
    }
    
    if (retries <= 0) {
      logger.error(`Fetch failed after ${MAX_RETRIES} retries: ${url}`, { 
        error: error.message,
        code: error.code || 'UNKNOWN'
      });
      throw error;
    }
    
    // Calcola un jitter casuale da 0 a 500ms
    const jitter = Math.floor(Math.random() * 500);
    const nextDelay = delay + jitter;
    
    logger.warn(`Fetch retry (${MAX_RETRIES - retries + 1}/${MAX_RETRIES}) for ${url} in ${nextDelay}ms: ${error.message}`);
    
    // Attendi con backoff esponenziale + jitter
    await new Promise(resolve => setTimeout(resolve, nextDelay));
    
    // Riprova con delay raddoppiato
    return fetchWithRetry(url, options, retries - 1, delay * 2);
  }
}

/**
 * Sanifica l'HTML rimuovendo tutti i tag
 * @param {string} html - Input HTML
 * @returns {string} - Testo pulito
 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  
  // Usa DOMPurify per rimuovere in modo sicuro tutti i tag HTML
  return DOMPurify.sanitize(html, { 
    ALLOWED_TAGS: [], // Non permettere nessun tag HTML
    ALLOWED_ATTR: [], // Non permettere nessun attributo
    KEEP_CONTENT: true // Mantieni il contenuto dei tag
  }).trim();
}

/**
 * Function to fetch and parse an RSS feed with retry
 * @param {Object} source - Informazioni sulla fonte
 * @returns {Promise<Array>} - Array di articoli
 */
async function parseFeed(source) {
  try {
    logger.info(`Fetching feed from ${source.name} (${source.url})`);
    
    // Opzioni per la richiesta HTTP
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      timeout: 15000, // 15 seconds timeout
      validateStatus: status => status < 500 // Accetta anche risposte 3xx e 4xx
    };
    
    // Richiesta con retry
    const response = await fetchWithRetry(source.url, options);
    
    // Verifica se la risposta contiene dati validi
    if (!response.data) {
      throw new Error('Empty response');
    }
    
    // Verifica la dimensione della risposta per prevenire errori di memoria
    const responseSize = typeof response.data === 'string' ? response.data.length : 
                         JSON.stringify(response.data).length;
    
    if (responseSize > MAX_RESPONSE_SIZE) {
      logger.warn(`RSS feed from ${source.name} is too large (${Math.round(responseSize/1024/1024)}MB), truncating to prevent memory issues`);
      // Tronca la risposta per evitare errori di memoria
      if (typeof response.data === 'string') {
        response.data = response.data.substring(0, MAX_RESPONSE_SIZE);
      } else {
        // Se non è una stringa, converti e tronca
        response.data = JSON.stringify(response.data).substring(0, MAX_RESPONSE_SIZE);
      }
    }
    
    // Tentativo di valutare se il contenuto è effettivamente XML
    if (typeof response.data === 'string' && !response.data.trim().startsWith('<')) {
      logger.error(`Response from ${source.name} doesn't appear to be XML: ${response.data.substring(0, 100)}...`);
      throw new Error('Invalid XML format');
    }
    
    logger.info(`Successfully fetched feed from ${source.name}, parsing...`);
    
    // Parsing dell'XML
    const feed = await parser.parseString(response.data);
    
    if (!feed || !feed.items || !Array.isArray(feed.items)) {
      throw new Error('Invalid feed format');
    }
    
    logger.info(`Parsed feed from ${source.name}, found ${feed.items.length} items`);
    
    // Estrai solo gli articoli più recenti usando la variabile d'ambiente MAX_ARTICLES_PER_SOURCE
    const recentItems = feed.items.slice(0, MAX_ARTICLES_PER_SOURCE);
    
    logger.info(`Processing ${recentItems.length} recent items from ${source.name} (limit set to ${MAX_ARTICLES_PER_SOURCE})`);
    
    // Map feed items to standardized format
    const parsedItems = await Promise.all(recentItems.map(async item => {
      try {
        // Validazione dei campi obbligatori
        if (!item.title) {
          logger.warn(`Item without title found in ${source.name}, skipping`);
          return null;
        }
        
        // Costruisci l'articolo base
        const article = {
          id: item.guid || item.id || `${source.id}-${item.link}`,
          title: item.title || 'No title',
          description: item.description ? stripHtml(item.description) : '',
          content: item.content ? stripHtml(item.content) : (item['content:encoded'] ? stripHtml(item['content:encoded']) : ''),
          pubDate: item.pubDate || item.dcdate || item.isoDate || new Date().toISOString(),
          source: source.name,
          sourceId: source.id,
          url: item.link || '',
          image: getImageUrl(item)
        };
        
        // Estrai i topic esistenti immediatamente (il resto sarà elaborato in modo asincrono)
        article.topics = await extractInitialTopics(item, article, source.language);
        
        // Avvia l'elaborazione asincrona per la deduzione dei topic mancanti
        asyncProcessor.startTopicDeduction(article.id, article, source.language);
        
        return article;
      } catch (itemError) {
        logger.error(`Error processing item from ${source.name}: ${itemError.message}`);
        return null;
      }
    }));
    
    // Filtra eventuali null (articoli invalidi)
    return parsedItems.filter(item => item !== null);
  } catch (error) {
    logger.error(`Error parsing feed from ${source.name} (${source.url}): ${error.message}`, { 
      stack: error.stack,
      source: source.id
    });
    return []; // Return empty array in case of error
  }
}

function getImageUrl(item) {
  if (!item) return null;
  
  try {
    if (item.media && item.media.$ && item.media.$.url) {
      return item.media.$.url;
    }
    if (item.thumbnail && item.thumbnail.$ && item.thumbnail.$.url) {
      return item.thumbnail.$.url;
    }
    if (item.enclosure && item.enclosure.url) {
      return item.enclosure.url;
    }
    
    // Try to extract image from content
    const contentToSearch = item.content || item['content:encoded'] || item.description || '';
    
    if (typeof contentToSearch === 'string') {
      const imgRegex = /<img.*?src=["'](.*?)["']/;
      const match = contentToSearch.match(imgRegex);
      return match ? match[1] : null;
    }
  } catch (err) {
    logger.error(`Error extracting image URL: ${err.message}`);
  }
  
  return null;
}

async function extractInitialTopics(item, article, language = 'it') {
  if (!item) return [];
  
  // Raccoglie i topic grezzi dai metadati dell'articolo
  const rawTopics = [];
  
  try {
    // Estrai dai tag o categorie dell'articolo se disponibili
    if (item.categories && Array.isArray(item.categories)) {
      rawTopics.push(...item.categories.filter(cat => typeof cat === 'string'));
    }
  } catch (err) {
    logger.error(`Error extracting raw topics: ${err.message}`);
  }
  
  // Se non ci sono topic grezzi, restituisci un array vuoto
  // La deduzione completa avverrà in modo asincrono
  if (rawTopics.length === 0) {
    return [];
  }
  
  // Normalizza i topic esistenti rapidamente
  // Questa parte è sincrona e rapida per evitare timeout
  let normalizedTopics;
  
  // Se Ollama è disponibile e ci sono pochi topic, normalizza con Ollama
  if (ollamaService.isAvailable() && rawTopics.length <= 2) {
    try {
      // Imposta un timeout molto breve per la normalizzazione
      const normalizationPromises = rawTopics.map(topic => {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Normalization timeout')), 500)
        );
        return Promise.race([ollamaService.normalizeTopic(topic, 'it'), timeoutPromise]);
      });
      
      // Attendi la normalizzazione con timeout
      normalizedTopics = await Promise.all(normalizationPromises);
    } catch (err) {
      // In caso di timeout o errore, usa il normalizzatore statico
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

module.exports = { parseFeed };