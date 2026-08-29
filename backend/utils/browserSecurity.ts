import type { RequestHandler } from 'express';
import type { IncomingHttpHeaders } from 'node:http';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface RequestLike {
  headers?: IncomingHttpHeaders;
  method?: string;
  protocol?: string;
  socket?: unknown;
}

interface SameOriginOptions {
  allowMissingHeaders?: boolean;
  allowSafeMethods?: boolean;
}

function getRequestHeader(req: RequestLike, name: string): string | undefined {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getConfiguredAppOrigin(): string {
  const configuredUrl = String(process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || '').trim();
  if (!configuredUrl) {
    return '';
  }

  try {
    return new URL(configuredUrl).origin;
  } catch {
    return configuredUrl;
  }
}

function getExpectedRequestOrigin(req: RequestLike): string {
  const configuredOrigin = getConfiguredAppOrigin();
  if (configuredOrigin) {
    return configuredOrigin;
  }

  const encrypted = Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted);
  const forwardedProtocol = getTrustProxySetting() !== false
    ? String(getRequestHeader(req, 'x-forwarded-proto') || '').split(',')[0].trim()
    : '';
  const protocol = req.protocol || forwardedProtocol || (encrypted ? 'https' : 'http');
  return `${protocol}://${getRequestHeader(req, 'host')}`;
}

function headerMatchesExpectedOrigin(value: string | undefined, expectedOrigin: string): boolean {
  if (!value) {
    return false;
  }

  try {
    return new URL(value).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function hasSameOriginRequestHeaders(req: RequestLike, options: SameOriginOptions = {}): boolean {
  const expectedOrigin = getExpectedRequestOrigin(req);
  const origin = getRequestHeader(req, 'origin');
  const referer = getRequestHeader(req, 'referer');

  return (!origin && !referer && options.allowMissingHeaders === true)
    || headerMatchesExpectedOrigin(origin, expectedOrigin)
    || (!origin && headerMatchesExpectedOrigin(referer, expectedOrigin));
}

function requireSameOriginRequest(options: SameOriginOptions = {}): RequestHandler {
  return (req, res, next) => {
    const isSafeMethod = options.allowSafeMethods === true && SAFE_METHODS.has(req.method.toUpperCase());
    if (hasSameOriginRequestHeaders(req, {
      ...options,
      allowMissingHeaders: options.allowMissingHeaders === true || isSafeMethod,
    })) {
      next();
      return;
    }

    res.status(403).json({
      error: {
        message: 'Cross-origin request rejected.',
        code: 'CSRF_ORIGIN_MISMATCH',
      },
    });
  };
}

function getTrustProxySetting(value = process.env.TRUST_PROXY): boolean | number | string | string[] {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.toLowerCase() === 'false') {
    return false;
  }
  if (normalized.toLowerCase() === 'true') {
    return 1;
  }
  if (/^\d+$/u.test(normalized)) {
    return Number(normalized);
  }

  const entries = normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 1 ? entries : normalized;
}

export = {
  getTrustProxySetting,
  hasSameOriginRequestHeaders,
  requireSameOriginRequest,
};
