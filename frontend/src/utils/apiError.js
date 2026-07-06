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
