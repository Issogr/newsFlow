/**
 * Servizio per gestire la comunicazione in tempo reale tramite WebSockets
 * [MIGLIORATO] Con gestione errori robusta e logging avanzato
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
  newsUpdatesSent: 0,
  failedBroadcasts: 0,
  roomSizes: {}
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
  
  // [NUOVO] Imposta un intervallo per aggiornare le statistiche delle stanze
  setInterval(updateRoomStatistics, 60000); // Ogni minuto
  
  logger.info('Servizio WebSocket inizializzato');
  return io;
}

/**
 * [NUOVO] Aggiorna le statistiche sulle dimensioni delle stanze
 */
function updateRoomStatistics() {
  if (!io) return;
  
  try {
    const rooms = io.sockets.adapter.rooms;
    if (!rooms) return;
    
    // Aggiorna le statistiche per le stanze principali
    statistics.roomSizes = {
      'all-updates': rooms.get('all-updates')?.size || 0
    };
    
    // Aggiorna le statistiche per le stanze dei topic
    for (const [roomName, room] of rooms.entries()) {
      if (roomName.startsWith('topic:')) {
        statistics.roomSizes[roomName] = room.size;
      }
      if (roomName.startsWith('source:')) {
        statistics.roomSizes[roomName] = room.size;
      }
    }
    
    logger.debug(`WebSocket room statistics updated: ${JSON.stringify(statistics.roomSizes)}`);
  } catch (error) {
    logger.error(`Error updating room statistics: ${error.message}`);
  }
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
  safeBroadcast(socket, 'welcome', {
    message: 'Connesso agli aggiornamenti in tempo reale',
    timestamp: new Date().toISOString()
  });
  
  // Gestione iscrizione a filtri e topic
  socket.on('subscribe:filters', handleFilterSubscription(socket, userId));
  
  // Gestione disconnessione
  socket.on('disconnect', () => handleDisconnection(userId));
  
  // Ping/pong per mantenere attiva la connessione
  socket.on('ping', () => {
    safeBroadcast(socket, 'pong', { timestamp: Date.now() });
  });
}

/**
 * [NUOVO] Funzione per inviare messaggi in modo sicuro con gestione errori
 * @param {Object} socket - Socket di destinazione
 * @param {string} event - Nome dell'evento da emettere
 * @param {any} data - Dati da inviare
 * @returns {boolean} - true se il messaggio è stato inviato con successo
 */
function safeBroadcast(socket, event, data) {
  try {
    socket.emit(event, data);
    return true;
  } catch (error) {
    logger.error(`Error broadcasting event ${event} to socket ${socket.id}: ${error.message}`);
    statistics.failedBroadcasts++;
    return false;
  }
}

/**
 * [NUOVO] Funzione per inviare messaggi in modo sicuro a una stanza specifica
 * @param {string} room - Nome della stanza
 * @param {string} event - Nome dell'evento da emettere
 * @param {any} data - Dati da inviare
 * @returns {boolean} - true se il messaggio è stato inviato con successo
 */
function safeRoomBroadcast(room, event, data) {
  if (!io) return false;
  
  try {
    io.to(room).emit(event, data);
    
    // Aggiorna le statistiche di broadcast
    const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
    logger.debug(`Broadcast "${event}" sent to room "${room}" (${roomSize} clients)`);
    
    return true;
  } catch (error) {
    logger.error(`Error broadcasting to room ${room} for event ${event}: ${error.message}`);
    statistics.failedBroadcasts++;
    return false;
  }
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
        safeBroadcast(socket, 'error', { message: 'Filtri non validi' });
        return;
      }
      
      // Lascia tutte le stanze precedenti
      const previousRooms = [...socket.rooms].filter(room => room !== socket.id);
      previousRooms.forEach(room => {
        socket.leave(room);
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
      safeBroadcast(socket, 'filters:subscribed', {
        topics: filters.topics || [],
        sources: filters.sources || [],
        timestamp: new Date().toISOString()
      });
      
      // [NUOVO] Aggiorna statistiche delle stanze
      updateRoomStatistics();
      
    } catch (error) {
      logger.error(`Errore nella gestione dell'iscrizione ai filtri: ${error.message}`);
      safeBroadcast(socket, 'error', { message: 'Errore nella sottoscrizione ai filtri' });
    }
  };
}

/**
 * Gestisce la disconnessione di un utente
 * @param {string} userId - ID dell'utente disconnesso
 */
function handleDisconnection(userId) {
  activeConnections.delete(userId);
  statistics.activeConnectionsCount = Math.max(0, statistics.activeConnectionsCount - 1);
  logger.info(`Disconnessione WebSocket: ${userId}. Connessioni attive: ${statistics.activeConnectionsCount}`);
  
  // [NUOVO] Aggiorna statistiche dopo un breve ritardo per dare tempo ai socket di aggiornare le stanze
  setTimeout(updateRoomStatistics, 1000);
}

