const rssParser = require('./rssParser');
const logger = require('../utils/logger');
const cache = require('memory-cache');

// News sources configuration
const newsSources = [
  { id: 'corriere', name: 'Corriere della Sera', url: 'https://rss.corriere.it/rss2/homepage.xml', type: 'rss', language: 'it' },
  { id: 'repubblica', name: 'La Repubblica', url: 'https://www.repubblica.it/rss/homepage/rss2.0.xml', type: 'rss', language: 'it' },
  { id: 'ansa', name: 'ANSA', url: 'https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml', type: 'rss', language: 'it' },
  { id: 'sole24ore', name: 'Il Sole 24 Ore', url: 'https://www.ilsole24ore.com/rss/italia.xml', type: 'rss', language: 'it' },
  { id: 'bbc', name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', type: 'rss', language: 'en' },
  { id: 'nytimes', name: 'New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', type: 'rss', language: 'en' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', type: 'rss', language: 'en' },
  { id: 'lemonde', name: 'Le Monde', url: 'https://www.lemonde.fr/rss/une.xml', type: 'rss', language: 'fr' }
];

// Dati mock per fallback in caso di errori nella connessione ai feed reali
const mockNewsData = [
  {
    id: '1',
    title: "Riforma fiscale: approvato il nuovo decreto",
    description: "Il governo ha approvato un nuovo decreto che modifica la tassazione per le imprese e i lavoratori autonomi.",
    content: "Il Consiglio dei Ministri ha approvato oggi il nuovo decreto fiscale che introduce importanti novità per le imprese e i lavoratori autonomi. Tra le misure principali figurano la riduzione dell'IRES dal 24% al 22% e nuove detrazioni per investimenti in tecnologia green.",
    pubDate: "2025-03-14T14:30:00Z",
    source: "Corriere della Sera",
    sourceId: "corriere",
    url: "https://www.corriere.it/economia/riforme-fiscali-2025",
    topics: ["Economia", "Politica", "Fisco"]
  },
  {
    id: '2',
    title: "Il governo approva la riforma fiscale",
    description: "Novità fiscali per imprese e partite IVA nel nuovo decreto approvato oggi.",
    content: "Il decreto fiscale è stato approvato dal Consiglio dei Ministri nella seduta di oggi. Le novità più rilevanti riguardano la riduzione dell'aliquota IRES di due punti percentuali e l'introduzione di incentivi per la transizione ecologica delle imprese. Diverse le reazioni delle associazioni di categoria.",
    pubDate: "2025-03-14T15:15:00Z",
    source: "La Repubblica",
    sourceId: "repubblica",
    url: "https://www.repubblica.it/economia/2025/03/14/riforma_fiscale",
    topics: ["Economia", "Politica"]
  },
  {
    id: '3',
    title: "Emergenza climatica: nuovo record di temperature a marzo",
    description: "Gli scienziati avvertono: il cambiamento climatico sta accelerando.",
    content: "Marzo 2025 segna un nuovo record di temperature globali, confermando la tendenza al riscaldamento globale accelerato. Secondo i dati forniti dalle agenzie meteorologiche internazionali, la temperatura media globale è stata di 1.2°C superiore alla media del periodo pre-industriale.",
    pubDate: "2025-03-15T09:45:00Z",
    source: "BBC News",
    sourceId: "bbc",
    url: "https://www.bbc.com/news/science-environment/climate-record-march-2025",
    topics: ["Ambiente", "Scienza", "Clima"]
  }
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
    
    // Elabora i risultati (sia successi che fallimenti)
    const allNewsItems = newsArrays
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value);
    
    // Se non abbiamo notizie, usa i dati mock per il debug
    const finalNewsItems = allNewsItems.length > 0 ? allNewsItems : mockNewsData;
    
    // Group similar news
    const groupedNews = groupSimilarNews(finalNewsItems);
    
    // Cache the results
    cache.put('all_news', groupedNews, 5 * 60 * 1000); // 5 minutes cache
    
    return groupedNews;
  } catch (error) {
    logger.error(`Error fetching all news: ${error.message}`);
    
    // Fallback to mock data in case of an error
    const fallbackData = groupSimilarNews(mockNewsData);
    cache.put('all_news', fallbackData, 2 * 60 * 1000); // 2 minutes cache for fallback data
    
    return fallbackData;
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
    
    // Count topics
    const topicCounts = {};
    allItems.forEach(item => {
      if (item.topics && Array.isArray(item.topics)) {
        item.topics.forEach(topic => {
          // Verifica che il topic sia una stringa prima di elaborarlo
          if (typeof topic === 'string') {
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
    
    // Se non ci sono topic, fornisci alcuni default
    const finalTopics = sortedTopics.length > 0 ? sortedTopics : [
      { topic: "Politica", count: 5 },
      { topic: "Economia", count: 4 },
      { topic: "Tecnologia", count: 3 },
      { topic: "Ambiente", count: 2 },
      { topic: "Sport", count: 1 },
      { topic: "Cultura", count: 1 }
    ];
    
    // Cache the results
    cache.put('hot_topics', finalTopics, 30 * 60 * 1000); // 30 minutes cache
    
    return finalTopics;
  } catch (error) {
    logger.error(`Error getting hot topics: ${error.message}`);
    // Restituisci topic predefiniti in caso di errore
    return [
      { topic: "Politica", count: 5 },
      { topic: "Economia", count: 4 },
      { topic: "Tecnologia", count: 3 },
      { topic: "Ambiente", count: 2 },
      { topic: "Sport", count: 1 },
      { topic: "Cultura", count: 1 }
    ];
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
        group.sources = [...new Set([...group.sources, item.source])];
        foundGroup = true;
        break;
      }
    }
    
    if (!foundGroup) {
      // Create new group
      const groupId = `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      groups[groupId] = {
        id: groupId,
        items: [item],
        sources: [item.source],
        title: item.title,
        description: item.description,
        pubDate: item.pubDate,
        topics: Array.isArray(item.topics) ? item.topics.filter(topic => typeof topic === 'string') : [],
        url: item.url
      };
    }
  });
  
  // Convert to array and sort by date
  return Object.values(groups)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
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
  generateDiff
};