const rssParser = require('./rssParser');
const logger = require('../utils/logger');
const topicNormalizer = require('./topicNormalizer');
const { sanitizeHtml } = require('../utils/inputValidator');
const { createError } = require('../utils/errorHandler');
const websocketService = require('./websocketService');
const asyncProcessor = require('./asyncProcessor');

// News sources configuration
const newsSources = [
  { id: 'repubblica', name: 'La Repubblica', url: 'https://www.repubblica.it/rss/homepage/rss2.0.xml', type: 'rss', language: 'it' },
  { id: 'ansa', name: 'ANSA', url: 'https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml', type: 'rss', language: 'it' },
  { 
    id: 'sole24ore', 
    name: 'Il Sole 24 Ore', 
    urls: [
      'https://www.ilsole24ore.com/rss/italia.xml',
      'https://www.ilsole24ore.com/rss/mondo.xml',
      'https://www.ilsole24ore.com/rss/finanza.xml',
      'https://www.ilsole24ore.com/rss/economia.xml'
    ], 
    type: 'multi-rss', 
    language: 'it' 
  },
  { id: 'ivgsavona', name: 'IVG Savona', url: 'https://www.ivg.it/?feed=news-news24', type: 'rss', language: 'it' },
  { id: 'bbc', name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', type: 'rss', language: 'en' },
  { id: 'nytimes', name: 'New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', type: 'rss', language: 'en' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', type: 'rss', language: 'en' },
  { id: 'lemonde', name: 'Le Monde', url: 'https://www.lemonde.fr/rss/une.xml', type: 'rss', language: 'fr' }
];

// Limit della memoria cache (numero massimo di articoli da mantenere)
const MAX_CACHED_ARTICLES = 1000;

// Cache degli articoli (limitata)
let articlesCache = [];

// Timestamp dell'ultimo aggiornamento
let lastUpdateTime = 0;

// Intervallo di aggiornamento minimo per evitare aggiornamenti troppo frequenti
const MIN_UPDATE_INTERVAL = parseInt(process.env.MIN_UPDATE_INTERVAL || '60000', 10); // 1 minuto

/**
 * Pulisce la cache degli articoli se supera il limite
 */
function cleanupArticlesCache() {
  if (articlesCache.length > MAX_CACHED_ARTICLES) {
    // Ordina per data e tieni solo i più recenti
    articlesCache.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    articlesCache = articlesCache.slice(0, Math.floor(MAX_CACHED_ARTICLES * 0.8)); // Riduci all'80% per evitare pulizie troppo frequenti
    logger.info(`Cache articoli ridotta a ${articlesCache.length} elementi`);
  }
}

/**
 * Verifica se ci sono nuovi articoli da notificare
 * @param {Array} newItems - Nuovi articoli
 * @param {Array} existingItems - Articoli esistenti nella cache
 * @returns {Array} - Array dei nuovi articoli non presenti nella cache
 */
function findNewArticles(newItems, existingItems) {
  if (!newItems || !Array.isArray(newItems) || newItems.length === 0) {
    return [];
  }
  
  if (!existingItems || !Array.isArray(existingItems) || existingItems.length === 0) {
    return newItems;
  }
  
  // Crea un set di ID degli articoli esistenti per ricerca efficiente
  const existingIds = new Set(existingItems.map(item => item.id));
  
  // Filtra solo gli articoli nuovi
  return newItems.filter(item => !existingIds.has(item.id));
}

// Function to fetch all news from all sources
async function fetchAllNews() {
  try {
    // Check if we need to respect the minimum update interval
    const now = Date.now();
    if (lastUpdateTime > 0 && now - lastUpdateTime < MIN_UPDATE_INTERVAL) {
      // Se l'ultimo aggiornamento è troppo recente e abbiamo articoli in cache, usa la cache
      if (articlesCache.length > 0) {
        logger.debug(`Usando cache (${articlesCache.length} articoli) - Prossimo aggiornamento tra ${Math.round((MIN_UPDATE_INTERVAL - (now - lastUpdateTime)) / 1000)}s`);
        return groupSimilarNews(articlesCache);
      }
    }
    
    // Prepara le promesse per tutti i feed
    const newsPromises = [];
    
    // Elabora tutte le fonti
    for (const source of newsSources) {
      if (source.type === 'multi-rss' && Array.isArray(source.urls)) {
        // Per fonti con molteplici URL, crea un promise per ogni URL
        for (const url of source.urls) {
          const subSourceConfig = { 
            ...source, 
            url, 
            type: 'rss', 
            // Crea un subId per distinguere gli articoli dalle diverse sottofont
            subId: `${source.id}-${url.split('/').pop().replace('.xml', '')}` 
          };
          newsPromises.push(rssParser.parseFeed(subSourceConfig));
        }
      } else {
        // Per fonti normali, crea un singolo promise
        newsPromises.push(rssParser.parseFeed(source));
      }
    }
    
    // Attendi il completamento di tutte le richieste
    const newsArrays = await Promise.allSettled(newsPromises);
    
    // Log dei risultati
    const successCount = newsArrays.filter(result => result.status === 'fulfilled').length;
    const failCount = newsArrays.length - successCount;
    
    if (failCount > 0) {
      logger.warn(`${failCount}/${newsArrays.length} fonti non hanno risposto correttamente`);
    }
    
    // Elabora i risultati (sia successi che fallimenti)
    const allNewsItems = newsArrays
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value);
    
    // Se non abbiamo notizie, lancia un errore
    if (allNewsItems.length === 0) {
      throw new Error('CONNECTION_ERROR');
    }
    
    // Sanitizzazione preventiva dei contenuti HTML
    const sanitizedItems = allNewsItems.map(item => ({
      ...item,
      description: sanitizeHtml(item.description || ''),
      content: sanitizeHtml(item.content || '')
    }));
    
    // MIGLIORATO: Arricchisci gli articoli con i topic dedotti in modo asincrono
    // Passa l'articolo completo per un matching più efficace
    for (const item of sanitizedItems) {
      // Recupera topic sia per ID che per titolo
      const deducedTopics = asyncProcessor.getTopicsForArticle(item.id, item);
      
      if (deducedTopics && deducedTopics.length > 0) {
        // Combina i topic esistenti con quelli dedotti
        const existingTopics = Array.isArray(item.topics) ? item.topics : [];
        const allTopics = [...new Set([...existingTopics, ...deducedTopics])];
        item.topics = allTopics;
        logger.debug(`Enriched article ${item.id} with topics: ${deducedTopics.join(', ')}`);
      } else {
        // Se non abbiamo topic in cache, avvia la deduzione asincrona
        asyncProcessor.startTopicDeduction(item.id, item, item.language || 'it');
      }
    }
    
    // Verifica se ci sono nuovi articoli rispetto alla cache
    const newArticles = findNewArticles(sanitizedItems, articlesCache);
    
    // Se ci sono nuovi articoli, notifica via WebSocket
    if (newArticles.length > 0) {
      logger.info(`Trovati ${newArticles.length} nuovi articoli da notificare`);
      const newGroups = groupSimilarNews(newArticles);
      
      // Invia solo se ci sono gruppi interessanti
      if (newGroups.length > 0) {
        try {
          // Invia via WebSocket solo se non è il primo caricamento
          if (articlesCache.length > 0) {
            websocketService.broadcastNewsUpdate(newGroups);
          }
        } catch (wsError) {
          logger.error(`Errore nell'invio dell'aggiornamento WebSocket: ${wsError.message}`);
        }
      }
    }
    
    // Aggiorna la cache degli articoli
    articlesCache = [...sanitizedItems];
    lastUpdateTime = now;
    
    // Pulisci cache se necessario
    cleanupArticlesCache();
    
    // Group similar news
    const groupedNews = groupSimilarNews(sanitizedItems);
    
    return groupedNews;
  } catch (error) {
    logger.error(`Error fetching all news: ${error.message}`);
    
    // Se c'è un errore specifico di connessione, propagalo
    if (error.message === 'CONNECTION_ERROR') {
      throw createError(503, 'Impossibile connettersi ai feed di notizie. Per favore riprova più tardi.', 'CONNECTION_ERROR');
    }
    
    // Altri tipi di errore
    throw createError(500, 'Si è verificato un errore nel recupero delle notizie.', 'SERVER_ERROR', error);
  }
}

// Function to search in all news
async function searchNews(query) {
  try {
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      throw createError(400, 'Termine di ricerca non valido', 'INVALID_SEARCH_QUERY');
    }
    
    // Sanitizza la query
    const sanitizedQuery = query.replace(/[^\w\s]/gi, ' ').toLowerCase().trim();
    
    // Get all news
    const allNews = await fetchAllNews();
    
    // Flatten groups to search in all items
    const allItems = allNews.flatMap(group => group.items);
    
    // Perform search with text tokenization
    const queryTokens = sanitizedQuery.split(/\s+/).filter(token => token.length > 1);
    
    const results = allItems.filter(item => {
      // Assicurati che tutti i campi siano definiti
      const title = (item.title || '').toLowerCase();
      const description = (item.description || '').toLowerCase();
      const content = (item.content || '').toLowerCase();
      const topics = Array.isArray(item.topics) ? item.topics.map(t => t.toLowerCase()) : [];
      
      // Controlla se tutti i token sono presenti in almeno uno dei campi
      return queryTokens.every(token => 
        title.includes(token) || 
        description.includes(token) || 
        content.includes(token) ||
        topics.some(topic => topic.includes(token))
      );
    });
    
    // Group search results
    return groupSimilarNews(results);
  } catch (error) {
    // Propaga gli errori già formattati
    if (error.status && error.code) {
      throw error;
    }
    
    logger.error(`Error searching news: ${error.message}`);
    throw createError(500, 'Si è verificato un errore durante la ricerca.', 'SEARCH_ERROR', error);
  }
}

