import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

/**
 * Componente per visualizzare messaggi di errore in modo accessibile
 * 
 * @param {Object} props - Proprietà del componente
 * @param {Error|Object} props.error - Errore da visualizzare
 * @param {Function} props.onRetry - Funzione di callback per riprovare l'operazione
 * @param {string} props.title - Titolo personalizzato (opzionale)
 * @param {string} props.className - Classi CSS aggiuntive (opzionale)
 */
const ErrorMessage = ({ 
  error, 
  onRetry, 
  title = "Impossibile caricare le notizie",
  className = "" 
}) => {
  // Messaggi predefiniti per vari tipi di errore
  const getErrorMessage = () => {
    if (!error) return "Si è verificato un errore sconosciuto.";
    
    // Se l'errore è un oggetto con un messaggio specifico dell'API
    if (error.response && error.response.data && error.response.data.error) {
      return error.response.data.error.message;
    }
    
    // Errori di rete comuni
    if (error.message === 'Network Error') {
      return 'Impossibile connettersi al server. Verifica la tua connessione internet.';
    }
    
    // Vari errori HTTP
    if (error.response) {
      switch (error.response.status) {
        case 404:
          return 'Risorsa non trovata. Il servizio potrebbe essere stato spostato o rimosso.';
        case 429:
          return 'Troppe richieste. Attendi qualche momento prima di riprovare.';
        case 503:
          return 'Il servizio non è al momento disponibile. Riprova più tardi.';
        case 500:
          return 'Si è verificato un errore interno del server. Il team è stato notificato.';
        default:
          return `Errore ${error.response.status}: ${error.response.statusText || 'Errore sconosciuto'}`;
      }
    }
    
    // Errore generico come fallback
    return error.message || 'Si è verificato un errore imprevisto.';
  };

  const errorMessage = getErrorMessage();
  const errorCode = error?.response?.status || (error?.code ? `Codice: ${error.code}` : '');

  return (
    <div 
      className={`bg-red-50 border border-red-200 rounded-lg p-6 text-center ${className}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex justify-center mb-4">
        <AlertCircle size={48} className="text-red-500" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-semibold text-red-700 mb-2">
        {title}
        {errorCode && <span className="text-sm ml-2 text-red-500">({errorCode})</span>}
      </h2>
      <p className="text-red-600 mb-6">
        {errorMessage}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center mx-auto bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md 
                   focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2
                   transition-colors"
          aria-label="Riprova a caricare i dati"
        >
          <RefreshCw size={16} className="mr-2" aria-hidden="true" />
          Riprova
        </button>
      )}
      <p className="text-sm text-red-500 mt-4">
        Se il problema persiste, controlla lo stato del servizio o contatta l'assistenza.
      </p>
    </div>
  );
};

export default ErrorMessage;