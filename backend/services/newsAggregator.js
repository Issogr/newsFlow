const rssParser = require('./rssParser');
const logger = require('../utils/logger');
const cache = require('memory-cache');
const topicNormalizer = require('./topicNormalizer');

// News sources configuration
const newsSources = [
  { id: 'corriere', name: 'Corriere della Sera', url: 'https://www.corriere.it/rss/homepage.xml', type: 'rss', language: 'it' }, // URL aggiornato
  { id: 'repubblica', name: 'La Repubblica', url: 'https://www.repubblica.it/rss/homepage/rss2.0.xml', type: 'rss', language: 'it' },
  { id: 'ansa', name: 'ANSA', url: 'https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml', type: 'rss', language: 'it' },
  { id: 'sole24ore', name: 'Il Sole 24 Ore', url: 'https://www.ilsole24ore.com/rss/italia.xml', type: 'rss', language: 'it' },
  { id: 'bbc', name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', type: 'rss', language: 'en' },
  { id: 'nytimes', name: 'New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', type: 'rss', language: 'en' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', type: 'rss', language: 'en' },
  { id: 'lemonde', name: 'Le Monde', url: 'https://www.lemonde.fr/rss/une.xml', type: 'rss', language: 'fr' }
];

// Function to fetch all news from all sources
async function fetchAllNews() {
  const cachedNews = cache.get('all_news');
  if (cachedNews) {
    return cachedNews;
  }

  try {
    // Fetch from all sources in parallel
    const newsPromises = newsSources.map(source => rssParser.parseFeed(source));
    const newsArrays = await Promise.allSettled(newsPromises);
    
    // Logga info dettagliate sugli errori di fetch per aiutare il debugging
    const failedSources = newsArrays
      .map((result, index) => ({ 
        status: result.status, 
        source: newsSources[index].name,
        url: newsSources[index].url,
        reason: result.status === 'rejected' ? result.reason?.message || 'Unknown error' : null 
      }))
      .filter(result => result.status === 'rejected');
    
    if (failedSources.length > 0) {
      logger.warn(`Failed to fetch from ${failedSources.length} sources:`, {
        failedSources: failedSources
      });
    }
    
    // Elabora i risultati (sia successi che fallimenti)
    const allNewsItems = newsArrays
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value);
    
    // Controlla se abbiamo almeno ALCUNE notizie, anche se non da tutte le fonti
    if (allNewsItems.length === 0) {
      logger.error('No news could be fetched from any source', {
        sources: newsSources.map(s => s.id)
      });
      throw new Error('CONNECTION_ERROR');
    }
    
    // Se abbiamo almeno una fonte funzionante, continua
    logger.info(`Successfully fetched ${allNewsItems.length} news items from ${newsArrays.filter(r => r.status === 'fulfilled').length}/${newsSources.length} sources`);
    
    // Group similar news
    const groupedNews = groupSimilarNews(allNewsItems);
    
    // Cache the results
    cache.put('all_news', groupedNews, 5 * 60 * 1000); // 5 minutes cache
    
    return groupedNews;
  } catch (error) {
    logger.error(`Error fetching all news: ${error.message}`);
    
    // Se c'è un errore specifico di connessione, propagalo
    if (error.message === 'CONNECTION_ERROR') {
      throw { status: 503, message: 'Impossibile connettersi ai feed di notizie. Per favore riprova più tardi.', code: 'CONNECTION_ERROR' };
    }
    
    // Altri tipi di errore
    throw { status: 500, message: 'Si è verificato un errore nel recupero delle notizie.', code: 'SERVER_ERROR' };
  }
}

// Function to search in all news
async function searchNews(query) {
  try {
    // Get all news
    const allNews = await fetchAllNews();
    
    // Flatten groups to search in all items
    const allItems = allNews.flatMap(group => group.items);
    
    // Perform search
    const lowercaseQuery = query.toLowerCase();
    const results = allItems.filter(item => 
      item.title.toLowerCase().includes(lowercaseQuery) || 
      item.description.toLowerCase().includes(lowercaseQuery) || 
      (item.content && item.content.toLowerCase().includes(lowercaseQuery)) ||
      (item.topics && item.topics.some(topic => 
        typeof topic === 'string' && topic.toLowerCase().includes(lowercaseQuery)
      ))
    );
    
    // Group search results
    return groupSimilarNews(results);
  } catch (error) {
    logger.error(`Error searching news: ${error.message}`);
    throw error;
  }
}

// Function to get hot topics
async function getHotTopics() {
  try {
    const cachedTopics = cache.get('hot_topics');
    if (cachedTopics) {
      return cachedTopics;
    }
    
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
    
    // Cache the results
    cache.put('hot_topics', sortedTopics, 30 * 60 * 1000); // 30 minutes cache
    
    return sortedTopics;
  } catch (error) {
    logger.error(`Error getting hot topics: ${error.message}`);
    throw error;
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

// Function to group similar news using TF-IDF
function groupSimilarNews(newsItems) {
  const groups = {};
  
  // Helper function for text stemming/simplification
  const simplifyText = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .join(' ');
  };
  
  // Calculate similarity between two items
  const calculateSimilarity = (item1, item2) => {
    if (!item1 || !item2 || !item1.title || !item2.title) return 0;
    
    const text1 = simplifyText(`${item1.title} ${item1.description || ''}`);
    const text2 = simplifyText(`${item2.title} ${item2.description || ''}`);
    
    if (!text1 || !text2) return 0;
    
    // Simple Jaccard similarity for demo
    const words1 = new Set(text1.split(' '));
    const words2 = new Set(text2.split(' '));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / (union.size || 1); // Evita divisione per zero
  };
  
  // Utility per normalizzare e filtrare i topic
  const normalizeTopics = (topicsArray) => {
    if (!topicsArray || !Array.isArray(topicsArray)) return [];
    
    const topicNormalizer = require('./topicNormalizer');
    return topicNormalizer.cleanAndNormalizeTopics(topicsArray);
  };
  
  // Group items
  newsItems.forEach(item => {
    // Controlla validità dell'item
    if (!item || !item.title) return;
    
    let foundGroup = false;
    
    for (const groupId in groups) {
      const group = groups[groupId];
      if (!group.items || !group.items[0]) continue;
      
      const mainItem = group.items[0]; // Compare with the first item in group
      
      const similarity = calculateSimilarity(mainItem, item);
      if (similarity > 0.3) { // Threshold for similarity
        group.items.push(item);
        
        // Aggiungi la fonte se non già presente
        if (!group.sources.includes(item.source)) {
          group.sources.push(item.source);
        }
        
        // Merge topics from all items in the group, ensuring normalization
        const allTopics = [...(group.topics || [])];
        
        if (item.topics && Array.isArray(item.topics)) {
          // Aggiungi solo topic validi e non già presenti
          const validItemTopics = item.topics.filter(topic => 
            typeof topic === 'string' && topic.trim() !== ''
          );
          
          validItemTopics.forEach(topic => {
            // Evita duplicati
            if (!allTopics.includes(topic)) {
              allTopics.push(topic);
            }
          });
        }
        
        // Normalizza e pulisci i topic del gruppo
        group.topics = normalizeTopics(allTopics);
        
        foundGroup = true;
        break;
      }
    }
    
    if (!foundGroup) {
      // Create new group
      const groupId = `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Normalizza i topic dell'item prima di creare il gruppo
      const normalizedTopics = normalizeTopics(
        Array.isArray(item.topics) ? item.topics : []
      );
      
      groups[groupId] = {
        id: groupId,
        items: [item],
        sources: [item.source],
        title: item.title,
        description: item.description,
        pubDate: item.pubDate,
        topics: normalizedTopics,
        url: item.url
      };
    }
  });
  
  // Verifica finale e pulizia dei gruppi
  for (const groupId in groups) {
    const group = groups[groupId];
    
    // Assicurati che tutti i campi esistano e siano validi
    group.topics = group.topics || [];
    group.sources = group.sources || [];
    group.items = (group.items || []).filter(Boolean);
    
    // Rimuovi eventuali duplicati
    group.topics = [...new Set(group.topics)];
    group.sources = [...new Set(group.sources)];
    
    // Se non ci sono item validi, rimuovi il gruppo
    if (group.items.length === 0) {
      delete groups[groupId];
    }
  }
  
  // Convert to array and sort by date
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

// Generate diff between two texts
function generateDiff(text1, text2) {
  if (!text1 || !text2 || typeof text1 !== 'string' || typeof text2 !== 'string') {
    return [{ type: 'unchanged', text: 'Contenuto non disponibile per il confronto' }];
  }
  
  const words1 = text1.split(/\s+/);
  const words2 = text2.split(/\s+/);
  
  const result = [];
  let i = 0, j = 0;
  
  while (i < words1.length || j < words2.length) {
    if (i >= words1.length) {
      // Text 2 has more words
      result.push({ type: 'added', text: words2.slice(j).join(' ') });
      break;
    } else if (j >= words2.length) {
      // Text 1 has more words
      result.push({ type: 'removed', text: words1.slice(i).join(' ') });
      break;
    } else if (words1[i] === words2[j]) {
      // Identical words
      result.push({ type: 'unchanged', text: words1[i] });
      i++;
      j++;
    } else {
      // Different words
      let foundMatch = false;
      
      // Look for the next match
      for (let k = 1; k < 5 && i + k < words1.length; k++) {
        if (words1[i + k] === words2[j]) {
          // Found match later in text 1
          result.push({ type: 'removed', text: words1.slice(i, i + k).join(' ') });
          i += k;
          foundMatch = true;
          break;
        }
      }
      
      if (!foundMatch) {
        for (let k = 1; k < 5 && j + k < words2.length; k++) {
          if (words1[i] === words2[j + k]) {
            // Found match later in text 2
            result.push({ type: 'added', text: words2.slice(j, j + k).join(' ') });
            j += k;
            foundMatch = true;
            break;
          }
        }
      }
      
      if (!foundMatch) {
        // No match found in next few words
        result.push({ type: 'removed', text: words1[i] });
        result.push({ type: 'added', text: words2[j] });
        i++;
        j++;
      }
    }
  }
  
  return result;
}

module.exports = {
  fetchAllNews,
  searchNews,
  getHotTopics,
  getSources,
  generateDiff,
  itemMatchesTopic
};