// Function to get hot topics
async function getHotTopics() {
  try {
    // Get all news
    const allNews = await fetchAllNews();
    
    // Flatten all items
    const allItems = allNews.flatMap(group => group.items);
    
    // Count topics using normalized topics
    const topicCounts = {};
    allItems.forEach(item => {
      if (item.topics && Array.isArray(item.topics)) {
        item.topics.forEach(topic => {
          // Usa solo topic già normalizzati
          if (typeof topic === 'string') {
            // I topic sono già normalizzati dal parser RSS
            topicCounts[topic] = (topicCounts[topic] || 0) + 1;
          }
        });
      }
    });
    
    // Convert to array and sort
    const sortedTopics = Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6); // Get top 6
    
    return sortedTopics;
  } catch (error) {
    logger.error(`Error getting hot topics: ${error.message}`);
    throw createError(500, 'Si è verificato un errore nel recupero dei topic caldi.', 'TOPICS_ERROR', error);
  }
}

// Function to get all sources
function getSources() {
  return newsSources.map(source => ({
    id: source.id,
    name: source.name,
    language: source.language
  }));
}

// Function to group similar news using optimized algorithm
function groupSimilarNews(newsItems) {
  // Validazione input
  if (!Array.isArray(newsItems)) {
    logger.warn('groupSimilarNews chiamato con input non valido');
    return [];
  }
  
  // Filtra items non validi
  const validItems = newsItems.filter(item => item && item.title && typeof item.title === 'string');
  
  if (validItems.length === 0) {
    return [];
  }
  
  const groups = {};
  
  // Indicizzazione per migliorare le prestazioni
  const titleIndex = {};
  
  // Helper function per semplificare il testo
  const simplifyText = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };
  
  // Pre-calcola e indicizza i titoli semplificati per migliorare le prestazioni
  validItems.forEach(item => {
    const simpleTitle = simplifyText(item.title);
    
    // Skip se il titolo semplificato è vuoto
    if (!simpleTitle) return;
    
    if (!titleIndex[simpleTitle]) {
      titleIndex[simpleTitle] = [];
    }
    titleIndex[simpleTitle].push(item);
  });
  
  // Funzione ottimizzata per il calcolo della similarità
  const calculateSimilarity = (item1, item2) => {
    // I titoli identici hanno max similarità
    if (item1.title === item2.title) return 1.0;
    
    const text1 = simplifyText(`${item1.title} ${item1.description || ''}`);
    const text2 = simplifyText(`${item2.title} ${item2.description || ''}`);
    
    if (!text1 || !text2) return 0;
    
    // Cache delle parole per evitare split ripetuti
    const words1 = text1.split(' ');
    const words2 = text2.split(' ');
    
    // Set per calcolo Jaccard
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    // Ottimizzazione: se la differenza di dimensione è troppo grande, la similarità sarà bassa
    if (Math.abs(set1.size - set2.size) / Math.max(set1.size, set2.size) > 0.5) {
      return 0;
    }
    
    // Calcola l'intersezione in modo ottimizzato (utilizzando il set più piccolo)
    const [smallerSet, largerSet] = set1.size < set2.size ? [set1, set2] : [set2, set1];
    
    let intersectionSize = 0;
    for (const word of smallerSet) {
      if (largerSet.has(word)) {
        intersectionSize++;
      }
    }
    
    const unionSize = set1.size + set2.size - intersectionSize;
    
    return intersectionSize / unionSize;
  };
  
  // Prima grouping per titoli identici o molto simili
  const processedItems = new Set();
  
  // Step 1: Raggruppa per titoli identici (dopo semplificazione)
  Object.entries(titleIndex).forEach(([simpleTitle, items]) => {
    if (items.length > 1) {
      const groupId = `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const mainItem = items[0];
      
      // Raccogli tutti i topic dai vari item del gruppo
      const allTopics = new Set();
      items.forEach(item => {
        if (item.topics && Array.isArray(item.topics)) {
          item.topics.forEach(topic => {
            if (typeof topic === 'string') {
              allTopics.add(topic);
            }
          });
        }
      });
      
      groups[groupId] = {
        id: groupId,
        items: [...items],
        sources: [...new Set(items.map(item => item.source))],
        title: mainItem.title,
        description: mainItem.description,
        pubDate: mainItem.pubDate,
        topics: Array.from(allTopics),
        url: mainItem.url
      };
      
      items.forEach(item => processedItems.add(item));
    }
  });
  
  // Step 2: Processa gli item rimanenti con similarità
  validItems.forEach(item => {
    // Salta items già elaborati
    if (processedItems.has(item)) return;
    
    let foundGroup = false;
    
    for (const groupId in groups) {
      const group = groups[groupId];
      if (!group.items || !group.items[0]) continue;
      
      const mainItem = group.items[0]; // Confronta con il primo item del gruppo
      
      const similarity = calculateSimilarity(mainItem, item);
      if (similarity > 0.4) { // Soglia di similarità aumentata per precisione
        group.items.push(item);
        group.sources = [...new Set([...group.sources, item.source])];
        
        // Unisci i topic da tutti gli item nel gruppo, assicurando la normalizzazione
        const allTopics = [...group.topics];
        if (item.topics && Array.isArray(item.topics)) {
          item.topics.forEach(topic => {
            if (typeof topic === 'string' && !allTopics.includes(topic)) {
              allTopics.push(topic);
            }
          });
        }
        group.topics = allTopics;
        
        processedItems.add(item);
        foundGroup = true;
        break;
      }
    }
    
    if (!foundGroup) {
      // Crea un nuovo gruppo
      const groupId = `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      groups[groupId] = {
        id: groupId,
        items: [item],
        sources: [item.source],
        title: item.title,
        description: item.description,
        pubDate: item.pubDate,
        topics: Array.isArray(item.topics) ? 
          [...item.topics].filter(topic => typeof topic === 'string') : 
          [],
        url: item.url
      };
      
      processedItems.add(item);
    }
  });
  
  // Converti in array e ordina per data
  return Object.values(groups)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

// Function to check if a news item matches a topic filter
function itemMatchesTopic(item, topicFilter) {
  if (!item || !item.topics || !Array.isArray(item.topics) || !topicFilter) {
    return false;
  }
  
  // Usa il normalizzatore per verificare se l'item ha il topic, considerando tutte le varianti linguistiche
  return topicNormalizer.itemHasTopic(item, topicFilter);
}

// Funzione per forzare un aggiornamento e inviare una notifica
async function forceRefresh() {
  try {
    // Resetta il timestamp dell'ultimo aggiornamento
    lastUpdateTime = 0;
    
    // Esegui il fetch
    const news = await fetchAllNews();
    
    // Invia notifica di sistema
    websocketService.broadcastSystemNotification(
      "Dati aggiornati con successo", 
      "info"
    );
    
    return news;
  } catch (error) {
    logger.error(`Error in force refresh: ${error.message}`);
    
    // Invia notifica di errore
    websocketService.broadcastSystemNotification(
      "Errore nell'aggiornamento dei dati", 
      "error"
    );
    
    throw error;
  }
}

module.exports = {
  fetchAllNews,
  searchNews,
  getHotTopics,
  getSources,
  itemMatchesTopic,
  forceRefresh,
  newsSources // esposto per i test
};