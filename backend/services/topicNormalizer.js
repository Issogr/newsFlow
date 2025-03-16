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
  "pandemia": "Salute",
  "medicina": "Salute",
  "vaccini": "Salute",
  "vaccino": "Salute",
  "borsa": "Economia",
  "mercati": "Economia",
  "inflazione": "Economia",
  "startup": "Tecnologia",
  "intelligenza artificiale": "Tecnologia",
  "ai": "Tecnologia",
  "ia": "Tecnologia",
  "digitale": "Tecnologia",
  "cinema": "Spettacolo",
  "musica": "Spettacolo",
  "tv": "Spettacolo",
  "televisione": "Spettacolo",
  "calcio": "Sport",
  "olimpiadi": "Sport",
  "tennis": "Sport",
  "formula 1": "Sport",
  "motogp": "Sport",
  "basket": "Sport",
  "governo": "Politica",
  "elezioni": "Politica",
  "parlamento": "Politica",
  "guerra": "Esteri",
  "conflitto": "Esteri",
  "diplomazia": "Esteri",
  "università": "Cultura",
  "istruzione": "Cultura",
  "scuola": "Cultura",
  "arte": "Cultura",
  "libri": "Cultura",
  "letteratura": "Cultura",
  "cambiamenti climatici": "Ambiente",
  "inquinamento": "Ambiente",
  "sostenibilità": "Ambiente",
  "energia": "Ambiente",
  "rinnovabili": "Ambiente",
  
  // Inglese
  "politics": "Politica",
  "elections": "Politica",
  "government": "Politica",
  "parliament": "Politica",
  "economy": "Economia",
  "economics": "Economia",
  "business": "Economia",
  "finance": "Economia",
  "markets": "Economia",
  "inflation": "Economia",
  "stocks": "Economia",
  "technology": "Tecnologia",
  "tech": "Tecnologia",
  "digital": "Tecnologia",
  "startups": "Tecnologia",
  "startup": "Tecnologia",
  "artificial intelligence": "Tecnologia",
  "ai": "Tecnologia",
  "science": "Scienza",
  "research": "Scienza",
  "environment": "Ambiente",
  "climate": "Ambiente",
  "climate change": "Ambiente",
  "pollution": "Ambiente",
  "sustainability": "Ambiente",
  "renewable": "Ambiente",
  "renewable energy": "Ambiente",
  "sports": "Sport",
  "sport": "Sport",
  "football": "Sport",
  "soccer": "Sport",
  "olympics": "Sport",
  "tennis": "Sport",
  "formula 1": "Sport",
  "basketball": "Sport",
  "culture": "Cultura",
  "arts": "Cultura",
  "education": "Cultura",
  "university": "Cultura",
  "school": "Cultura",
  "books": "Cultura",
  "literature": "Cultura",
  "health": "Salute",
  "healthcare": "Salute",
  "covid": "Salute",
  "covid-19": "Salute",
  "coronavirus": "Salute",
  "pandemic": "Salute",
  "medicine": "Salute",
  "vaccines": "Salute",
  "vaccine": "Salute",
  "international": "Esteri",
  "world": "Esteri",
  "foreign": "Esteri",
  "war": "Esteri",
  "conflict": "Esteri",
  "diplomacy": "Esteri",
  "news": "Cronaca",
  "crime": "Cronaca",
  "courts": "Cronaca",
  "justice": "Cronaca",
  "entertainment": "Spettacolo",
  "movies": "Spettacolo",
  "cinema": "Spettacolo",
  "music": "Spettacolo",
  "tv": "Spettacolo",
  "television": "Spettacolo",
  "celebrities": "Spettacolo",
  "work": "Economia",
  "labor": "Economia",
  "jobs": "Economia",
  "employment": "Economia",
  "innovation": "Tecnologia",
  
  // Francese
  "politique": "Politica",
  "élections": "Politica",
  "gouvernement": "Politica",
  "parlement": "Politica",
  "économie": "Economia",
  "economie": "Economia",
  "affaires": "Economia",
  "finance": "Economia",
  "marchés": "Economia",
  "inflation": "Economia",
  "bourse": "Economia",
  "technologie": "Tecnologia",
  "numérique": "Tecnologia",
  "startups": "Tecnologia",
  "startup": "Tecnologia",
  "intelligence artificielle": "Tecnologia",
  "ia": "Tecnologia",
  "science": "Scienza",
  "recherche": "Scienza",
  "environnement": "Ambiente",
  "climat": "Ambiente",
  "changement climatique": "Ambiente",
  "pollution": "Ambiente",
  "durabilité": "Ambiente",
  "énergie renouvelable": "Ambiente",
  "sport": "Sport",
  "sports": "Sport",
  "football": "Sport",
  "jeux olympiques": "Sport",
  "tennis": "Sport",
  "formule 1": "Sport",
  "basket": "Sport",
  "culture": "Cultura",
  "arts": "Cultura",
  "éducation": "Cultura",
  "université": "Cultura",
  "école": "Cultura",
  "livres": "Cultura",
  "littérature": "Cultura",
  "santé": "Salute",
  "sante": "Salute",
  "covid": "Salute",
  "covid-19": "Salute",
  "coronavirus": "Salute",
  "pandémie": "Salute",
  "pandemie": "Salute",
  "médecine": "Salute",
  "medecine": "Salute",
  "vaccins": "Salute",
  "vaccin": "Salute",
  "international": "Esteri",
  "monde": "Esteri",
  "étranger": "Esteri",
  "guerre": "Esteri",
  "conflit": "Esteri",
  "diplomatie": "Esteri",
  "actualité": "Cronaca",
  "actualite": "Cronaca",
  "crime": "Cronaca",
  "justice": "Cronaca",
  "divertissement": "Spettacolo",
  "cinéma": "Spettacolo",
  "cinema": "Spettacolo",
  "musique": "Spettacolo",
  "télévision": "Spettacolo",
  "television": "Spettacolo",
  "célébrités": "Spettacolo",
  "travail": "Economia",
  "emploi": "Economia",
  "innovation": "Tecnologia"
};