/**
 * Invia aggiornamenti sui topic di un articolo a tutti i client interessati
 * [MIGLIORATO] Con gestione errori robusta per ogni broadcast
 * 
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
    let successfulBroadcasts = 0;
    for (const topic of topics) {
      if (topic && typeof topic === 'string') {
        const roomName = `topic:${topic.toLowerCase()}`;
        if (safeRoomBroadcast(roomName, 'topic:update', payload)) {
          successfulBroadcasts++;
        }
      }
    }
    
    // Invia anche alla stanza generica
    const connectedClients = io.sockets.adapter.rooms.get('all-updates')?.size || 0;
    logger.info(`Invio a ${connectedClients} client nella stanza all-updates`);
    
    if (safeRoomBroadcast('all-updates', 'topic:update', payload)) {
      successfulBroadcasts++;
    }
    
    // Aggiorna statistiche
    statistics.topicUpdatesSent++;
    
    logger.info(`Topic update inviato per articolo ${articleId}: ${topics.join(', ')} (${successfulBroadcasts} broadcasts riusciti)`);
  } catch (error) {
    logger.error(`Errore nell'invio dell'aggiornamento topic: ${error.message}`, error);
  }
}

/**
 * Invia nuovi articoli a tutti i client
 * [MIGLIORATO] Con gestione separata per ogni stanza
 * 
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
    
    // Contatore di broadcast riusciti
    let successfulBroadcasts = 0;
    
    // Invia a tutti i client nella stanza generica
    if (safeRoomBroadcast('all-updates', 'news:update', payload)) {
      successfulBroadcasts++;
    }
    
    // Invia anche a stanze specifiche in base a topic e fonti
    const topicRooms = new Set();
    const sourceRooms = new Set();
    
    // Raccogli tutte le stanze rilevanti
    limitedGroups.forEach(group => {
      // Raccogli stanze dei topic
      if (group.topics && Array.isArray(group.topics)) {
        group.topics.forEach(topic => {
          if (topic && typeof topic === 'string') {
            topicRooms.add(`topic:${topic.toLowerCase()}`);
          }
        });
      }
      
      // Raccogli stanze delle fonti
      if (group.sources && Array.isArray(group.sources)) {
        group.sources.forEach(source => {
          if (source && typeof source === 'string') {
            sourceRooms.add(`source:${source.toLowerCase()}`);
          }
        });
      }
    });
    
    // Invia alle stanze dei topic
    for (const roomName of topicRooms) {
      const specificPayload = {
        ...payload,
        topic: roomName.replace('topic:', '')
      };
      
      if (safeRoomBroadcast(roomName, 'news:topic', specificPayload)) {
        successfulBroadcasts++;
      }
    }
    
    // Invia alle stanze delle fonti
    for (const roomName of sourceRooms) {
      const specificPayload = {
        ...payload,
        source: roomName.replace('source:', '')
      };
      
      if (safeRoomBroadcast(roomName, 'news:source', specificPayload)) {
        successfulBroadcasts++;
      }
    }
    
    // Aggiorna statistiche
    statistics.newsUpdatesSent++;
    
    logger.info(`Aggiornamento notizie inviato: ${limitedGroups.length} gruppi a ${statistics.activeConnectionsCount} client (${successfulBroadcasts} broadcasts riusciti)`);
  } catch (error) {
    logger.error(`Errore nell'invio dell'aggiornamento notizie: ${error.message}`);
    statistics.failedBroadcasts++;
  }
}

/**
 * Notifica i client di un evento di sistema
 * [MIGLIORATO] Con gestione errori migliore
 * 
 * @param {string} message - Messaggio di sistema 
 * @param {string} type - Tipo di notifica (info, warning, error)
 */
function broadcastSystemNotification(message, type = 'info') {
  if (!io) return;
  
  try {
    const payload = {
      type: 'system_notification',
      notificationType: type,
      message,
      timestamp: new Date().toISOString()
    };
    
    // Usa il broadcast sicuro
    let success = false;
    try {
      io.emit('system:notification', payload);
      success = true;
    } catch (emitError) {
      logger.error(`Error broadcasting system notification: ${emitError.message}`);
      statistics.failedBroadcasts++;
      
      // Fallback: prova a inviare alla stanza all-updates
      success = safeRoomBroadcast('all-updates', 'system:notification', payload);
    }
    
    if (success) {
      logger.info(`Notifica di sistema inviata: ${message}`);
    } else {
      logger.warn(`Impossibile inviare notifica di sistema: ${message}`);
    }
  } catch (error) {
    logger.error(`Errore critico nell'invio della notifica di sistema: ${error.message}`);
    statistics.failedBroadcasts++;
  }
}

/**
 * Ottiene statistiche sul servizio WebSocket
 * [MIGLIORATO] Con più informazioni diagnostiche
 * 
 * @returns {Object} - Statistiche
 */
function getStatistics() {
  const uptime = io ? Math.floor((Date.now() - io.startTime) / 1000) : 0;
  
  // Calcola stanze di topic popolari
  const topicRooms = {};
  const sourceRooms = {};
  
  for (const [roomName, size] of Object.entries(statistics.roomSizes)) {
    if (roomName.startsWith('topic:')) {
      topicRooms[roomName.replace('topic:', '')] = size;
    } else if (roomName.startsWith('source:')) {
      sourceRooms[roomName.replace('source:', '')] = size;
    }
  }
  
  return {
    ...statistics,
    uptime,
    timestamp: new Date().toISOString(),
    rooms: io ? {
      all: statistics.roomSizes['all-updates'] || 0,
      topicRooms, 
      sourceRooms
    } : {},
    serverInfo: {
      engine: io?.engine?.opts || {},
      transports: io ? Object.keys(io.engine.clients) : []
    }
  };
}

// [NUOVO] Imposta il timestamp di avvio
io = {
  startTime: Date.now()
};

module.exports = {
  initialize,
  broadcastTopicUpdate,
  broadcastNewsUpdate,
  broadcastSystemNotification,
  getStatistics
};