import React, { useEffect, useState } from 'react';
import { AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

/**
 * Componente per visualizzare notifiche in stile toast
 * con auto-chiusura dopo un intervallo
 * 
 * @param {Object} props - Proprietà del componente
 * @param {Object} props.notification - Dati della notifica
 * @param {Function} props.onClose - Callback per chiusura notifica
 * @param {number} props.autoCloseTime - Tempo in ms prima dell'auto-chiusura (default: 5000)
 */
const Notification = ({ 
  notification, 
  onClose, 
  autoCloseTime = 5000 
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  
  // Imposta il colore in base al tipo di notifica
  const getNotificationStyle = () => {
    switch (notification.type) {
      case 'error':
        return {
          bg: 'bg-red-100',
          border: 'border-red-400',
          text: 'text-red-800',
          icon: <AlertCircle className="h-5 w-5 text-red-500" aria-hidden="true" />
        };
      case 'warning':
        return {
          bg: 'bg-yellow-100',
          border: 'border-yellow-400',
          text: 'text-yellow-800',
          icon: <AlertTriangle className="h-5 w-5 text-yellow-500" aria-hidden="true" />
        };
      case 'info':
      default:
        return {
          bg: 'bg-blue-100',
          border: 'border-blue-400',
          text: 'text-blue-800',
          icon: <Info className="h-5 w-5 text-blue-500" aria-hidden="true" />
        };
    }
  };
  
  // Auto-chiusura dopo l'intervallo specificato
  useEffect(() => {
    if (!autoCloseTime) return;
    
    // Intervallo per aggiornare la barra di progresso
    const progressInterval = setInterval(() => {
      if (!isPaused) {
        setProgress(prev => {
          const newProgress = prev - (100 / (autoCloseTime / 100));
          return newProgress <= 0 ? 0 : newProgress;
        });
      }
    }, 100);
    
    // Timeout per chiudere la notifica
    const timeout = setTimeout(() => {
      if (!isPaused) {
        setIsVisible(false);
        // Piccolo ritardo per l'animazione
        setTimeout(() => onClose(notification.id), 300);
      }
    }, autoCloseTime);
    
    return () => {
      clearTimeout(timeout);
      clearInterval(progressInterval);
    };
  }, [notification.id, autoCloseTime, onClose, isPaused]);
  
  // Formatta la data della notifica
  const formattedDate = notification.timestamp ? 
    new Date(notification.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
    '';
  
  const style = getNotificationStyle();
  
  return (
    <div 
      className={`${style.bg} ${style.border} ${style.text} border rounded-md shadow-md p-4 mb-3 max-w-md transform transition-all duration-300 ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}
      role="alert"
      aria-live="polite"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="flex items-start">
        <div className="flex-shrink-0 mr-3">
          {style.icon}
        </div>
        <div className="flex-1">
          <p className="font-medium">{notification.message}</p>
          {formattedDate && (
            <p className="text-xs mt-1 opacity-75">{formattedDate}</p>
          )}
        </div>
        <button 
          onClick={() => {
            setIsVisible(false);
            setTimeout(() => onClose(notification.id), 300);
          }}
          className="ml-4 flex-shrink-0 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 rounded-full"
          aria-label="Chiudi notifica"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      
      {/* Barra di progresso */}
      {autoCloseTime > 0 && (
        <div className="w-full h-1 mt-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className={`h-full ${notification.type === 'error' ? 'bg-red-500' : notification.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'}`}
            style={{ width: `${progress}%`, transition: 'width 100ms linear' }}
          ></div>
        </div>
      )}
    </div>
  );
};

export default Notification;