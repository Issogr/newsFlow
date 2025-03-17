/**
 * Modulo utility per la gestione dei topic
 * Versione minima che NON contiene definizioni statiche di topic
 */

/**
 * Normalizza il formato di un topic (prima lettera maiuscola, resto minuscolo)
 * Non applica mappature predefinite, solo formattazione
 * @param {string} topic - Il topic da formattare
 * @returns {string} - Il topic formattato o null se non valido
 */
function formatTopic(topic) {
  if (!topic || typeof topic !== 'string') return null;
  
  // Rimuovi spazi in eccesso e trimma
  const cleanTopic = topic.trim();
  if (cleanTopic === '') return null;
  
  // Capitalizza la prima lettera, resto minuscolo
  return cleanTopic.charAt(0).toUpperCase() + cleanTopic.slice(1).toLowerCase();
}

/**
 * Rimuove duplicati da un array di topic (case-insensitive)
 * @param {Array} topics - Lista di topic da cui rimuovere duplicati
 * @returns {Array} - Lista di topic senza duplicati
 */
function removeDuplicates(topics) {
  if (!Array.isArray(topics)) return [];
  
  const uniqueTopics = new Set();
  const result = [];
  
  for (const topic of topics) {
    if (!topic || typeof topic !== 'string') continue;
    
    const lowerTopic = topic.toLowerCase().trim();
    if (lowerTopic === '' || uniqueTopics.has(lowerTopic)) continue;
    
    uniqueTopics.add(lowerTopic);
    result.push(formatTopic(topic));
  }
  
  return result;
}

/**
 * Limita un array di topic al numero massimo specificato
 * @param {Array} topics - Lista di topic
 * @param {number} maxTopics - Numero massimo di topic da mantenere
 * @returns {Array} - Lista di topic limitata
 */
function limitTopics(topics, maxTopics = 3) {
  if (!Array.isArray(topics)) return [];
  return topics.slice(0, maxTopics);
}

module.exports = {
  formatTopic,
  removeDuplicates,
  limitTopics
};