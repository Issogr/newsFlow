export function getApiErrorPayload(error) {
  return error?.response?.data?.error || {};
}

export function getApiErrorStatus(error) {
  return error?.response?.status;
}

export function hasApiResponse(error) {
  return Boolean(error?.response);
}

export function isApiTimeoutError(error) {
  return error?.newsFlowClientCode === 'timeout' || error?.code === 'ECONNABORTED';
}

export function isApiNetworkError(error) {
  return error?.newsFlowClientCode === 'network' || error?.message === 'Network Error';
}

export function getFriendlyApiErrorMessage(error, t, fallbackKey = 'genericError') {
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
        return t(fallbackKey);
    }
  }

  return error?.message || t(fallbackKey);
}
