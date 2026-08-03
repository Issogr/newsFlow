const SENSITIVE_QUERY_PARAM_PATTERN = /^(?:token|api[_-]?key|apikey|key|secret|password|access[_-]?token|refresh[_-]?token|session|session[_-]?token)$/i;

interface RedactionOptions {
  redactAllQuery?: boolean;
}

function redactUrlCredentials(value: unknown) {
  return String(value || '').replace(/\/\/([^/?#\s@]+)@/g, '//[REDACTED]@');
}

function redactQueryValues(value: unknown, { redactAllQuery = false }: RedactionOptions = {}) {
  return String(value || '').replace(/([?&])([^=&#\s]+)=([^&#\s]*)/g, (match, separator, key) => {
    if (redactAllQuery || SENSITIVE_QUERY_PARAM_PATTERN.test(key)) {
      return `${separator}${key}=[REDACTED]`;
    }

    return match;
  });
}

function redactUrlForLog(value: unknown, options: RedactionOptions = {}) {
  return redactQueryValues(redactUrlCredentials(value), options);
}

function redactSecretsForLog(value: unknown, options: RedactionOptions = {}) {
  return redactUrlForLog(value, options)
    .replace(/\b(Bearer\s+)[^\s,;]+/giu, '$1[REDACTED]')
    .replace(/((?:["']?(?:api[_-]?key|apikey|secret|access[_-]?token|refresh[_-]?token)["']?)\s*[=:]\s*["']?)[^"'\s,;&}]+/giu, '$1[REDACTED]');
}

export = {
  redactSecretsForLog,
  redactUrlForLog
};
