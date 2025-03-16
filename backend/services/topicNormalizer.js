/**
 * Modulo per la normalizzazione dei topic in diverse lingue
 * Permette di mappare topic equivalenti in lingue diverse su un singolo topic principale
 */

// Mappa di normalizzazione dei topic: chiave = versione in altre lingue, valore = versione normalizzata (italiana)
const topicMappings = {
  // Italiano (forme base)
  "politica": "Politica",
  "economia": "Economia",
  "tecnologia": "Tecnologia",
  "scienza": "Scienza",
  "ambiente": "Ambiente",
  "sport": "Sport",
  "cultura": "Cultura",
  "salute": "Salute",
  "esteri": "Esteri",
  "cronaca": "Cronaca",
  "spettacolo": "Spettacolo",
  "finanza": "Economia",
  "lavoro": "Economia",
  "innovazione": "Tecnologia",
  "clima": "Ambiente",
  "covid": "Salute",
  "coronavirus": "Salute",
  
  // Inglese
  "politics": "Politica",
  "economy": "Economia",
  "economics": "Economia",
  "business": "Economia",
  "finance": "Economia",
  "technology": "Tecnologia",
  "tech": "Tecnologia",
  "science": "Scienza",
  "environment": "Ambiente",
  "climate": "Ambiente",
  "sports": "Sport",
  "culture": "Cultura",
  "arts": "Cultura",
  "health": "Salute",
  "international": "Esteri",
  "world": "Esteri",
  "news": "Cronaca",
  "entertainment": "Spettacolo",
  "work": "Economia",
  "innovation": "Tecnologia",
  
  // Francese
  "politique": "Politica",
  "économie": "Economia",
  "economie": "Economia",
  "technologie": "Tecnologia",
  "science": "Scienza",
  "environnement": "Ambiente",
  "sport": "Sport",
  "culture": "Cultura",
  "santé": "Salute",
  "sante": "Salute",
  "international": "Esteri",
  "monde": "Esteri",
  "actualité": "Cronaca",
  "actualite": "Cronaca",
  "spectacle": "Spettacolo",
  "divertissement": "Spettacolo",
  "travail": "Economia",
  "innovation": "Tecnologia",
  "climat": "Ambiente"
};

// Categorie di equivalenza: per ogni categoria normalizzata, include tutte le sue varianti linguistiche
const topicEquivalents = {
  "Politica": ["politica", "politics", "politique"],
  "Economia": ["economia", "economy", "economics", "business", "finance", "finanza", "lavoro", "work", "économie", "economie", "travail"],
  "Tecnologia": ["tecnologia", "technology", "tech", "technologie", "innovazione", "innovation"],
  "Scienza": ["scienza", "science", "sciences"],
  "Ambiente": ["ambiente", "environment", "climate", "environnement", "clima", "climat"],
  "Sport": ["sport", "sports"],
  "Cultura": ["cultura", "culture", "arts"],
  "Salute": ["salute", "health", "santé", "sante", "covid", "coronavirus"],
  "Esteri": ["esteri", "international", "world", "monde"],
  "Cronaca": ["cronaca", "news", "actualité", "actualite"],
  "Spettacolo": ["spettacolo", "entertainment", "spectacle", "divertissement"]
};

/**
 * Normalizza un topic in base alla mappatura definita
 * @param {string} topic - Il topic da normalizzare
 * @returns {string} - Il topic normalizzato o l'originale se non mappato
 */
function normalizeTopic(topic) {
  // Validazione input per prevenire errori
  if (!topic || typeof topic !== 'string') return null;
  
  // Pulisci e standardizza il topic per la ricerca
  const lowerTopic = topic.toLowerCase().trim();
  if (lowerTopic === '') return null;
  
  // Rimuovi caratteri speciali e simboli
  const cleanTopic = lowerTopic.replace(/[^\w\s]/gi, '');
  
  // Cerca nella mappatura diretta
  if (topicMappings[cleanTopic]) {
    return topicMappings[cleanTopic];
  }
  
  // Prova con il topic originale se la pulizia ha rimosso troppo
  if (topicMappings[lowerTopic]) {
    return topicMappings[lowerTopic];
  }
  
  // Cerca nelle categorie di equivalenza (per parole composte o varianti)
  for (const [normalized, variants] of Object.entries(topicEquivalents)) {
    // Verifica se il topic contiene una delle varianti
    if (variants.some(variant => cleanTopic.includes(variant))) {
      return normalized;
    }
  }
  
  // Se non è mappato, lascia il topic originale ma capitalizza la prima lettera
  // e rimuovi spazi in eccesso
  return topic.charAt(0).toUpperCase() + topic.slice(1).toLowerCase().trim();
}

/**
 * Ottiene tutte le varianti linguistiche di un topic normalizzato
 * @param {string} normalizedTopic - Il topic normalizzato
 * @returns {string[]} - Array di tutte le varianti del topic
 */
function getTopicVariants(normalizedTopic) {
  if (!normalizedTopic || typeof normalizedTopic !== 'string') return [];
  
  const lowerTopic = normalizedTopic.toLowerCase().trim();
  
  // Cerca nelle categorie di equivalenza
  for (const [normalized, variants] of Object.entries(topicEquivalents)) {
    if (normalized.toLowerCase() === lowerTopic) {
      return variants;
    }
  }
  
  // Se non trovato, ritorna un array con solo il topic originale
  return [lowerTopic];
}

/**
 * Verifica se un item contiene un topic specifico, considerando tutte le varianti linguistiche
 * @param {Object} item - L'elemento da verificare
 * @param {string} topic - Il topic da cercare
 * @returns {boolean} - true se l'item contiene il topic o una sua variante
 */
function itemHasTopic(item, topic) {
  // Validazione degli input
  if (!item || !topic) return false;
  
  // Assicurati che item.topics sia un array
  if (!item.topics || !Array.isArray(item.topics)) {
    return false;
  }
  
  // Filtra elementi vuoti o non validi dall'array topics
  const validTopics = item.topics.filter(t => t && typeof t === 'string' && t.trim() !== '');
  if (validTopics.length === 0) return false;
  
  // Normalizza il topic cercato
  const normalizedSearchTopic = normalizeTopic(topic);
  if (!normalizedSearchTopic) return false;
  
  // Ottieni tutte le possibili varianti del topic
  const variants = getTopicVariants(normalizedSearchTopic);
  
  // Controlla se l'item ha un topic che corrisponde a una delle varianti
  return validTopics.some(itemTopic => {
    const normalizedItemTopic = normalizeTopic(itemTopic);
    return normalizedItemTopic === normalizedSearchTopic;
  });
}

/**
 * Pulisce e normalizza un array di topic
 * @param {Array} topics - Array di topic da normalizzare
 * @returns {Array} - Array di topic normalizzati senza duplicati
 */
function cleanAndNormalizeTopics(topics) {
  if (!Array.isArray(topics)) return [];
  
  // Filtra e normalizza tutti i topic
  const normalizedTopics = topics
    .filter(topic => topic && typeof topic === 'string' && topic.trim() !== '')
    .map(topic => normalizeTopic(topic))
    .filter(Boolean); // Rimuovi eventuali null
  
  // Rimuovi duplicati
  return [...new Set(normalizedTopics)];
}

module.exports = {
  normalizeTopic,
  getTopicVariants,
  itemHasTopic,
  cleanAndNormalizeTopics,
  topicMappings,
  topicEquivalents
};