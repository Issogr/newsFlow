import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

/**
 * Hook per gestire la connessione WebSocket e gli eventi correlati
 * [MIGLIORATO] Con rilevazione affidabile delle disconnessioni e gestione avanzata degli eventi
 * 
 * @param {string} url - URL del server WebSocket
 * @param {Object} options - Opzioni di configurazione Socket.io
 * @returns {Object} - Stato e funzioni per gestire la connessione WebSocket
 */
const useWebSocket = (url = '') => {
  // Usa l'URL corretta per la connessione WebSocket
  // Se non viene fornito un URL, usa l'URL base del browser
  const wsUrl = url || window.location.origin;
  
  // Stato per la connessione
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastPing, setLastPing] = useState(null);
  
  // [NUOVO] Stato per il ping/pong
  const [pingPending, setPingPending] = useState(false);
  const pongTimeoutRef = useRef(null);
  
  // [NUOVO] Contatore eventi di riconnessione per triggerare effetti
  const [reconnectionEvent, setReconnectionEvent] = useState(0);
  
  // Stati per i dati ricevuti
  const [notifications, setNotifications] = useState([]);
  const [lastNewsUpdate, setLastNewsUpdate] = useState(null);
  const [lastTopicUpdate, setLastTopicUpdate] = useState(null);
  
  // Contatori
  const [newArticlesCount, setNewArticlesCount] = useState(0);
  const [updatesReceived, setUpdatesReceived] = useState(0);
  
  // Riferimento al socket per evitare re-render inutili
  const socketRef = useRef(null);
  
  // [NUOVO] Riferimenti alle funzioni handler per evitare problemi di chiusura
  const handlersRef = useRef({});
  
  // Inizializza la connessione
  useEffect(() => {
    // Pulisci eventuali socket precedenti
    if (socketRef.current) {
      cleanupSocketListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    // Pulisci i timeout attivi
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
    }
    
    // Opzioni di configurazione Socket.io
    const options = {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      autoConnect: true,
      path: '/socket.io'  // Specifica il path esplicito
    };
    
    // DEBUG - Stampa URL di connessione
    console.log(`Attempting WebSocket connection to: ${wsUrl} with options:`, options);
    
    // Crea l'istanza Socket.io
    socketRef.current = io(wsUrl, options);
    
    // Definisci le funzioni handler
    handlersRef.current = {
      // Gestione eventi di connessione
      onConnect: () => {
        console.log('🟢 WebSocket connected successfully');
        setIsConnected(true);
        setReconnectAttempts(0);
        
        // Aggiungi notifica di connessione avvenuta
        setNotifications(prev => [
          {
            id: Date.now(),
            type: 'info',
            message: 'Connessione agli aggiornamenti in tempo reale stabilita',
            timestamp: new Date().toISOString()
          },
          ...prev
        ].slice(0, 10));
      },
      
      onDisconnect: (reason) => {
        console.log(`🔴 WebSocket disconnected: ${reason}`);
        setIsConnected(false);
        setPingPending(false);
        
        // Pulisci i timeout attivi
        if (pongTimeoutRef.current) {
          clearTimeout(pongTimeoutRef.current);
          pongTimeoutRef.current = null;
        }
        
        // Aggiungi notifica di disconnessione
        if (reason !== 'io client disconnect') {
          setNotifications(prev => [
            {
              id: Date.now(),
              type: 'warning',
              message: 'Connessione agli aggiornamenti in tempo reale persa, riconnessione in corso...',
              timestamp: new Date().toISOString()
            },
            ...prev
          ].slice(0, 10));
        }
      },
      
      onReconnectAttempt: (attempt) => {
        console.log(`🔄 WebSocket reconnection attempt: ${attempt}`);
        setReconnectAttempts(attempt);
      },
      
      onReconnectFailed: () => {
        console.log('❌ WebSocket reconnection failed after multiple attempts');
        // Aggiunta notifica per fallimento
        setNotifications(prev => [
          {
            id: Date.now(),
            type: 'error',
            message: 'Impossibile connettersi al server per gli aggiornamenti in tempo reale',
            timestamp: new Date().toISOString()
          },
          ...prev
        ].slice(0, 10));
      },
      
      onReconnect: (attempt) => {
        console.log(`🔄 WebSocket reconnected on attempt: ${attempt}`);
        // Incrementa il contatore eventi di riconnessione
        setReconnectionEvent(prev => prev + 1);
      },
      
      onError: (error) => {
        console.error('🛑 WebSocket error:', error);
      },
      
      // Gestione eventi di dati
      onWelcome: (data) => {
        console.log('👋 Welcome message from server:', data);
        // Avvia il ping periodico
        startPing();
      },
      
      onPong: (data) => {
        console.log('📡 Pong received:', data);
        setPingPending(false);
        
        // Pulisci il timeout
        if (pongTimeoutRef.current) {
          clearTimeout(pongTimeoutRef.current);
          pongTimeoutRef.current = null;
        }
        
        setLastPing(data.timestamp);
      },
      
      onNewsUpdate: (data) => {
        console.log('📰 News update received:', data);
        setLastNewsUpdate(data);
        setNewArticlesCount(prev => prev + data.count);
        setUpdatesReceived(prev => prev + 1);
        
        // Aggiunta notifica
        setNotifications(prev => [
          {
            id: Date.now(),
            type: 'info',
            message: `Ricevuti ${data.count} nuovi articoli`,
            timestamp: data.timestamp
          },
          ...prev
        ].slice(0, 10));
      },
      
      onTopicUpdate: (data) => {
        console.log('🏷️ Topic update received:', data);
        setLastTopicUpdate(data);
        setUpdatesReceived(prev => prev + 1);
        
        // Aggiunta notifica per aggiornamento topic
        if (data && data.articleId && data.topics && data.topics.length > 0) {
          setNotifications(prev => [
            {
              id: Date.now(),
              type: 'info',
              message: `Topic aggiornati: ${data.topics.join(', ')}`,
              timestamp: data.timestamp
            },
            ...prev
          ].slice(0, 10));
        }
      },
      
      onSystemNotification: (data) => {
        console.log('🔔 System notification received:', data);
        
        // Aggiunta notifica
        setNotifications(prev => [
          {
            id: Date.now(),
            type: data.notificationType,
            message: data.message,
            timestamp: data.timestamp
          },
          ...prev
        ].slice(0, 10));
      }
    };
    
    // Registra gli eventi
    registerSocketListeners();
    
    // Cleanup alla disattivazione del componente
    return () => {
      console.log('🧹 Cleaning up WebSocket connection');
      
      if (pongTimeoutRef.current) {
        clearTimeout(pongTimeoutRef.current);
      }
      
      if (socketRef.current) {
        cleanupSocketListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [wsUrl]); // Solo wsUrl come dipendenza
  
  /**
   * [NUOVO] Registra tutti i listener di eventi sul socket
   */
  const registerSocketListeners = useCallback(() => {
    if (!socketRef.current) return;
    
    // Rimuovi eventuali listener precedenti per sicurezza
    cleanupSocketListeners();
    
    // Registra i nuovi listener
    socketRef.current.on('connect', handlersRef.current.onConnect);
    socketRef.current.on('disconnect', handlersRef.current.onDisconnect);
    socketRef.current.on('reconnect_attempt', handlersRef.current.onReconnectAttempt);
    socketRef.current.on('reconnect_failed', handlersRef.current.onReconnectFailed);
    socketRef.current.on('reconnect', handlersRef.current.onReconnect);
    socketRef.current.on('error', handlersRef.current.onError);
    socketRef.current.on('welcome', handlersRef.current.onWelcome);
    socketRef.current.on('pong', handlersRef.current.onPong);
    socketRef.current.on('news:update', handlersRef.current.onNewsUpdate);
    socketRef.current.on('topic:update', handlersRef.current.onTopicUpdate);
    socketRef.current.on('system:notification', handlersRef.current.onSystemNotification);
    
    console.log('🔌 WebSocket event listeners registered');
  }, []);
  
  /**
   * [NUOVO] Pulisce tutti i listener di eventi dal socket
   */
  const cleanupSocketListeners = useCallback(() => {
    if (!socketRef.current) return;
    
    socketRef.current.off('connect', handlersRef.current.onConnect);
    socketRef.current.off('disconnect', handlersRef.current.onDisconnect);
    socketRef.current.off('reconnect_attempt', handlersRef.current.onReconnectAttempt);
    socketRef.current.off('reconnect_failed', handlersRef.current.onReconnectFailed);
    socketRef.current.off('reconnect', handlersRef.current.onReconnect);
    socketRef.current.off('error', handlersRef.current.onError);
    socketRef.current.off('welcome', handlersRef.current.onWelcome);
    socketRef.current.off('pong', handlersRef.current.onPong);
    socketRef.current.off('news:update', handlersRef.current.onNewsUpdate);
    socketRef.current.off('topic:update', handlersRef.current.onTopicUpdate);
    socketRef.current.off('system:notification', handlersRef.current.onSystemNotification);
    
    console.log('🧹 WebSocket event listeners cleaned up');
  }, []);
  
  /**
   * [MIGLIORATO] Avvia il ping periodico con rilevamento timeout
   */
  const startPing = useCallback(() => {
    if (!socketRef.current) return;
    
    const pingInterval = setInterval(() => {
      if (socketRef.current && isConnected) {
        // Se c'è già un ping in corso, potrebbe esserci un problema di connessione
        if (pingPending) {
          console.warn('📡 Previous ping still pending, connection might be dead');
          
          // Forza disconnessione e riconnessione
          if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current.connect();
          }
          
          // Resetta lo stato ping
          setPingPending(false);
          if (pongTimeoutRef.current) {
            clearTimeout(pongTimeoutRef.current);
            pongTimeoutRef.current = null;
          }
          
          return;
        }
        
        console.log('📤 Sending ping to server');
        setPingPending(true);
        
        // Imposta un timeout per la risposta pong
        const pongTimeout = setTimeout(() => {
          if (pingPending) {
            console.log('📡 Pong response timeout - connection might be dead');
            setPingPending(false);
            
            // Se ancora connesso, forza la riconnessione
            if (isConnected && socketRef.current) {
              setIsConnected(false);
              socketRef.current.disconnect();
              socketRef.current.connect();
            }
          }
        }, 5000); // 5 secondi di timeout
        
        // Salva il riferimento al timeout
        pongTimeoutRef.current = pongTimeout;
        
        // Invia il ping
        socketRef.current.emit('ping');
      }
    }, 30000); // Ogni 30 secondi
    
    // Ritorna la funzione di pulizia
    return () => {
      clearInterval(pingInterval);
      if (pongTimeoutRef.current) {
        clearTimeout(pongTimeoutRef.current);
        pongTimeoutRef.current = null;
      }
    };
  }, [isConnected, pingPending]);
  
  /**
   * Funzione per aggiornare i filtri di sottoscrizione
   * @param {Object} filters - Filtri da applicare (topics, sources)
   */
  const updateSubscriptionFilters = useCallback((filters) => {
    if (socketRef.current && isConnected) {
      console.log('📝 Updating subscription filters:', filters);
      socketRef.current.emit('subscribe:filters', filters);
    } else {
      console.warn('⚠️ Cannot update filters: WebSocket not connected');
    }
  }, [isConnected]);
  
  /**
   * Funzione per inviare un messaggio personalizzato
   * @param {string} event - Nome dell'evento
   * @param {any} data - Dati da inviare
   */
  const sendMessage = useCallback((event, data) => {
    if (socketRef.current && isConnected) {
      console.log(`📤 Sending message "${event}":`, data);
      socketRef.current.emit(event, data);
      return true;
    } else {
      console.warn(`⚠️ Cannot send message "${event}": WebSocket not connected`);
      return false;
    }
  }, [isConnected]);
  
  /**
   * Funzione per ripristinare il contatore di nuovi articoli
   */
  const resetNewArticlesCount = useCallback(() => {
    console.log('🔄 Resetting new articles count');
    setNewArticlesCount(0);
  }, []);
  
  /**
   * Funzione per rimuovere una notifica
   * @param {number} id - ID della notifica da rimuovere
   */
  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(notif => notif.id !== id));
  }, []);
  
  /**
   * Funzione per riconnettersi manualmente
   */
  const reconnect = useCallback(() => {
    if (socketRef.current) {
      if (!isConnected) {
        console.log('🔄 Manual reconnection attempt');
        socketRef.current.connect();
      }
    }
  }, [isConnected]);
  
  /**
   * [NUOVO] Verifica periodica dello stato della connessione
   */
  useEffect(() => {
    // Avvia un health check periodico
    const healthCheckInterval = setInterval(() => {
      if (socketRef.current && isConnected) {
        // Se l'ultimo ping è troppo vecchio e non c'è un ping in corso, potrebbe esserci un problema
        const lastPingTime = lastPing ? lastPing : 0;
        const pingAge = Date.now() - lastPingTime;
        
        if (pingAge > 70000 && !pingPending) { // 70 secondi (due cicli di ping + margine)
          console.warn(`📡 Last ping response is too old (${Math.round(pingAge/1000)}s), connection might be stale`);
          
          // Forza un ping immediato
          if (socketRef.current) {
            console.log('📤 Forcing immediate ping to verify connection');
            setPingPending(true);
            
            // Timeout per pong
            pongTimeoutRef.current = setTimeout(() => {
              console.warn('📡 Forced ping timeout - reconnecting');
              setPingPending(false);
              
              if (isConnected && socketRef.current) {
                setIsConnected(false);
                socketRef.current.disconnect();
                socketRef.current.connect();
              }
            }, 5000);
            
            socketRef.current.emit('ping');
          }
        }
      }
    }, 60000); // Ogni minuto
    
    return () => clearInterval(healthCheckInterval);
  }, [isConnected, lastPing, pingPending]);
  
  return {
    // Stato della connessione
    isConnected,
    reconnectAttempts,
    lastPing,
    
    // Dati ricevuti
    notifications,
    lastNewsUpdate,
    lastTopicUpdate,
    newArticlesCount,
    updatesReceived,
    
    // [NUOVO] Evento di riconnessione
    reconnectionEvent,
    
    // Azioni
    updateSubscriptionFilters,
    sendMessage,
    reconnect,
    resetNewArticlesCount,
    removeNotification
  };
};

export default useWebSocket;