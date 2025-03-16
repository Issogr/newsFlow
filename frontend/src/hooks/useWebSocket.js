import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

/**
 * Hook per gestire la connessione WebSocket e gli eventi correlati
 * 
 * @param {string} url - URL del server WebSocket
 * @param {Object} options - Opzioni di configurazione Socket.io
 * @returns {Object} - Stato e funzioni per gestire la connessione WebSocket
 */
const useWebSocket = (url = '/') => {
  // Stato per la connessione
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastPing, setLastPing] = useState(null);
  
  // Stati per i dati ricevuti
  const [notifications, setNotifications] = useState([]);
  const [lastNewsUpdate, setLastNewsUpdate] = useState(null);
  const [lastTopicUpdate, setLastTopicUpdate] = useState(null);
  
  // Contatori
  const [newArticlesCount, setNewArticlesCount] = useState(0);
  const [updatesReceived, setUpdatesReceived] = useState(0);
  
  // Riferimento al socket per evitare re-render inutili
  const socketRef = useRef(null);
  
  // Inizializza la connessione
  useEffect(() => {
    // Opzioni di configurazione Socket.io
    const options = {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      autoConnect: true
    };
    
    // Crea l'istanza Socket.io
    socketRef.current = io(url, options);
    
    // Gestione eventi di connessione
    const onConnect = () => {
      setIsConnected(true);
      setReconnectAttempts(0);
      console.log('WebSocket connesso');
    };
    
    const onDisconnect = (reason) => {
      setIsConnected(false);
      console.log(`WebSocket disconnesso: ${reason}`);
    };
    
    const onReconnectAttempt = (attempt) => {
      setReconnectAttempts(attempt);
      console.log(`Tentativo di riconnessione WebSocket: ${attempt}`);
    };
    
    const onReconnectFailed = () => {
      console.log('Impossibile riconnettersi al server WebSocket');
      // Aggiunta notifica per fallimento
      setNotifications(prev => [
        {
          id: Date.now(),
          type: 'error',
          message: 'Impossibile connettersi al server per gli aggiornamenti in tempo reale',
          timestamp: new Date().toISOString()
        },
        ...prev
      ].slice(0, 10)); // Limita il numero di notifiche
    };
    
    const onError = (error) => {
      console.error('Errore WebSocket:', error);
    };
    
    // Gestione eventi di dati
    const onWelcome = (data) => {
      console.log('Messaggio di benvenuto dal server:', data);
      // Avvia il ping periodico
      startPing();
    };
    
    const onPong = (data) => {
      setLastPing(data.timestamp);
    };
    
    const onNewsUpdate = (data) => {
      console.log('Aggiornamento notizie ricevuto:', data);
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
      ].slice(0, 10)); // Limita il numero di notifiche
    };
    
    const onTopicUpdate = (data) => {
      console.log('Aggiornamento topic ricevuto:', data);
      setLastTopicUpdate(data);
      setUpdatesReceived(prev => prev + 1);
    };
    
    const onSystemNotification = (data) => {
      console.log('Notifica di sistema ricevuta:', data);
      
      // Aggiunta notifica
      setNotifications(prev => [
        {
          id: Date.now(),
          type: data.notificationType,
          message: data.message,
          timestamp: data.timestamp
        },
        ...prev
      ].slice(0, 10)); // Limita il numero di notifiche
    };
    
    // Registrazione eventi
    socketRef.current.on('connect', onConnect);
    socketRef.current.on('disconnect', onDisconnect);
    socketRef.current.on('reconnect_attempt', onReconnectAttempt);
    socketRef.current.on('reconnect_failed', onReconnectFailed);
    socketRef.current.on('error', onError);
    socketRef.current.on('welcome', onWelcome);
    socketRef.current.on('pong', onPong);
    socketRef.current.on('news:update', onNewsUpdate);
    socketRef.current.on('topic:update', onTopicUpdate);
    socketRef.current.on('system:notification', onSystemNotification);
    
    // Funzione per inviare ping periodici
    let pingInterval;
    const startPing = () => {
      pingInterval = setInterval(() => {
        if (socketRef.current && isConnected) {
          socketRef.current.emit('ping');
        }
      }, 30000); // Ogni 30 secondi
    };
    
    // Cleanup
    return () => {
      clearInterval(pingInterval);
      
      if (socketRef.current) {
        socketRef.current.off('connect', onConnect);
        socketRef.current.off('disconnect', onDisconnect);
        socketRef.current.off('reconnect_attempt', onReconnectAttempt);
        socketRef.current.off('reconnect_failed', onReconnectFailed);
        socketRef.current.off('error', onError);
        socketRef.current.off('welcome', onWelcome);
        socketRef.current.off('pong', onPong);
        socketRef.current.off('news:update', onNewsUpdate);
        socketRef.current.off('topic:update', onTopicUpdate);
        socketRef.current.off('system:notification', onSystemNotification);
        
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [url]);
  
  /**
   * Funzione per aggiornare i filtri di sottoscrizione
   * @param {Object} filters - Filtri da applicare (topics, sources)
   */
  const updateSubscriptionFilters = useCallback((filters) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('subscribe:filters', filters);
      console.log('Filtri sottoscrizione aggiornati:', filters);
    } else {
      console.warn('Impossibile aggiornare filtri: WebSocket non connesso');
    }
  }, [isConnected]);
  
  /**
   * Funzione per inviare un messaggio personalizzato
   * @param {string} event - Nome dell'evento
   * @param {any} data - Dati da inviare
   */
  const sendMessage = useCallback((event, data) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit(event, data);
      return true;
    } else {
      console.warn(`Impossibile inviare messaggio "${event}": WebSocket non connesso`);
      return false;
    }
  }, [isConnected]);
  
  /**
   * Funzione per ripristinare il contatore di nuovi articoli
   */
  const resetNewArticlesCount = useCallback(() => {
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
        socketRef.current.connect();
        console.log('Tentativo di riconnessione manuale');
      }
    }
  }, [isConnected]);
  
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
    
    // Azioni
    updateSubscriptionFilters,
    sendMessage,
    reconnect,
    resetNewArticlesCount,
    removeNotification
  };
};

export default useWebSocket;