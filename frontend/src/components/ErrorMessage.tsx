import { AlertCircle, RefreshCw } from 'lucide-react';
import { getApiErrorStatus, getFriendlyApiErrorMessage, hasApiResponse } from '../utils/apiError';
import type { ApiErrorLike, Translator } from '../types';

const ErrorMessage = ({
  error,
  onRetry,
  t
}: { error: unknown; onRetry?: () => void; t: Translator }) => {
  const apiError = error && typeof error === 'object' ? error as ApiErrorLike : {};
  const status = getApiErrorStatus(error);
  const errorMessage = !error
    ? t('unknownError')
    : getFriendlyApiErrorMessage(
        error,
        t,
        hasApiResponse(error) ? 'unknownStatusError' : 'genericError',
         { status, statusText: apiError.response?.statusText }
       );
  const errorCode = apiError.response?.status || (apiError.code ? t('codeLabel', { code: apiError.code }) : '');

  return (
    <div 
      className="bg-red-50 border border-red-200 rounded-lg p-6 text-center"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex justify-center mb-4">
        <AlertCircle size={48} className="text-red-500" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-semibold text-red-700 mb-2">
        {t('errorTitle')}
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
