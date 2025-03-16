const axios = require('axios');
const logger = require('../utils/logger');

// Configurazione Ollama
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:1b'; // o altro modello disponibile
const USE_OLLAMA = process.env.USE_OLLAMA !== 'false'; // Disabilita Ollama se impostato a 'false'

// Configurazione timeout
const OLLAMA_TIMEOUT = 3000; // 3 secondi di timeout per le chiamate a Ollama

// Limita le chiamate concorrenti a Ollama
const MAX_CONCURRENT_REQUESTS = 2;
let currentRequests = 0;
const pendingRequests = [];

/**
 * Gestisce una richiesta a Ollama con limitazione delle chiamate concorrenti
 * @param {Function} requestFn - Funzione che effettua la richiesta a Ollama
 * @returns {Promise<any>} - Risultato della richiesta
 */
function queueOllamaRequest(requestFn) {
  return new Promise((resolve, reject) => {
    // Funzione per eseguire la richiesta
    const executeRequest = async () => {
      // Incrementa il contatore delle richieste concorrenti
      currentRequests++;
      
      try {
        // Esegui la richiesta con timeout
        const result = await Promise.race([
          requestFn(),
          new Promise((_, r) => setTimeout(() => r(new Error('Ollama request timeout')), OLLAMA_TIMEOUT))
        ]);
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        // Decrementa il contatore e processa la prossima richiesta in coda
        currentRequests--;
        processNextRequest();
      }
    };
    
    // Verifica se è possibile eseguire la richiesta immediatamente
    if (currentRequests < MAX_CONCURRENT_REQUESTS) {
      executeRequest();
    } else {
      // Altrimenti, aggiungi alla coda
      pendingRequests.push(executeRequest);
    }
  });
}

/**
 * Processa la prossima richiesta in coda
 */
function processNextRequest() {
  if (pendingRequests.length > 0 && currentRequests < MAX_CONCURRENT_REQUESTS) {
    const nextRequest = pendingRequests.shift();
    nextRequest();
  }
}

/**
 * Chiede a Ollama di normalizzare un topic
 * @param {string} topic - Il topic da normalizzare
 * @param {string} targetLanguage - La lingua obiettivo (default: 'it')
 * @returns {Promise<string>} - Il topic normalizzato
 */
async function normalizeTopic(topic, targetLanguage = 'it') {
  if (!topic || typeof topic !== 'string') return null;
  
  // Se Ollama è disabilitato o non disponibile, usa un semplice formatting
  if (!USE_OLLAMA || !ollamaAvailable) {
    return topic.charAt(0).toUpperCase() + topic.slice(1).toLowerCase();
  }
  
  try {
    // Definisci la funzione di richiesta
    const makeRequest = async () => {
      // Prepara il prompt per Ollama (più breve per ridurre il tempo di elaborazione)
      const prompt = `Normalizza questo topic di notizie in italiano con prima lettera maiuscola: "${topic}"`;
      
      // Chiamata API a Ollama
      const response = await axios.post(`${OLLAMA_API_URL}/generate`, {
        model: OLLAMA_MODEL,
        prompt,
        options: {
          temperature: 0.1,
          num_predict: 10  // Limitato per velocità
        },
        stream: false
      }, {
        timeout: OLLAMA_TIMEOUT
      });
      
      // Estrai e processa la risposta
      let normalizedTopic = response.data.response.trim();
      
      // Limitazioni e pulizia
      normalizedTopic = normalizedTopic
        .split(/[.,\n]/)[0]  // Prendi solo la prima parte fino a punto, virgola o newline
        .trim();
      
      // Formatta correttamente
      normalizedTopic = normalizedTopic.charAt(0).toUpperCase() + normalizedTopic.slice(1).toLowerCase();
      
      return normalizedTopic;
    };
    
    // Esegui la richiesta tramite la coda
    const normalizedTopic = await queueOllamaRequest(makeRequest);
    
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
  const text = `${article.title} ${article.description || ''}`;
  
  // Se il testo è troppo corto, non possiamo dedurre in modo affidabile
  if (text.length < 30) {
    return [];
  }
  
  // Limita il testo per l'analisi
  const limitedText = text.substring(0, 500);
  
  // Se Ollama è disabilitato o non disponibile, restituisci un array vuoto
  if (!USE_OLLAMA || !ollamaAvailable) {
    return [];
  }
  
  try {
    // Definisci la funzione di richiesta
    const makeRequest = async () => {
      // Prepara il prompt per Ollama (versione semplificata e diretta)
      const prompt = `Analizza questo titolo di notizia e restituisci 1-2 categorie come: Politica, Economia, Tecnologia, Scienza, Ambiente, Sport, Cultura, Salute. Solo le categorie separate da virgola, senza altro testo: "${limitedText}"`;
      
      // Chiamata API a Ollama
      const response = await axios.post(`${OLLAMA_API_URL}/generate`, {
        model: OLLAMA_MODEL,
        prompt,
        options: {
          temperature: 0.2,
          num_predict: 20
        },
        stream: false
      }, {
        timeout: OLLAMA_TIMEOUT
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
      return [...new Set(deducedTopics)];
    };
    
    // Esegui la richiesta tramite la coda
    const uniqueTopics = await queueOllamaRequest(makeRequest);
    
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
  if (!USE_OLLAMA) {
    logger.info('Ollama is disabled via environment variable');
    return false;
  }
  
  try {
    await axios.get(`${OLLAMA_API_URL}/version`, { timeout: 2000 });
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
  return USE_OLLAMA && ollamaAvailable;
}

module.exports = {
  normalizeTopic,
  deduceTopics,
  isAvailable,
  checkOllamaAvailability
};