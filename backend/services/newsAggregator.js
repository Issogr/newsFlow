const rssParser = require('./rssParser');
const logger = require('../utils/logger');
const topicNormalizer = require('./topicNormalizer');
const { sanitizeHtml } = require('../utils/inputValidator');
const { createError } = require('../utils/errorHandler');
const websocketService = require('./websocketService');
const asyncProcessor = require('./asyncProcessor');
const ollamaService = require('./ollamaService');

// News sources configuration
const newsSources = [
  { id: 'repubblica', name: 'La Repubblica', url: 'https://www.repubblica.it/rss/homepage/rss2.0.xml', type: 'rss', language: 'it' },
  { 
    id: 'ansa', 
    name: 'Ansa', 
    urls: [
      'https://www.ansa.it/sito/ansait_rss.xml',
      'https://www.ansa.it/sito/notizie/cronaca/cronaca_rss.xml',
      'https://www.ansa.it/sito/notizie/politica/politica_rss.xml',
      'https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml',
      'https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml'
    ], 
    type: 'multi-rss', 
    language: 'it' 
  },
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
  { id: 'genova24', name: 'Genova24', url: 'https://www.genova24.it/feed', type: 'rss', language: 'it' },
  { id: 'ivgsavona', name: 'IVG Savona', url: 'https://www.ivg.it/?feed=news-news24', type: 'rss', language: 'it' },
  { id: 'savonanews', name: 'Savona News', url: 'https://www.savonanews.it/rss.xml', type: 'rss', language: 'it' },
  { 
    id: 'comuneimperia', 
    name: 'Comune Imperia', 
    urls: [
      'https://comune.imperia.it/it/news/feed',
      'https://comune.imperia.it/it/events/feed'
    ], 
    type: 'multi-rss', 
    language: 'it' 
  },
  { id: 'imperiapost', name: 'ImperiaPost', url: 'https://www.imperiapost.it/feed', type: 'rss', language: 'it' },
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
    
    // Verifica se Ollama è disponibile
    const ollamaAvailable = ollamaService.isAvailable();
    
    // Arricchisci gli articoli con i topic dedotti solo se Ollama è disponibile
    for (const item of sanitizedItems) {
      // Recupera topic sia per ID che per titolo
      const deducedTopics = asyncProcessor.getTopicsForArticle(item.id, item);
      
      if (deducedTopics && deducedTopics.length > 0) {
        // Combina i topic esistenti con quelli dedotti
        const existingTopics = Array.isArray(item.topics) ? item.topics : [];
        
        // Combina topic e rimuovi duplicati
        const combinedTopics = [...new Set([...existingTopics, ...deducedTopics])];
        
        // Limita a massimo 3 topic
        const limitedTopics = combinedTopics.slice(0, 3);
        
        item.topics = limitedTopics;
        logger.debug(`Enriched article ${item.id} with topics: ${limitedTopics.join(', ')}`);
      } else if (ollamaAvailable) {
        // Se Ollama è disponibile e non abbiamo topic, avvia la deduzione
        asyncProcessor.startTopicDeduction(item.id, item, item.language || 'it');
      } else {
        // Se Ollama non è disponibile, assicurati che l'articolo abbia almeno un array vuoto
        item.topics = [];
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

/**
 * [MIGLIORATO] Function to group similar news using optimized algorithm
 * with semantic similarity and better matching
 * 
 * @param {Array} newsItems - Array of news items
 * @returns {Array} - Array of grouped news
 */
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
  
  /**
   * [MIGLIORATO] Calcolo della similarità tra articoli
   * Considera semantica e pesi differenziati per titolo/contenuto
   */
  const calculateSimilarity = (item1, item2) => {
    // Similarità esatta del titolo (priorità massima)
    if (item1.title === item2.title) return 1.0;
    
    // Normalizza i testi
    const text1 = simplifyText(`${item1.title} ${item1.description || ''}`);
    const text2 = simplifyText(`${item2.title} ${item2.description || ''}`);
    
    if (!text1 || !text2) return 0;
    
    // Calcola similarità basata su parole
    const words1 = text1.split(' ');
    const words2 = text2.split(' ');
    
    // Peso maggiore per parole nel titolo
    const titleWords1 = simplifyText(item1.title).split(' ');
    const titleWords2 = simplifyText(item2.title).split(' ');
    
    // Set per calcolo Jaccard
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const titleSet1 = new Set(titleWords1);
    const titleSet2 = new Set(titleWords2);
    
    // Calcola intersezione
    let intersectionSize = 0;
    let titleIntersectionSize = 0;
    
    // Ottimizzazione: usa il set più piccolo per l'iterazione
    const [smallerSet, largerSet] = set1.size < set2.size ? [set1, set2] : [set2, set1];
    const [smallerTitleSet, largerTitleSet] = titleSet1.size < titleSet2.size ? 
      [titleSet1, titleSet2] : [titleSet2, titleSet1];
    
    smallerSet.forEach(word => {
      if (largerSet.has(word)) intersectionSize++;
    });
    
    smallerTitleSet.forEach(word => {
      if (largerTitleSet.has(word)) titleIntersectionSize++;
    });
    
    const unionSize = set1.size + set2.size - intersectionSize;
    const titleUnionSize = titleSet1.size + titleSet2.size - titleIntersectionSize;
    
    // Evita divisione per zero
    if (unionSize === 0 || titleUnionSize === 0) return 0;
    
    // Calcola similarità con peso maggiore per il titolo (70%)
    const contentSimilarity = intersectionSize / unionSize;
    const titleSimilarity = titleIntersectionSize / titleUnionSize;
    
    // [NUOVO] Considera anche topic comuni
    let topicSimilarity = 0;
    if (item1.topics && item2.topics && 
        Array.isArray(item1.topics) && Array.isArray(item2.topics) &&
        item1.topics.length > 0 && item2.topics.length > 0) {
      
      const topicSet1 = new Set(item1.topics.map(t => t.toLowerCase()));
      const topicSet2 = new Set(item2.topics.map(t => t.toLowerCase()));
      
      let commonTopics = 0;
      topicSet1.forEach(topic => {
        if (topicSet2.has(topic)) commonTopics++;
      });
      
      // Se hanno almeno un topic in comune, aumenta la similarità
      if (commonTopics > 0) {
        topicSimilarity = commonTopics / Math.max(topicSet1.size, topicSet2.size);
      }
    }
    
    // Formula di similarità complessiva con pesi:
    // - 60% similarità titolo
    // - 20% similarità contenuto
    // - 20% similarità topic
    return 0.6 * titleSimilarity + 0.2 * contentSimilarity + 0.2 * topicSimilarity;
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
        topics: Array.from(allTopics).slice(0, 3), // Limita a 3 topic
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
    let bestGroupId = null;
    let bestSimilarity = 0;
    
    // Trova il gruppo con la migliore similarità
    for (const groupId in groups) {
      const group = groups[groupId];
      if (!group.items || !group.items[0]) continue;
      
      const mainItem = group.items[0]; // Confronta con il primo item del gruppo
      
      const similarity = calculateSimilarity(mainItem, item);
      
      // [MIGLIORATO] Seleziona il gruppo con la migliore similarità,
      // non il primo che supera la soglia
      if (similarity > bestSimilarity && similarity > 0.4) {
        bestSimilarity = similarity;
        bestGroupId = groupId;
        foundGroup = true;
      }
    }
    
    if (foundGroup && bestGroupId) {
      const group = groups[bestGroupId];
      
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
      // Limita a massimo 3 topic
      group.topics = allTopics.slice(0, 3);
      
      processedItems.add(item);
    } else {
      // Crea un nuovo gruppo
      const groupId = `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const itemTopics = Array.isArray(item.topics) ? 
        [...item.topics].filter(topic => typeof topic === 'string') : 
        [];
      
      // Limita a massimo 3 topic
      const limitedTopics = itemTopics.slice(0, 3);
      
      groups[groupId] = {
        id: groupId,
        items: [item],
        sources: [item.source],
        title: item.title,
        description: item.description,
        pubDate: item.pubDate,
        topics: limitedTopics,
        url: item.url
      };
      
      processedItems.add(item);
    }
  });
  
  // Converti in array e ordina per data
  const groupsArray = Object.values(groups)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  
  // [NUOVO] Log delle statistiche di raggruppamento
  logger.debug(`Grouped ${validItems.length} news items into ${groupsArray.length} groups (${Math.round((1 - groupsArray.length/validItems.length) * 100)}% reduction)`);
  
  return groupsArray;
}

// Function to check if a news item matches a topic filter
function itemMatchesTopic(item, topicFilter) {
  if (!item || !item.topics || !Array.isArray(item.topics) || !topicFilter) {
    return false;
  }
  
  // Confronto diretto case-insensitive
  return item.topics.some(topic => 
    typeof topic === 'string' && 
    topic.toLowerCase() === topicFilter.toLowerCase()
  );
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