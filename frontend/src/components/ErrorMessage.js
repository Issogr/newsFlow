import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

const ErrorMessage = ({ 
  error, 
  onRetry, 
  title,
  className = "",
  t
}) => {
  const getErrorMessage = () => {
    if (!error) return t('unknownError');

    if (error.message === 'Network Error') {
      return t('networkError');
    }

    if (error.response) {
      switch (error.response.status) {
        case 400:
          return t('error400');
        case 401:
          return t('error401');
        case 403:
          return t('error403');
        case 404:
          return t('error404');
        case 429:
          return t('error429');
        case 503:
          return t('error503');
        case 500:
          return t('error500');
        default:
          return t('unknownStatusError', {
            status: error.response.status,
            statusText: error.response.statusText
          });
      }
    }

    if (error.response && error.response.data && error.response.data.error) {
      return error.response.data.error.message;
    }

    return error.message || t('genericError');
  };

  const errorMessage = getErrorMessage();
  const errorCode = error?.response?.status || (error?.code ? t('codeLabel', { code: error.code }) : '');
  const resolvedTitle = title || t('errorTitle');

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
          {resolvedTitle}
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
          aria-label={t('retryAria')}
        >
          <RefreshCw size={16} className="mr-2" aria-hidden="true" />
          {t('retry')}
        </button>
      )}
      <p className="text-sm text-red-500 mt-4">
        {t('persistentErrorHelp')}
      </p>
    </div>
  );
};

export default ErrorMessage;