// Categorie di equivalenza: per ogni categoria normalizzata, include tutte le sue varianti linguistiche
const topicEquivalents = {
  "Politica": [
    "politica", "politics", "politique", "elezioni", "elections", "élections",
    "governo", "government", "gouvernement", "parlamento", "parliament", "parlement"
  ],
  "Economia": [
    "economia", "economy", "economics", "économie", "economie", "business",
    "finance", "finanza", "borsa", "mercati", "markets", "marchés", "bourse",
    "lavoro", "work", "travail", "emploi", "inflazione", "inflation",
    "stocks", "labour", "labor", "jobs", "employment"
  ],
  "Tecnologia": [
    "tecnologia", "technology", "tech", "technologie", "innovazione", "innovation",
    "digitale", "digital", "numérique", "startup", "startups", "ai", "ia",
    "intelligenza artificiale", "artificial intelligence", "intelligence artificielle"
  ],
  "Scienza": [
    "scienza", "science", "sciences", "recherche", "research"
  ],
  "Ambiente": [
    "ambiente", "environment", "climat", "climate", "environnement", "clima",
    "cambiamenti climatici", "climate change", "changement climatique",
    "sostenibilità", "sustainability", "durabilité", "inquinamento", "pollution",
    "energia", "energy", "énergie", "rinnovabili", "renewable", "renouvelable"
  ],
  "Sport": [
    "sport", "sports", "calcio", "football", "soccer", "olimpiadi", 
    "olympics", "jeux olympiques", "tennis", "formula 1", "formule 1", 
    "basket", "basketball", "motogp"
  ],
  "Cultura": [
    "cultura", "culture", "arts", "università", "university", "université",
    "scuola", "school", "école", "istruzione", "education", "éducation",
    "arte", "art", "libri", "books", "livres", "letteratura", "literature", "littérature"
  ],
  "Salute": [
    "salute", "health", "santé", "sante", "covid", "coronavirus", "covid-19",
    "pandemia", "pandemic", "pandémie", "pandemie", "medicina", "medicine", "médecine", "medecine",
    "vaccini", "vaccine", "vaccin", "vaccines", "vaccins", "healthcare"
  ],
  "Esteri": [
    "esteri", "international", "world", "monde", "étranger", "foreign",
    "guerra", "war", "guerre", "conflitto", "conflict", "conflit",
    "diplomazia", "diplomacy", "diplomatie"
  ],
  "Cronaca": [
    "cronaca", "news", "actualité", "actualite", "crime", "giustizia", "justice"
  ],
  "Spettacolo": [
    "spettacolo", "entertainment", "divertissement", "cinema", "cinéma", 
    "musica", "music", "musique", "tv", "television", "televisione", "télévision", 
    "célébrités", "celebrities"
  ]
};

