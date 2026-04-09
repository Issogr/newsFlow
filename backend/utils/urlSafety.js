const dns = require('dns').promises;
const net = require('net');
const axios = require('axios');
const { createError } = require('./errorHandler');

const MAX_REDIRECTS = parseInt(process.env.OUTBOUND_MAX_REDIRECTS || '5', 10);
const MAX_RESPONSE_BYTES = parseInt(process.env.OUTBOUND_MAX_RESPONSE_BYTES || '2097152', 10);
const PRIVATE_HOSTNAMES = new Set(['localhost', 'frontend', '::1', '[::1]']);

function normalizeHostname(hostname) {
  return String(hostname || '').trim().replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function isPrivateIpv4(address) {
  const octets = String(address || '').split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isPrivateIpv6(address) {
  const normalized = normalizeHostname(address);
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:');
}

function isPrivateAddress(address) {
  const type = net.isIP(address);
  if (type === 4) {
    return isPrivateIpv4(address);
  }

  if (type === 6) {
    return isPrivateIpv6(address);
  }

  return false;
}

function createInvalidUrlError(message = 'Invalid outbound URL') {
  return createError(400, message, 'INVALID_URL');
}

function createForbiddenUrlError(message = 'Outbound URL targets a private or unsafe host') {
  return createError(403, message, 'FORBIDDEN_URL');
}

function createOversizedResponseError(maxResponseBytes) {
  return createError(413, `Outbound response exceeded the ${maxResponseBytes} byte limit`, 'PAYLOAD_TOO_LARGE');
}

function normalizeMaxResponseBytes(maxResponseBytes) {
  return Number.isFinite(maxResponseBytes) && maxResponseBytes > 0
    ? Math.floor(maxResponseBytes)
    : MAX_RESPONSE_BYTES;
}

async function resolveSafeOutboundTarget(rawUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(String(rawUrl || ''));
  } catch {
    throw createInvalidUrlError();
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw createInvalidUrlError('Only HTTP(S) URLs are allowed');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw createInvalidUrlError('Credentialed URLs are not allowed');
  }

  const hostname = normalizeHostname(parsedUrl.hostname);
  if (!hostname) {
    throw createInvalidUrlError();
  }

  if (PRIVATE_HOSTNAMES.has(hostname) || hostname.endsWith('.local') || isPrivateAddress(hostname)) {
    throw createForbiddenUrlError();
  }

  let resolvedAddresses = [];

  try {
    resolvedAddresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw createInvalidUrlError('Unable to resolve outbound host');
  }

  if (!Array.isArray(resolvedAddresses) || resolvedAddresses.length === 0) {
    throw createInvalidUrlError('Unable to resolve outbound host');
  }

  if (resolvedAddresses.some((entry) => isPrivateAddress(entry.address))) {
    throw createForbiddenUrlError();
  }

  const [{ address, family }] = resolvedAddresses;

  return {
    url: parsedUrl.toString(),
    hostname,
    address,
    family
  };
}

async function assertSafeOutboundUrl(rawUrl) {
  const target = await resolveSafeOutboundTarget(rawUrl);
  return target.url;
}

function createPinnedLookup(target) {
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const normalizedHostname = normalizeHostname(hostname);
    if (normalizedHostname !== target.hostname) {
      done(new Error(`Unexpected outbound hostname lookup: ${hostname}`));
      return;
    }

    done(null, target.address, target.family);
  };
}

async function readResponseText(responseData, maxResponseBytes) {
  if (typeof responseData === 'string') {
    if (Buffer.byteLength(responseData, 'utf8') > maxResponseBytes) {
      throw createOversizedResponseError(maxResponseBytes);
    }

    return responseData;
  }

  if (Buffer.isBuffer(responseData)) {
    if (responseData.length > maxResponseBytes) {
      throw createOversizedResponseError(maxResponseBytes);
    }

    return responseData.toString('utf8');
  }

  if (!responseData || typeof responseData.on !== 'function') {
    return '';
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;
    let settled = false;

    const cleanup = () => {
      responseData.off('data', onData);
      responseData.off('end', onEnd);
      responseData.off('error', onError);
      responseData.off('aborted', onAborted);
    };

    const finish = (handler, value) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      handler(value);
    };

    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalLength += buffer.length;

      if (totalLength > maxResponseBytes) {
        if (typeof responseData.destroy === 'function') {
          responseData.destroy(createOversizedResponseError(maxResponseBytes));
        }
        finish(reject, createOversizedResponseError(maxResponseBytes));
        return;
      }

      chunks.push(buffer);
    };

    const onEnd = () => finish(resolve, Buffer.concat(chunks).toString('utf8'));
    const onError = (error) => finish(reject, error);
    const onAborted = () => finish(reject, createError(502, 'Outbound response was aborted', 'CONNECTION_ERROR'));

    responseData.on('data', onData);
    responseData.on('end', onEnd);
    responseData.on('error', onError);
    responseData.on('aborted', onAborted);
  });
}

function destroyResponseData(responseData) {
  if (responseData && typeof responseData.destroy === 'function') {
    responseData.destroy();
  }
}

async function fetchSafeTextUrl(rawUrl, requestConfig = {}) {
  const maxRedirects = Number.isFinite(requestConfig.maxRedirects)
    ? requestConfig.maxRedirects
    : MAX_REDIRECTS;
  const maxResponseBytes = normalizeMaxResponseBytes(requestConfig.maxResponseBytes);
  const {
    maxResponseBytes: ignoredMaxResponseBytes,
    responseType: ignoredResponseType,
    transformResponse: ignoredTransformResponse,
    lookup: ignoredLookup,
    ...baseRequestConfig
  } = requestConfig;
  const axiosConfig = {
    ...baseRequestConfig,
    maxRedirects: 0,
    responseType: 'stream',
    transformResponse: [(data) => data],
    validateStatus: () => true
  };
  let currentTarget = await resolveSafeOutboundTarget(rawUrl);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await axios.get(currentTarget.url, {
      ...axiosConfig,
      lookup: createPinnedLookup(currentTarget)
    });

    if (response.status >= 300 && response.status < 400) {
      const redirectLocation = response.headers?.location;
      if (!redirectLocation) {
        destroyResponseData(response.data);
        throw createInvalidUrlError('Redirect response missing location');
      }

      destroyResponseData(response.data);
      currentTarget = await resolveSafeOutboundTarget(new URL(redirectLocation, currentTarget.url).toString());
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      destroyResponseData(response.data);
      throw createError(response.status || 502, `Outbound request failed with status ${response.status || 'unknown'}`, 'CONNECTION_ERROR');
    }

    return {
      ...response,
      data: await readResponseText(response.data, maxResponseBytes),
      finalUrl: currentTarget.url,
      resolvedAddress: currentTarget.address
    };
  }

  throw createError(400, 'Too many redirects while fetching outbound URL', 'INVALID_URL');
}

module.exports = {
  assertSafeOutboundUrl,
  fetchSafeTextUrl,
  _normalizeHostname: normalizeHostname,
  _isPrivateAddress: isPrivateAddress
};
