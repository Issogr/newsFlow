/**
 * Servizio per gestire la comunicazione in tempo reale tramite WebSockets
 */

const logger = require('../utils/logger');
let io = null;

// Mappa delle connessioni attive (userId -> socket)
const activeConnections = new Map();
// Statistiche e metriche
const statistics = {
  totalConnections: 0,
  activeConnectionsCount: 0,
  topicUpdatesSent: 0,
  newsUpdatesSent: 0
};

/**
 * Inizializza il servizio WebSocket con l'istanza del server HTTP
 * @param {Object} server - Istanza del server HTTP
 */
function initialize(server) {
  const socketIo = require('socket.io');
  
  // Configura Socket.IO con CORS e opzioni di sicurezza
  io = socketIo(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? ['http://localhost', 'http://localhost:80', 'http://frontend'] 
        : '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000, // 60 secondi
    pingInterval: 25000, // 25 secondi
    transports: ['websocket', 'polling'] // Preferisci WebSocket ma fallback su polling
  });
  
  // Gestione connessioni
  io.on('connection', handleConnection);
  
  logger.info('Servizio WebSocket inizializzato');
  return io;
}

/**
 * Gestisce una nuova connessione WebSocket
 * @param {Object} socket - Socket della connessione
 */
function handleConnection(socket) {
  const userId = socket.id;
  statistics.totalConnections++;
  statistics.activeConnectionsCount++;
  
  // DEBUG - Stampa informazioni dettagliate sulla connessione
  console.log(`⚡ NUOVO CLIENT WEBSOCKET CONNESSO: ${userId}`);
  console.log(`   - Handshake: ${JSON.stringify(socket.handshake.headers)}`);
  console.log(`   - Transport: ${socket.conn.transport.name}`);
  console.log(`   - Connessioni attive: ${statistics.activeConnectionsCount}`);
  
  // Memorizza la connessione
  activeConnections.set(userId, socket);
  
  logger.info(`Nuova connessione WebSocket: ${userId}. Connessioni attive: ${statistics.activeConnectionsCount}`);
  
  // Invia messaggio di benvenuto
  socket.emit('welcome', {
    message: 'Connesso agli aggiornamenti in tempo reale',
    timestamp: new Date().toISOString()
  });
  
  // Gestione iscrizione a filtri e topic
  socket.on('subscribe:filters', handleFilterSubscription(socket, userId));
  
  // Gestione disconnessione
  socket.on('disconnect', () => handleDisconnection(userId));
  
  // Ping/pong per mantenere attiva la connessione
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });
}

/**
 * Gestisce la sottoscrizione ai filtri
 * @param {Object} socket - Socket della connessione 
 * @param {string} userId - ID utente
 * @returns {Function} - Handler per l'evento
 */
