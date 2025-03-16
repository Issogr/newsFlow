import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

/**
 * Hook per gestire la connessione WebSocket e gli eventi correlati
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
      autoConnect: true,
      path: '/socket.io'  // Specifica il path esplicito
    };
    
    // DEBUG - Stampa URL di connessione
    console.log(`Attempting WebSocket connection to: ${wsUrl} with options:`, options);
    
    // Crea l'istanza Socket.io
    socketRef.current = io(wsUrl, options);
    
    // Gestione eventi di connessione
    const onConnect = () => {
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
    };
    
    const onDisconnect = (reason) => {
      console.log(`🔴 WebSocket disconnected: ${reason}`);
      setIsConnected(false);
      
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
    };
    
    const onReconnectAttempt = (attempt) => {
      console.log(`🔄 WebSocket reconnection attempt: ${attempt}`);
      setReconnectAttempts(attempt);
    };
    
    const onReconnectFailed = () => {
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
    };
    
    const onError = (error) => {
      console.error('🛑 WebSocket error:', error);
    };
    
    // Gestione eventi di dati
    const onWelcome = (data) => {
      console.log('👋 Welcome message from server:', data);
      // Avvia il ping periodico
      startPing();
    };
    
    const onPong = (data) => {
      console.log('📡 Pong received:', data);
      setLastPing(data.timestamp);
    };
    
    const onNewsUpdate = (data) => {
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
    };
    
    const onTopicUpdate = (data) => {
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
    };
    
    const onSystemNotification = (data) => {
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
          console.log('📤 Sending ping to server');
          socketRef.current.emit('ping');
        }
      }, 30000); // Ogni 30 secondi
    };
    
    // Cleanup
    return () => {
      console.log('🧹 Cleaning up WebSocket connection');
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
  }, [wsUrl]);
  
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