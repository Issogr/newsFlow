const axios = require('axios');
const logger = require('../utils/logger');
const topicNormalizer = require('./topicNormalizer');

// Configurazione Ollama
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:1b'; // o altro modello disponibile
const USE_OLLAMA = process.env.USE_OLLAMA !== 'false'; // Disabilita Ollama se impostato a 'false'

// Configurazione timeout
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '3000', 10); // 3 secondi di timeout per le chiamate a Ollama

// Limita le chiamate concorrenti a Ollama
const MAX_CONCURRENT_REQUESTS = parseInt(process.env.OLLAMA_MAX_CONCURRENT || '3', 10);
let currentRequests = 0;
const pendingRequests = [];

// Backoff esponenziale per riconnessione
let retryCount = 0;
const MAX_RETRY = 5;
const INITIAL_RETRY_DELAY = 5000; // 5 secondi

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
        
        // Resetta il contatore di retry su successo
        retryCount = 0;
        
        resolve(result);
      } catch (error) {
        // Aggiorna lo stato del servizio in caso di errore di connessione
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.message.includes('timeout')) {
          ollamaAvailable = false;
          
          // Aggiorna il contatore di retry
          retryCount++;
          
          // Calcola il ritardo con backoff esponenziale
          const retryDelay = Math.min(
            INITIAL_RETRY_DELAY * Math.pow(2, retryCount - 1) + Math.random() * 1000,
            60000 // max 1 minuto
          );
          
          logger.warn(`Ollama service unavailable, will retry health check in ${Math.round(retryDelay/1000)}s (attempt ${retryCount}/${MAX_RETRY})`);
          
          // Pianifica un nuovo controllo di disponibilità
          if (retryCount <= MAX_RETRY) {
            setTimeout(() => {
              checkOllamaAvailability()
                .then(available => {
                  if (available) {
                    logger.info('Ollama service reconnected successfully');
                  }
                })
                .catch(e => {
                  logger.error(`Failed to reconnect to Ollama: ${e.message}`);
                });
            }, retryDelay);
          }
        }
        
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
    return topicNormalizer.normalizeTopic(topic);
  }
  
  try {
    // Definisci la funzione di richiesta
    const makeRequest = async () => {
      // Prepara il prompt per Ollama (più breve per ridurre il tempo di elaborazione)
      const prompt = `Normalizza questo topic di notizie in italiano in una singola parola con prima lettera maiuscola, senza punteggiatura o commenti aggiuntivi: "${topic}"`;
      
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
    
    // Controlla se il risultato è un topic valido secondo le nostre regole
    const validatedTopic = topicNormalizer.normalizeTopic(normalizedTopic);
    return validatedTopic;
  } catch (error) {
    logger.error(`Error normalizing topic with Ollama: ${error.message}`);
    // Fallback: usa il normalizzatore statico in caso di errore
    return topicNormalizer.normalizeTopic(topic);
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
  if (text.length < 20) {
    return deduceTopicsStatically(article);
  }
  
  // Limita il testo per l'analisi
  const limitedText = text.substring(0, 500);
  
  // Se Ollama è disabilitato o non disponibile, usa il metodo statico
  if (!USE_OLLAMA || !ollamaAvailable) {
    return deduceTopicsStatically(article);
  }
  
  try {
    // Definisci la funzione di richiesta
    const makeRequest = async () => {
      // Prepara il prompt per Ollama (versione migliorata con dettagli specifici)
      const promptMap = {
        'it': `Analizza questo titolo e descrizione di notizia e restituisci SOLO 1 o 2 categorie tra: Politica, Economia, Tecnologia, Scienza, Ambiente, Sport, Cultura, Salute, Esteri, Cronaca, Spettacolo. Rispondi con SOLO le categorie separate da virgola, senza altri testi. Testo: "${limitedText}"`,
        'en': `Analyze this news title and description and return ONLY 1 or 2 categories from: Politics, Economy, Technology, Science, Environment, Sports, Culture, Health, International, News, Entertainment. Reply with ONLY the categories separated by comma, without any other text. Text: "${limitedText}"`,
        'fr': `Analysez ce titre et cette description d'actualité et retournez UNIQUEMENT 1 ou 2 catégories parmi: Politique, Économie, Technologie, Science, Environnement, Sport, Culture, Santé, International, Actualité, Divertissement. Répondez avec UNIQUEMENT les catégories séparées par une virgule, sans autre texte. Texte: "${limitedText}"`
      };
      
      // Usa il prompt nella lingua corretta o quello italiano come fallback
      const prompt = promptMap[language] || promptMap['it'];
      
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
      const rawTopics = topicsText
        .split(/[,;\n]/) // Divide per virgole, punti e virgola o nuove linee
        .map(topic => topic.trim())
        .filter(topic => topic.length > 0);
      
      // Normalizza i topic usando il nostro normalizzatore
      const normalizedTopics = rawTopics.map(topic => topicNormalizer.normalizeTopic(topic)).filter(Boolean);
      
      // Rimuovi duplicati
      const uniqueTopics = [...new Set(normalizedTopics)];
      
      return uniqueTopics;
    };
    
    // Esegui la richiesta tramite la coda
    const uniqueTopics = await queueOllamaRequest(makeRequest);
    
    // Verifica se abbiamo ottenuto risultati validi
    if (!uniqueTopics || uniqueTopics.length === 0) {
      // Fallback: usa il metodo statico
      logger.debug(`No topics deduced by Ollama for article, using static method`);
      return deduceTopicsStatically(article);
    }
    
    return uniqueTopics;
  } catch (error) {
    logger.error(`Error deducing topics with Ollama: ${error.message}`);
    return deduceTopicsStatically(article); // Fallback in caso di errore
  }
}

/**
 * Deduce topic staticamente usando parole chiave nel testo
 * @param {Object} article - Articolo da analizzare
 * @returns {string[]} - Topic dedotti
 */
function deduceTopicsStatically(article) {
  return require('./asyncProcessor').deduceTopicsStatically(article);
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