function handleFilterSubscription(socket, userId) {
  return (filters) => {
    try {
      // Validazione dei filtri
      if (!filters || typeof filters !== 'object') {
        socket.emit('error', { message: 'Filtri non validi' });
        return;
      }
      
      // Lascia tutte le stanze precedenti
      socket.rooms.forEach(room => {
        if (room !== socket.id) {
          socket.leave(room);
        }
      });
      
      // Stanza generica per tutti gli aggiornamenti
      socket.join('all-updates');
      
      // Stanze per topic specifici
      if (filters.topics && Array.isArray(filters.topics)) {
        filters.topics.forEach(topic => {
          if (topic && typeof topic === 'string') {
            const roomName = `topic:${topic.toLowerCase()}`;
            socket.join(roomName);
            logger.debug(`${userId} iscritto a ${roomName}`);
          }
        });
      }
      
      // Stanze per fonti specifiche
      if (filters.sources && Array.isArray(filters.sources)) {
        filters.sources.forEach(source => {
          if (source && typeof source === 'string') {
            const roomName = `source:${source.toLowerCase()}`;
            socket.join(roomName);
            logger.debug(`${userId} iscritto a ${roomName}`);
          }
        });
      }
      
      // Conferma iscrizione
      socket.emit('filters:subscribed', {
        topics: filters.topics || [],
        sources: filters.sources || [],
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error(`Errore nella gestione dell'iscrizione ai filtri: ${error.message}`);
      socket.emit('error', { message: 'Errore nella sottoscrizione ai filtri' });
    }
  };
}

/**
 * Gestisce la disconnessione di un utente
 * @param {string} userId - ID dell'utente disconnesso
 */
function handleDisconnection(userId) {
  activeConnections.delete(userId);
  statistics.activeConnectionsCount--;
  logger.info(`Disconnessione WebSocket: ${userId}. Connessioni attive: ${statistics.activeConnectionsCount}`);
}

/**
 * Invia aggiornamenti sui topic di un articolo a tutti i client interessati
 * @param {string} articleId - ID dell'articolo
 * @param {Array} topics - Nuovi topic dedotti
 */
function broadcastTopicUpdate(articleId, topics) {
  if (!io) return;
  
  try {
    // Verifica input
    if (!articleId || !topics || !Array.isArray(topics)) {
      logger.warn('Tentativo di broadcast con dati non validi');
      return;
    }
    
    // Debug dettagliato
    logger.info(`TOPIC UPDATE BROADCAST: ArticleID=${articleId}, Topics=${topics.join(', ')}`);
    
    // Prepara il payload
    const payload = {
      type: 'topic_update',
      articleId,
      topics,
      timestamp: new Date().toISOString()
    };
    
    // Debug: stampa il payload completo
    logger.info(`TOPIC UPDATE PAYLOAD: ${JSON.stringify(payload)}`);
    
    // Invia a tutti i client che seguono questi topic
    topics.forEach(topic => {
      if (topic && typeof topic === 'string') {
        const roomName = `topic:${topic.toLowerCase()}`;
        io.to(roomName).emit('topic:update', payload);
      }
    });
    
    // Invia anche alla stanza generica
    const connectedClients = io.sockets.adapter.rooms.get('all-updates')?.size || 0;
    logger.info(`Invio a ${connectedClients} client nella stanza all-updates`);
    
    io.to('all-updates').emit('topic:update', payload);
    
    // Aggiorna statistiche
    statistics.topicUpdatesSent++;
    
    logger.info(`Topic update inviato per articolo ${articleId}: ${topics.join(', ')}`);
  } catch (error) {
    logger.error(`Errore nell'invio dell'aggiornamento topic: ${error.message}`, error);
  }
}

/**
 * Invia nuovi articoli a tutti i client
 * @param {Array} newsGroups - Gruppi di notizie
 */
function broadcastNewsUpdate(newsGroups) {
  if (!io) return;
  
  try {
    // Valida input
    if (!newsGroups || !Array.isArray(newsGroups) || newsGroups.length === 0) {
      return;
    }
    
    // Limite numero di articoli da inviare per non sovraccaricare i client
    const limitedGroups = newsGroups.slice(0, 10);
    
    // Prepara il payload
    const payload = {
      type: 'news_update',
      count: limitedGroups.length,
      totalCount: newsGroups.length,
      data: limitedGroups,
      timestamp: new Date().toISOString()
    };
    
    // Invia a tutti i client nella stanza generica
    io.to('all-updates').emit('news:update', payload);
    
    // Invia anche a stanze specifiche in base a topic e fonti
    limitedGroups.forEach(group => {
      // Invia alle stanze dei topic
      if (group.topics && Array.isArray(group.topics)) {
        group.topics.forEach(topic => {
          if (topic && typeof topic === 'string') {
            const roomName = `topic:${topic.toLowerCase()}`;
            io.to(roomName).emit('news:topic', {
              ...payload,
              topic
            });
          }
        });
      }
      
      // Invia alle stanze delle fonti
      if (group.sources && Array.isArray(group.sources)) {
        group.sources.forEach(source => {
          if (source && typeof source === 'string') {
            const roomName = `source:${source.toLowerCase()}`;
            io.to(roomName).emit('news:source', {
              ...payload,
              source
            });
          }
        });
      }
    });
    
    // Aggiorna statistiche
    statistics.newsUpdatesSent++;
    
    logger.info(`Aggiornamento notizie inviato: ${limitedGroups.length} gruppi a ${statistics.activeConnectionsCount} client`);
  } catch (error) {
    logger.error(`Errore nell'invio dell'aggiornamento notizie: ${error.message}`);
  }
}

/**
 * Notifica i client di un evento di sistema
 * @param {string} message - Messaggio di sistema 
 * @param {string} type - Tipo di notifica (info, warning, error)
 */
function broadcastSystemNotification(message, type = 'info') {
  if (!io) return;
  
  const payload = {
    type: 'system_notification',
    notificationType: type,
    message,
    timestamp: new Date().toISOString()
  };
  
  io.emit('system:notification', payload);
  
  logger.info(`Notifica di sistema inviata: ${message}`);
}

/**
 * Ottiene statistiche sul servizio WebSocket
 * @returns {Object} - Statistiche
 */
function getStatistics() {
  return {
    ...statistics,
    timestamp: new Date().toISOString(),
    rooms: io ? Array.from(io.sockets.adapter.rooms.keys()) : []
  };
}

module.exports = {
  initialize,
  broadcastTopicUpdate,
  broadcastNewsUpdate,
  broadcastSystemNotification,
  getStatistics
};