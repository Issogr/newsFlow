/**
 * Utility per gestire i topic lato client
 */

// Cache delle mappature dei topic
let topicMappings = null;
let topicVariants = null;

/**
 * Imposta le mappature dei topic (chiamato dopo aver ricevuto i dati dal server)
 * @param {Object} mappings - La mappatura dei topic dal server
 */
export const setTopicMappings = (mappings) => {
  topicMappings = mappings;
};

/**
 * Verifica se un gruppo di notizie contiene un argomento specifico
 * @param {Object} group - Gruppo di notizie
 * @param {string} topic - Topic da cercare
 * @returns {boolean} - true se il gruppo contiene il topic
 */
export const groupHasTopic = (group, topic) => {
  if (!group || !group.items || !topic) return false;
  
  // Se non abbiamo mappature, fai un confronto semplice
  if (!topicMappings) {
    return group.topics.includes(topic) || 
           group.items.some(item => item.topics && item.topics.includes(topic));
  }
  
  // Con le mappature, controlla sia il topic normalizzato che le sue varianti
  const normalizedTopic = topic;
  const variants = topicMappings[normalizedTopic] || [];
  
  // Controlla nei topic del gruppo
  if (group.topics && group.topics.includes(normalizedTopic)) {
    return true;
  }
  
  // Controlla in tutti gli item del gruppo
  return group.items.some(item => {
    if (!item.topics || !Array.isArray(item.topics)) return false;
    
    // Controlla sia il topic normalizzato che tutte le sue varianti
    return item.topics.includes(normalizedTopic) || 
           variants.some(variant => item.topics.includes(variant));
  });
};

/**
 * Restituisce i topic unici da tutti i gruppi
 * @param {Array} newsGroups - Gruppi di notizie
 * @returns {Array} - Lista di topic unici
 */
export const extractUniqueTopics = (newsGroups) => {
  if (!newsGroups || !Array.isArray(newsGroups)) return [];
  
  // Raccoglie tutti i topic da tutti i gruppi
  const allTopics = newsGroups.flatMap(group => 
    (group.topics && Array.isArray(group.topics)) ? group.topics : []
  );
  
  // Rimuovi i duplicati
  return [...new Set(allTopics)].sort();
};

export default {
  setTopicMappings,
  groupHasTopic,
  extractUniqueTopics
};