// Cache per stemming delle parole 
const stemCache = new Map();

/**
 * Implementa uno stemming semplice per italiano, inglese e francese
 * @param {string} word - Parola da cui rimuovere suffissi
 * @returns {string} - Radice della parola
 */
function simpleStem(word) {
  if (!word || typeof word !== 'string') return '';
  
  // Usa la cache se la parola è già stata elaborata
  if (stemCache.has(word)) {
    return stemCache.get(word);
  }
  
  const lowerWord = word.toLowerCase().trim();
  
  // Rimuovi i suffissi più comuni in italiano, inglese e francese
  // (implementazione semplificata, uno stemmer vero è più complesso)
  let stemmed = lowerWord
    // Italiano
    .replace(/(?:zione|zioni|mento|menti|tore|tori|ità|ismo|ismi)$/, '')
    // Inglese
    .replace(/(?:ing|ed|ment|ments|ion|ions|er|ers|ity|ities|ism|isms)$/, '')
    // Francese
    .replace(/(?:ement|ements|tion|tions|eur|eurs|ité|isme|ismes)$/, '');
    
  // Memorizza nella cache
  stemCache.set(word, stemmed);
  
  return stemmed;
}

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
  
  // Rimuovi caratteri speciali e simboli (ma mantieni spazi per frasi)
  const cleanTopic = lowerTopic.replace(/[^\w\s]/gi, '').trim();
  if (cleanTopic === '') return null;
  
  // Cerca nella mappatura diretta per la corrispondenza esatta
  if (topicMappings[cleanTopic]) {
    return topicMappings[cleanTopic];
  }
  
  // Prova con il topic originale se la pulizia ha rimosso troppo
  if (topicMappings[lowerTopic]) {
    return topicMappings[lowerTopic];
  }
  
  // Cerca nelle categorie di equivalenza per match parziali
  // (importante per frasi composte o varianti)
  for (const [normalized, variants] of Object.entries(topicEquivalents)) {
    // Verifica se il topic è contenuto in una delle varianti
    const matchPartial = variants.some(variant => {
      if (cleanTopic.includes(variant) || variant.includes(cleanTopic)) {
        // Per match parziali, verifica che siano simili abbastanza
        // (evita false corrispondenze come "mar" in "markets")
        return cleanTopic.length >= 4 || variant.length >= 4 || 
              cleanTopic === variant || variant === cleanTopic;
      }
      return false;
    });
    
    if (matchPartial) {
      return normalized;
    }
    
    // Per match ancora più fuzzy, prova stemming
    const stemmedTopic = simpleStem(cleanTopic);
    const stemMatch = variants.some(variant => {
      const stemmedVariant = simpleStem(variant);
      return stemmedTopic === stemmedVariant || 
            (stemmedTopic.length >= 4 && stemmedVariant.includes(stemmedTopic)) ||
            (stemmedVariant.length >= 4 && stemmedTopic.includes(stemmedVariant));
    });
    
    if (stemMatch) {
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
  
  // Controlla se l'item ha un topic che corrisponde al topic normalizzato
  // considerando anche lo stemming per match più fuzzy
  const stemmedVariants = variants.map(v => simpleStem(v));
  
  return validTopics.some(itemTopic => {
    const normalizedItemTopic = normalizeTopic(itemTopic);
    
    // Match esatto sul topic normalizzato
    if (normalizedItemTopic === normalizedSearchTopic) {
      return true;
    }
    
    // Match fuzzy usando lo stemming
    const stemmedItemTopic = simpleStem(itemTopic);
    return stemmedVariants.some(stemmedVariant => 
      stemmedItemTopic === stemmedVariant || 
      (stemmedItemTopic.length >= 4 && stemmedVariant.includes(stemmedItemTopic)) ||
      (stemmedVariant.length >= 4 && stemmedItemTopic.includes(stemmedVariant))
    );
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
  
  // Rimuovi duplicati (case-insensitive)
  const uniqueTopics = new Set();
  const result = [];
  
  for (const topic of normalizedTopics) {
    const lowerTopic = topic.toLowerCase();
    if (!uniqueTopics.has(lowerTopic)) {
      uniqueTopics.add(lowerTopic);
      result.push(topic);
    }
  }
  
  return result;
}

module.exports = {
  normalizeTopic,
  getTopicVariants,
  itemHasTopic,
  cleanAndNormalizeTopics,
  simpleStem,
  topicMappings,
  topicEquivalents
};