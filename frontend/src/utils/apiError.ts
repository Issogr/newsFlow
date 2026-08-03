import type { ApiErrorLike, TranslationParams, Translator } from '../types';

function asApiError(error: unknown): ApiErrorLike {
  return error && typeof error === 'object' ? error as ApiErrorLike : {};
}

export function getApiErrorPayload(error: unknown) {
  return asApiError(error).response?.data?.error || {};
}

export function getApiErrorStatus(error: unknown) {
  return asApiError(error).response?.status;
}

export function hasApiResponse(error: unknown) {
  return Boolean(asApiError(error).response);
}

export function isApiTimeoutError(error: unknown) {
  const apiError = asApiError(error);
  return apiError.newsFlowClientCode === 'timeout' || apiError.code === 'ECONNABORTED';
}

export function isApiNetworkError(error: unknown) {
  const apiError = asApiError(error);
  return apiError.newsFlowClientCode === 'network' || apiError.message === 'Network Error';
}

export function getFriendlyApiErrorMessage(error: unknown, t: Translator, fallbackKey = 'genericError', fallbackParams?: TranslationParams) {
  if (isApiTimeoutError(error)) {
    return t('requestTimeoutError');
  }

  if (isApiNetworkError(error)) {
    return t('networkError');
  }

  const { message: apiMessage } = getApiErrorPayload(error);
  if (apiMessage) {
    return apiMessage;
  }

  if (hasApiResponse(error)) {
    switch (getApiErrorStatus(error)) {
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
      case 500:
        return t('error500');
      case 503:
        return t('error503');
      default:
        return t(fallbackKey, fallbackParams);
    }
  }

  return asApiError(error).message || t(fallbackKey, fallbackParams);
}
