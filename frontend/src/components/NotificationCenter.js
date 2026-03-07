import React, { useState, useRef, useEffect } from 'react';
import { Bell, X, Info, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';

/**
 * Centro notifiche con icona campanella e menu a discesa
 * 
 * @param {Object} props - Proprietà del componente
 * @param {Array} props.notifications - Array di notifiche da visualizzare
 * @param {Function} props.onRemoveNotification - Callback per rimuovere una notifica
 * @param {number} props.newArticlesCount - Contatore di nuovi articoli
 * @param {Function} props.onRefresh - Callback per l'aggiornamento manuale
 * @param {boolean} props.isConnected - Stato della connessione WebSocket
 */
const NotificationCenter = ({ 
  notifications = [], 
  onRemoveNotification,
  newArticlesCount = 0,
  onRefresh,
  isConnected = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const notificationRef = useRef(null);
  const totalCount = notifications.length + (newArticlesCount > 0 ? 1 : 0);
  
  // Hook per chiudere il menu quando si clicca fuori
  useOnClickOutside(notificationRef, () => setIsOpen(false));
  
  // Ottiene l'icona in base al tipo di notifica
  const getNotificationIcon = (type) => {
    switch (type) {
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" aria-hidden="true" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" aria-hidden="true" />;
      case 'info':
      default:
        return <Info className="h-5 w-5 text-blue-500 flex-shrink-0" aria-hidden="true" />;
    }
  };
  
  // Formatta la data della notifica
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };
  
  // Gestisce il clic sul pulsante di refresh
  const handleRefreshClick = (e) => {
    e.stopPropagation(); // Previene la chiusura del menu
    onRefresh();
    
    // Chiudi il menu dopo il refresh
    setIsOpen(false);
  };
  
  // Chiude il menu quando viene premuto ESC
  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('keydown', handleEsc);
    
    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  return (
    <div className="relative" ref={notificationRef}>
      {/* Icona della campanella con badge */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative z-20 rounded-full bg-white p-2 shadow-md transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label={`${totalCount} notifiche`}
        aria-expanded={isOpen}
        aria-controls="notification-menu"
      >
        <Bell className="h-6 w-6 text-gray-600" aria-hidden="true" />
        
        {/* Badge contatore notifiche */}
        {totalCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-red-500 rounded-full">
            {totalCount}
          </span>
        )}
        
        {/* Indicatore di connessione */}
        <span 
          className={`absolute bottom-0 right-0 block h-3 w-3 rounded-full border-2 border-white ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`}
          aria-hidden="true"
        ></span>
      </button>
      
      {/* Menu a discesa delle notifiche */}
      {isOpen && (
        <div
          id="notification-menu"
          className="absolute right-0 top-14 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl"
          role="menu"
        >
          {/* Intestazione del menu */}
          <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center bg-gray-50 sticky top-0">
            <h3 className="font-medium text-gray-700">Notifiche</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full p-1"
              aria-label="Chiudi notifiche"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          
          {/* Notifica per nuovi articoli */}
          {newArticlesCount > 0 && (
            <div className="p-4 border-b border-gray-200 hover:bg-blue-50">
              <button
                onClick={handleRefreshClick}
                className="w-full flex items-center text-left"
                aria-label={`Carica ${newArticlesCount} nuovi articoli`}
              >
                <RefreshCw className="h-5 w-5 text-blue-500 mr-3 flex-shrink-0" aria-hidden="true" />
                <div className="flex-1">
                  <p className="font-medium text-blue-600">
                    {newArticlesCount} {newArticlesCount === 1 ? 'nuovo articolo' : 'nuovi articoli'}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Clicca per aggiornare
                  </p>
                </div>
              </button>
            </div>
          )}
          
          {/* Lista notifiche */}
          <div className="overflow-y-auto">
            {notifications.length === 0 && newArticlesCount === 0 ? (
              <div className="p-4 text-center text-gray-500">
                <p>Nessuna notifica</p>
              </div>
            ) : (
              notifications.map(notification => (
                <div 
                  key={notification.id} 
                  className={`p-4 border-b border-gray-200 flex items-start ${
                    notification.type === 'error' ? 'hover:bg-red-50' : 
                    notification.type === 'warning' ? 'hover:bg-yellow-50' : 
                    'hover:bg-blue-50'
                  }`}
                >
                  {getNotificationIcon(notification.type)}
                  <div className="ml-3 flex-1">
                    <p className={`text-sm font-medium ${
                      notification.type === 'error' ? 'text-red-800' : 
                      notification.type === 'warning' ? 'text-yellow-800' : 
                      'text-blue-800'
                    }`}>
                      {notification.message}
                    </p>
                    {notification.timestamp && (
                      <p className="text-xs text-gray-500 mt-1">
                        {formatTimestamp(notification.timestamp)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onRemoveNotification(notification.id)}
                    className="ml-2 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 rounded-full"
                    aria-label="Elimina notifica"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>
          
          {/* Piè di pagina del menu */}
          {notifications.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 sticky bottom-0">
              <button
                onClick={() => {
                  notifications.forEach(n => onRemoveNotification(n.id));
                  setIsOpen(false);
                }}
                className="text-sm text-blue-600 hover:text-blue-800 focus:outline-none focus:underline"
              >
                Elimina tutte le notifiche
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
