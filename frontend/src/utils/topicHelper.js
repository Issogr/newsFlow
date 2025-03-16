/**
 * Utility per gestire i topic lato client
 * Fornisce funzioni per la normalizzazione e il confronto dei topic
 */

// Cache delle mappature dei topic
let topicMappings = null;

/**
 * Imposta le mappature dei topic (chiamato dopo aver ricevuto i dati dal server)
 * @param {Object} mappings - La mappatura dei topic dal server
 */
export const setTopicMappings = (mappings) => {
  if (mappings && typeof mappings === 'object') {
    topicMappings = mappings;
  } else {
    console.warn('Tentativo di impostare mappature topic non valide:', mappings);
  }
};

/**
 * Verifica se un gruppo di notizie contiene un argomento specifico
 * Implementa una ricerca robusta con supporto per varianti linguistiche
 * 
 * @param {Object} group - Gruppo di notizie
 * @param {string} topic - Topic da cercare
 * @returns {boolean} - true se il gruppo contiene il topic
 */
export const groupHasTopic = (group, topic) => {
  // Validazione input
  if (!group || !group.items || !Array.isArray(group.items) || !topic || typeof topic !== 'string') {
    return false;
  }
  
  // Normalizza il topic di ricerca in minuscolo per confronti case-insensitive
  const searchTopic = topic.toLowerCase().trim();
  
  // Se il gruppo ha un array di topic, controlla corrispondenza diretta
  if (group.topics && Array.isArray(group.topics)) {
    // Ricerca case-insensitive
    const directMatch = group.topics.some(groupTopic => 
      groupTopic && typeof groupTopic === 'string' && 
      groupTopic.toLowerCase().trim() === searchTopic
    );
    
    if (directMatch) return true;
  }
  
  // Se non abbiamo mappature, fai un confronto semplice
  if (!topicMappings) {
    return (group.topics && Array.isArray(group.topics) && 
            group.topics.some(t => t && typeof t === 'string' && 
                               t.toLowerCase().trim() === searchTopic)) || 
           group.items.some(item => 
             item.topics && Array.isArray(item.topics) && 
             item.topics.some(t => t && typeof t === 'string' && 
                               t.toLowerCase().trim() === searchTopic)
           );
  }
  
  // Con le mappature, controlla sia il topic normalizzato che le sue varianti
  const variants = topicMappings[topic] || [];
  const allVariants = [searchTopic, ...variants.map(v => v.toLowerCase().trim())];
  
  // Cerca in tutti gli item del gruppo
  return group.items.some(item => {
    if (!item.topics || !Array.isArray(item.topics)) return false;
    
    // Cerca corrispondenze case-insensitive
    return item.topics.some(itemTopic => {
      if (!itemTopic || typeof itemTopic !== 'string') return false;
      
      const normalizedItemTopic = itemTopic.toLowerCase().trim();
      return allVariants.includes(normalizedItemTopic);
    });
  });
};

/**
 * Restituisce i topic unici da tutti i gruppi
 * @param {Array} newsGroups - Gruppi di notizie
 * @returns {Array} - Lista di topic unici ordinati alfabeticamente
 */
export const extractUniqueTopics = (newsGroups) => {
  if (!newsGroups || !Array.isArray(newsGroups)) return [];
  
  // Set per tenere traccia di topic già visti (case-insensitive)
  const topicSet = new Set();
  // Mappa per mantenere la versione originale (prima lettera maiuscola)
  const topicMap = {};
  
  // Raccoglie tutti i topic da tutti i gruppi
  newsGroups.forEach(group => {
    if (group.topics && Array.isArray(group.topics)) {
      group.topics.forEach(topic => {
        if (topic && typeof topic === 'string') {
          const lowerTopic = topic.toLowerCase();
          if (!topicSet.has(lowerTopic)) {
            topicSet.add(lowerTopic);
            // Conserva la versione con prima lettera maiuscola
            topicMap[lowerTopic] = topic.charAt(0).toUpperCase() + topic.slice(1);
          }
        }
      });
    }
  });
  
  // Converti il set in array e ordina alfabeticamente
  return Array.from(topicSet)
    .sort()
    .map(lowerTopic => topicMap[lowerTopic]);
};

/**
 * Cerca una corrispondenza parziale tra topic
 * Utile per ricerche fuzzy o topic simili
 * 
 * @param {string} topic1 - Primo topic
 * @param {string} topic2 - Secondo topic
 * @returns {boolean} - true se c'è una corrispondenza parziale
 */
export const topicsPartiallyMatch = (topic1, topic2) => {
  if (!topic1 || !topic2 || typeof topic1 !== 'string' || typeof topic2 !== 'string') {
    return false;
  }
  
  const t1 = topic1.toLowerCase().trim();
  const t2 = topic2.toLowerCase().trim();
  
  // Se uno è contenuto nell'altro
  if (t1.includes(t2) || t2.includes(t1)) {
    // Evita corrispondenze parziali troppo corte
    return t1.length >= 4 || t2.length >= 4;
  }
  
  return false;
};

/**
 * Ottiene tutte le varianti di un topic
 * @param {string} topic - Topic di cui trovare le varianti
 * @returns {string[]} - Array di varianti
 */
export const getTopicVariants = (topic) => {
  if (!topic || typeof topic !== 'string' || !topicMappings) {
    return [topic];
  }
  
  // Cerca nelle mappature
  return topicMappings[topic] || [topic];
};

export default {
  setTopicMappings,
  groupHasTopic,
  extractUniqueTopics,
  topicsPartiallyMatch,
  getTopicVariants
};