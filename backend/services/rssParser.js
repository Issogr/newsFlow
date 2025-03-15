const RSSParser = require('rss-parser');
const axios = require('axios');
const logger = require('../utils/logger');
const ollamaService = require('./ollamaService');
const topicNormalizer = require('./topicNormalizer'); // Mantenuto come fallback

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

// Function to fetch and parse an RSS feed
async function parseFeed(source) {
  try {
    logger.info(`Fetching feed from ${source.name} (${source.url})`);
    
    // Imposta un timeout più lungo per le richieste HTTP
    const response = await axios.get(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      timeout: 15000, // 15 seconds timeout
      validateStatus: status => status < 500 // Accetta anche risposte 3xx e 4xx
    });
    
    // Verifica se la risposta contiene dati validi
    if (!response.data) {
      throw new Error('Empty response');
    }
    
    logger.info(`Successfully fetched feed from ${source.name}, parsing...`);
    
    // Parsing dell'XML
    const feed = await parser.parseString(response.data);
    
    if (!feed || !feed.items || !Array.isArray(feed.items)) {
      throw new Error('Invalid feed format');
    }
    
    logger.info(`Parsed feed from ${source.name}, found ${feed.items.length} items`);
    
    // Map feed items to standardized format
    const parsedItems = await Promise.all(feed.items.map(async item => {
      // Costruisci l'articolo base per elaborazione ulteriore
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
      
      // Estrai i topic usando metodi appropriati
      article.topics = await extractTopics(item, article, source.language);
      
      return article;
    }));
    
    return parsedItems;
  } catch (error) {
    logger.error(`Error parsing feed from ${source.name} (${source.url}): ${error.message}`);
    return []; // Return empty array in case of error
  }
}

// Helper functions
function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<\/?[^>]+(>|$)/g, "").trim();
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

async function extractTopics(item, article, language = 'it') {
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
  
  // Normalizza i topic estratti (usando Ollama o fallback statico)
  let normalizedTopics = [];
  
  if (ollamaService.isAvailable()) {
    // Usa Ollama per normalizzare i topic esistenti
    if (rawTopics.length > 0) {
      normalizedTopics = await Promise.all(
        rawTopics.map(topic => ollamaService.normalizeTopic(topic, 'it'))
      );
    }
    
    // Se non ci sono abbastanza topic o sono assenti, deduce dai contenuti
    if (normalizedTopics.length < 2) {
      // Deduci topic dal contenuto dell'articolo
      const deducedTopics = await ollamaService.deduceTopics(article, language);
      
      // Aggiungi i topic dedotti a quelli già trovati
      normalizedTopics = [...normalizedTopics, ...deducedTopics];
    }
  } else {
    // Fallback: usa il normalizzatore statico se Ollama non è disponibile
    normalizedTopics = rawTopics
      .map(topic => topicNormalizer.normalizeTopic(topic))
      .filter(Boolean);
      
    // Se non ci sono topic, prova con il metodo statico basato su parole chiave
    if (normalizedTopics.length === 0) {
      const commonTopics = Object.keys(topicNormalizer.topicEquivalents);
      const content = `${article.title || ''} ${article.description || ''}`.toLowerCase();
      
      // Verifica le equivalenze in tutte le lingue
      Object.entries(topicNormalizer.topicEquivalents).forEach(([normalizedTopic, variants]) => {
        for (const variant of variants) {
          if (content.includes(variant.toLowerCase())) {
            normalizedTopics.push(normalizedTopic);
            break; // Una volta trovata una corrispondenza per questo topic, passa al prossimo
          }
        }
      });
    }
  }
  
  // Rimuovi i duplicati e gli elementi nulli/vuoti
  return [...new Set(normalizedTopics)]
    .filter(topic => topic && typeof topic === 'string' && topic.length > 0);
}

module.exports = { parseFeed };