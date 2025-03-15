const axios = require('axios');
const logger = require('../utils/logger');
const cache = require('memory-cache');

// Configurazione Ollama
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:1b'; // o altro modello disponibile

// Costanti per la cache
const TOPIC_CACHE_PREFIX = 'ollama_topic_';
const TOPIC_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 ore
const CLASSIFICATION_CACHE_PREFIX = 'ollama_classify_';
const CLASSIFICATION_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 giorni

/**
 * Chiede a Ollama di normalizzare un topic
 * @param {string} topic - Il topic da normalizzare
 * @param {string} targetLanguage - La lingua obiettivo (default: 'it')
 * @returns {Promise<string>} - Il topic normalizzato
 */
async function normalizeTopic(topic, targetLanguage = 'it') {
  if (!topic || typeof topic !== 'string') return null;
  
  // Genera una chiave di cache unica
  const cacheKey = `${TOPIC_CACHE_PREFIX}${topic.toLowerCase()}_${targetLanguage}`;
  
  // Controlla se il risultato è in cache
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    logger.info(`Topic normalization cache hit for: ${topic}`);
    return cachedResult;
  }
  
  try {
    // Prepara il prompt per Ollama
    const prompt = `
    You are a news topic normalization system.
    You will be given a topic in any language, and you must return the normalized version in ${targetLanguage}.
    
    - If the topic is in a language other than ${targetLanguage}, translate it
    - Do not add explanations or comments, return only the normalized topic
    - Use the first letter capitalized and the rest lowercase
    - Keep the topic short and concise (maximum 1-2 words)
    - If the topic is generic or not recognizable as a news category, return "Altro"
    
    Topic to normalize: "${topic}"
    Normalized topic:
    `;
    
    // Chiamata API a Ollama
    const response = await axios.post(`${OLLAMA_API_URL}/generate`, {
      model: OLLAMA_MODEL,
      prompt,
      options: {
        temperature: 0.1, // Bassa temperatura per risposte più deterministiche
        num_predict: 20  // Limita la lunghezza dell'output
      },
      stream: false
    });
    
    // Estrai e processa la risposta
    let normalizedTopic = response.data.response.trim();
    
    // Limita a una sola parola o frase
    if (normalizedTopic.includes('.')) {
      normalizedTopic = normalizedTopic.split('.')[0];
    }
    if (normalizedTopic.includes('\n')) {
      normalizedTopic = normalizedTopic.split('\n')[0];
    }
    
    // Formatta correttamente
    normalizedTopic = normalizedTopic.charAt(0).toUpperCase() + normalizedTopic.slice(1).toLowerCase();
    
    // Cache del risultato
    cache.put(cacheKey, normalizedTopic, TOPIC_CACHE_TTL);
    logger.info(`Normalized topic "${topic}" to "${normalizedTopic}"`);
    
    return normalizedTopic;
  } catch (error) {
    logger.error(`Error normalizing topic with Ollama: ${error.message}`);
    // Fallback: restituisci il topic originale con prima lettera maiuscola
    return topic.charAt(0).toUpperCase() + topic.slice(1).toLowerCase();
  }
}

/**
 * Deduce i topic da un articolo usando Ollama
 * @param {Object} article - L'articolo da analizzare (con titolo, descrizione, contenuto)
 * @param {string} language - La lingua dell'articolo
 * @returns {Promise<string[]>} - Array di topic dedotti
 */
async function deduceTopics(article, language = 'it') {
  if (!article || !article.title) {
    return [];
  }
  
  // Costruisci il testo da analizzare
  const text = `${article.title} ${article.description || ''} ${article.content || ''}`;
  
  // Se il testo è troppo corto, non possiamo dedurre in modo affidabile
  if (text.length < 50) {
    return [];
  }
  
  // Limita il testo a 1000 caratteri per l'analisi
  const limitedText = text.substring(0, 1000);
  
  // Crea una chiave di cache basata su un hash del testo
  const contentHash = Buffer.from(limitedText).toString('base64').substring(0, 20);
  const cacheKey = `${CLASSIFICATION_CACHE_PREFIX}${contentHash}`;
  
  // Controlla se il risultato è in cache
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    logger.info(`Topic classification cache hit for article: ${article.title.substring(0, 30)}...`);
    return cachedResult;
  }
  
  try {
    // Prepara il prompt per Ollama
    const prompt = `
    You are a news classification system. Analyze the following text and determine 1-3 main categories of the article.
    
    These are the possible categories: Politica, Economia, Tecnologia, Scienza, Ambiente, Sport, Cultura, Salute, Esteri, Cronaca, Spettacolo, Istruzione.
    
    Return only a list of categories separated by commas, without any other comments or explanations.
    If you're not sure, return only the categories you're confident about.
    If you can't determine any category, return "Altro".
    
    Article text:
    "${limitedText}"
    
    Categories:
    `;
    
    // Chiamata API a Ollama
    const response = await axios.post(`${OLLAMA_API_URL}/generate`, {
      model: OLLAMA_MODEL,
      prompt,
      options: {
        temperature: 0.2,
        num_predict: 50
      },
      stream: false
    });
    
    // Estrai e processa la risposta
    const topicsText = response.data.response.trim();
    
    // Dividi e normalizza i topic
    const deducedTopics = topicsText
      .split(/[,;\n]/) // Divide per virgole, punti e virgola o nuove linee
      .map(topic => topic.trim())
      .filter(topic => topic.length > 0)
      .map(topic => topic.charAt(0).toUpperCase() + topic.slice(1).toLowerCase());
    
    // Rimuovi duplicati
    const uniqueTopics = [...new Set(deducedTopics)];
    
    // Cache del risultato
    cache.put(cacheKey, uniqueTopics, CLASSIFICATION_CACHE_TTL);
    logger.info(`Deduced topics for article: ${uniqueTopics.join(', ')}`);
    
    return uniqueTopics;
  } catch (error) {
    logger.error(`Error deducing topics with Ollama: ${error.message}`);
    return []; // Fallback: array vuoto in caso di errore
  }
}

/**
 * Verifica se Ollama è disponibile
 * @returns {Promise<boolean>} - true se Ollama è disponibile
 */
async function checkOllamaAvailability() {
  try {
    await axios.get(`${OLLAMA_API_URL}/version`);
    return true;
  } catch (error) {
    logger.error(`Ollama server not available at ${OLLAMA_API_URL}: ${error.message}`);
    return false;
  }
}

// Verifica la disponibilità di Ollama all'avvio
let ollamaAvailable = false;
(async () => {
  ollamaAvailable = await checkOllamaAvailability();
  if (ollamaAvailable) {
    logger.info('Ollama service is available and configured correctly');
  } else {
    logger.warn('Ollama service is not available, falling back to static topic normalization');
  }
})();

/**
 * Controlla se Ollama è disponibile per l'uso
 * @returns {boolean} - true se Ollama è disponibile
 */
function isAvailable() {
  return ollamaAvailable;
}

module.exports = {
  normalizeTopic,
  deduceTopics,
  isAvailable,
  checkOllamaAvailability
};