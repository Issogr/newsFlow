const SENSITIVE_QUERY_PARAM_PATTERN = /^(?:token|api[_-]?key|apikey|key|secret|password|access[_-]?token|refresh[_-]?token|session|session[_-]?token)$/i;

function redactUrlCredentials(value) {
  return String(value || '').replace(/\/\/([^/?#\s@]+)@/g, '//[REDACTED]@');
}

function redactQueryValues(value, { redactAllQuery = false } = {}) {
  return String(value || '').replace(/([?&])([^=&#\s]+)=([^&#\s]*)/g, (match, separator, key) => {
    if (redactAllQuery || SENSITIVE_QUERY_PARAM_PATTERN.test(key)) {
      return `${separator}${key}=[REDACTED]`;
    }

    return match;
  });
}

function redactUrlForLog(value, options = {}) {
  return redactQueryValues(redactUrlCredentials(value), options);
}

module.exports = {
  redactUrlForLog
};
