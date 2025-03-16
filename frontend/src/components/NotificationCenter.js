import React from 'react';
import Notification from './Notification';
import { Bell } from 'lucide-react';

/**
 * Centro notifiche che gestisce la visualizzazione di più notifiche
 * 
 * @param {Object} props - Proprietà del componente
 * @param {Array} props.notifications - Array di notifiche da visualizzare
 * @param {Function} props.onRemoveNotification - Callback per rimuovere una notifica
 * @param {number} props.newArticlesCount - Contatore di nuovi articoli
 * @param {Function} props.onRefresh - Callback per l'aggiornamento manuale
 */
const NotificationCenter = ({ 
  notifications = [], 
  onRemoveNotification,
  newArticlesCount = 0,
  onRefresh
}) => {
  // Calcola se deve mostrare il centro notifiche
  const hasNotifications = notifications.length > 0;
  const hasNewArticles = newArticlesCount > 0;
  const shouldShow = hasNotifications || hasNewArticles;

  return (
    <div className="fixed top-20 right-4 z-50 flex flex-col items-end">
      {/* Notifiche */}
      <div className="notifications">
        {notifications.map(notification => (
          <Notification
            key={notification.id}
            notification={notification}
            onClose={onRemoveNotification}
            autoCloseTime={notification.type === 'error' ? 10000 : 5000}
          />
        ))}
      </div>
      
      {/* Badge per nuovi articoli */}
      {hasNewArticles && (
        <button
          onClick={onRefresh}
          className="flex items-center mt-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg shadow-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          aria-label={`Carica ${newArticlesCount} nuovi articoli`}
        >
          <Bell className="h-4 w-4 mr-2" aria-hidden="true" />
          <span className="font-semibold mr-1">{newArticlesCount}</span>
          <span>{newArticlesCount === 1 ? 'nuovo articolo' : 'nuovi articoli'}</span>
        </button>
      )}
      
      {/* Status della connessione WebSocket */}
      <div className="fixed bottom-4 right-4 flex items-center">
        <div className={`h-2 w-2 rounded-full mr-2 ${shouldShow ? 'bg-green-500' : 'bg-gray-400'}`}></div>
        <span className="text-xs text-gray-600">
          {shouldShow ? 'Aggiornamenti in tempo reale attivi' : 'In attesa di aggiornamenti'}
        </span>
      </div>
    </div>
  );
};

export default NotificationCenter;