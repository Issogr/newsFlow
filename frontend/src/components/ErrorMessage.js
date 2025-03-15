import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

// Componente per visualizzare messaggi di errore
const ErrorMessage = ({ error, onRetry }) => {
  // Messaggi predefiniti per vari tipi di errore
  const getErrorMessage = () => {
    if (!error) return null;
    
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
        case 503:
          return 'Il servizio non è al momento disponibile. Riprova più tardi.';
        case 500:
          return 'Si è verificato un errore interno del server. Il team è stato notificato.';
        default:
          return `Errore ${error.response.status}: ${error.response.statusText}`;
      }
    }
    
    // Errore generico come fallback
    return error.message || 'Si è verificato un errore imprevisto.';
  };

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
      <div className="flex justify-center mb-4">
        <AlertCircle size={48} className="text-red-500" />
      </div>
      <h2 className="text-xl font-semibold text-red-700 mb-2">
        Impossibile caricare le notizie
      </h2>
      <p className="text-red-600 mb-4">
        {getErrorMessage()}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center mx-auto bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md"
        >
          <RefreshCw size={16} className="mr-2" />
          Riprova
        </button>
      )}
      <p className="text-sm text-red-500 mt-4">
        Se il problema persiste, controlla lo stato del servizio o riprova più tardi.
      </p>
    </div>
  );
};

export default ErrorMessage;