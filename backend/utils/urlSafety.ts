const dns = require('dns').promises;
const net = require('net');
const axios = require('axios');
const { createError } = require('./errorHandler');
const { parseIntegerEnv } = require('./env');
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { LookupAddress, LookupOptions } from 'node:dns';
import type { AppError } from './types';

const MAX_REDIRECTS = parseIntegerEnv('OUTBOUND_MAX_REDIRECTS', 5, { min: 0 });
const MAX_RESPONSE_BYTES = parseIntegerEnv('OUTBOUND_MAX_RESPONSE_BYTES', 2097152, { min: 1 });
const PRIVATE_HOSTNAMES = new Set(['localhost', 'frontend', '::1', '[::1]']);
const UNSAFE_IPV4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

function normalizeHostname(hostname: unknown) {
  return String(hostname || '').trim().replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function ipv4ToNumber(address: unknown) {
  const octets = String(address || '').split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function isIpv4InCidr(address: string, cidrBase: string, prefixLength: number) {
  const addressNumber = ipv4ToNumber(address);
  const baseNumber = ipv4ToNumber(cidrBase);

  if (addressNumber === null || baseNumber === null) {
    return false;
  }

  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (addressNumber & mask) === (baseNumber & mask);
}

function extractIpv4MappedIpv6(address: string) {
  const normalized = normalizeHostname(address);
  const dottedMatch = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedMatch && ipv4ToNumber(dottedMatch[1]) !== null) {
    return dottedMatch[1];
  }

  const hexMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexMatch) {
    return '';
  }

  const high = parseInt(hexMatch[1], 16);
  const low = parseInt(hexMatch[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return '';
  }

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

function isPrivateIpv4(address: string) {
  return UNSAFE_IPV4_RANGES.some(([cidrBase, prefixLength]) => isIpv4InCidr(address, cidrBase, prefixLength));
}

function isPrivateIpv6(address: string) {
  const normalized = normalizeHostname(address);
  const mappedIpv4 = extractIpv4MappedIpv6(normalized);
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }

  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
    || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8:');
}

function isPrivateAddress(address: string) {
  const type = net.isIP(address);
  if (type === 4) {
    return isPrivateIpv4(address);
  }

  if (type === 6) {
    return isPrivateIpv6(address);
  }

  return false;
}

function createInvalidUrlError(message = 'Invalid outbound URL'): AppError {
  return createError(400, message, 'INVALID_URL');
}

function createForbiddenUrlError(message = 'Outbound URL targets a private or unsafe host'): AppError {
  return createError(403, message, 'FORBIDDEN_URL');
}

function createOversizedResponseError(maxResponseBytes: number): AppError {
  return createError(413, `Outbound response exceeded the ${maxResponseBytes} byte limit`, 'PAYLOAD_TOO_LARGE');
}

function normalizeMaxResponseBytes(maxResponseBytes: unknown) {
  return typeof maxResponseBytes === 'number' && Number.isFinite(maxResponseBytes) && maxResponseBytes > 0
    ? Math.floor(maxResponseBytes)
    : MAX_RESPONSE_BYTES;
}

function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

interface SafeOutboundTarget {
  address: string;
  family: number;
  hostname: string;
  url: string;
}

interface SafeRequestConfig extends Omit<AxiosRequestConfig, 'signal'> {
  maxResponseBytes?: number;
  signal?: AbortSignal;
}

interface ReadableResponse {
  destroy(error?: Error): void;
  off(event: 'data', listener: (chunk: string | Uint8Array) => void): void;
  off(event: 'end' | 'aborted', listener: () => void): void;
  off(event: 'error', listener: (error: unknown) => void): void;
  on(event: 'data', listener: (chunk: string | Uint8Array) => void): void;
  on(event: 'end' | 'aborted', listener: () => void): void;
  on(event: 'error', listener: (error: unknown) => void): void;
}

async function resolveSafeOutboundTarget(rawUrl: unknown, options: { signal?: AbortSignal } = {}): Promise<SafeOutboundTarget> {
  let parsedUrl: URL;

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

  let resolvedAddresses: LookupAddress[] = [];

  try {
    resolvedAddresses = await waitForAbortable(
      dns.lookup(hostname, { all: true, verbatim: true }),
      options.signal
    );
  } catch {
    options.signal?.throwIfAborted();
    throw createInvalidUrlError('Unable to resolve outbound host');
  }

  if (!Array.isArray(resolvedAddresses) || resolvedAddresses.length === 0) {
    throw createInvalidUrlError('Unable to resolve outbound host');
  }

  if (resolvedAddresses.some((entry) => isPrivateAddress(entry.address))) {
    throw createForbiddenUrlError();
  }

  const { address, family } = resolvedAddresses.find((entry) => entry.family === 4) || resolvedAddresses[0];

  return {
    url: parsedUrl.toString(),
    hostname,
    address,
    family
  };
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address?: string, family?: number) => void;

function createPinnedLookup(target: SafeOutboundTarget) {
  return (hostname: string, options: LookupOptions | LookupCallback, callback?: LookupCallback) => {
    const done = typeof options === 'function' ? options : callback;
    if (!done) {
      throw new Error('Outbound lookup callback is required');
    }
    const normalizedHostname = normalizeHostname(hostname);
    if (normalizedHostname !== target.hostname) {
      done(new Error(`Unexpected outbound hostname lookup: ${hostname}`));
      return;
    }

    done(null, target.address, target.family);
  };
}

function isReadableResponse(value: unknown): value is ReadableResponse {
  return Boolean(value && typeof value === 'object' && 'on' in value && typeof value.on === 'function');
}

async function readResponseText(responseData: unknown, maxResponseBytes: number): Promise<string> {
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

  if (!isReadableResponse(responseData)) {
    return '';
  }

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    let settled = false;

    const cleanup = () => {
      responseData.off('data', onData);
      responseData.off('end', onEnd);
      responseData.off('error', onError);
      responseData.off('aborted', onAborted);
    };

    const finish = <T>(handler: (value: T) => void, value: T) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      handler(value);
    };

    const onData = (chunk: string | Uint8Array) => {
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
    const onError = (error: unknown) => finish(reject, error);
    const onAborted = () => finish(reject, createError(502, 'Outbound response was aborted', 'CONNECTION_ERROR'));

    responseData.on('data', onData);
    responseData.on('end', onEnd);
    responseData.on('error', onError);
    responseData.on('aborted', onAborted);
  });
}

function destroyResponseData(responseData: unknown) {
  if (isReadableResponse(responseData)) {
    responseData.destroy();
  }
}

async function fetchSafeTextUrl(rawUrl: unknown, requestConfig: SafeRequestConfig = {}): Promise<AxiosResponse<string> & {
  finalUrl: string;
  resolvedAddress: string;
}> {
  requestConfig.signal?.throwIfAborted();
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
    transformResponse: [(data: unknown) => data],
    validateStatus: () => true
  };
  let currentTarget = await resolveSafeOutboundTarget(rawUrl, requestConfig);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    requestConfig.signal?.throwIfAborted();
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
      currentTarget = await resolveSafeOutboundTarget(new URL(redirectLocation, currentTarget.url).toString(), requestConfig);
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

export = {
  fetchSafeTextUrl
};
