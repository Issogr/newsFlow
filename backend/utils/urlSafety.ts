import { promises as dns } from 'node:dns';
import net from 'node:net';
import axios from 'axios';
import { createError } from './errorHandler';
import { parseIntegerEnv } from './env';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { LookupAddress, LookupOptions } from 'node:dns';
import type { AppError } from './types';
import type { Readable } from 'node:stream';

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

const blockedAddresses = new net.BlockList();
UNSAFE_IPV4_RANGES.forEach(([address, prefix]) => blockedAddresses.addSubnet(address, prefix, 'ipv4'));
const unsafeIpv6Ranges: Array<[string, number]> = [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]
];
unsafeIpv6Ranges.forEach(([address, prefix]) => blockedAddresses.addSubnet(address, prefix, 'ipv6'));

function isPrivateAddress(address: string) {
  const type = net.isIP(address);
  return type !== 0 && blockedAddresses.check(address, type === 4 ? 'ipv4' : 'ipv6');
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

function isReadableResponse(value: unknown): value is Readable {
  return Boolean(value && typeof value === 'object' && Symbol.asyncIterator in value && 'destroy' in value);
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

  const chunks: Buffer[] = [];
  let totalLength = 0;
  try {
    for await (const chunk of responseData) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalLength += buffer.length;
      if (totalLength > maxResponseBytes) {
        throw createOversizedResponseError(maxResponseBytes);
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if ((error as AppError).code === 'ERR_STREAM_PREMATURE_CLOSE') {
      throw createError(502, 'Outbound response was aborted', 'CONNECTION_ERROR');
    }
    throw error;
  }
  return Buffer.concat(chunks).toString('utf8');
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
    ? requestConfig.maxRedirects!
    : MAX_REDIRECTS;
  const maxResponseBytes = normalizeMaxResponseBytes(requestConfig.maxResponseBytes);
  const {
    maxResponseBytes: ignoredMaxResponseBytes,
    responseType: ignoredResponseType,
    transformResponse: ignoredTransformResponse,
    lookup: ignoredLookup,
    ...baseRequestConfig
  } = requestConfig;
  const axiosConfig: AxiosRequestConfig = {
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
      lookup: createPinnedLookup(currentTarget) as AxiosRequestConfig['lookup']
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

export default {
  fetchSafeTextUrl
};
