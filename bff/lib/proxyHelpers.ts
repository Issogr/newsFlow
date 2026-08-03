import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { Request, Response } from 'express';

const BLOCKED_BACKEND_RESPONSE_HEADERS = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export type ProxyRequest = IncomingMessage & Partial<Pick<Request, 'get' | 'ip' | 'protocol'>> & {
  socket: IncomingMessage['socket'] & { encrypted?: boolean };
};

interface ForwardedHeaderOptions {
  includeEmpty?: boolean;
}

interface ProxyRequestHeaderOptions {
  mode?: 'private';
  internalHeaders?: Record<string, string>;
  backendSessionCookie?: string;
}

type ResponseHeaders = Record<string, string | string[] | undefined>;

export function getRequestHeader(req: ProxyRequest, name: string): string | undefined {
  const value = typeof req.get === 'function'
    ? req.get(name)
    : req.headers?.[String(name || '').toLowerCase()];

  return Array.isArray(value) ? value[0] : value;
}

export function buildTrustedForwardedHeaders(
  req: ProxyRequest,
  options: ForwardedHeaderOptions = {},
): Record<string, string> {
  const forwardedFor = String(req.ip || req.socket?.remoteAddress || '').trim();
  const forwardedProto = req.protocol || (req.socket?.encrypted ? 'https' : 'http');
  const forwardedHost = String(getRequestHeader(req, 'host') || '').trim();
  const headers: Record<string, string> = {};

  if (forwardedFor || options.includeEmpty) {
    headers['x-forwarded-for'] = forwardedFor;
  }

  if (forwardedHost || options.includeEmpty) {
    headers['x-forwarded-host'] = forwardedHost;
  }

  headers['x-forwarded-proto'] = forwardedProto;

  return headers;
}

export function applyProxyRequestHeaders(
  proxyReq: ClientRequest,
  req: ProxyRequest,
  options: ProxyRequestHeaderOptions = {},
): void {
  proxyReq.removeHeader('x-forwarded-for');
  proxyReq.removeHeader('x-forwarded-host');
  proxyReq.removeHeader('x-forwarded-proto');

  if (options.mode === 'private') {
    proxyReq.removeHeader('authorization');
    proxyReq.removeHeader('origin');
    proxyReq.removeHeader('x-session-token');
    proxyReq.removeHeader('x-newsflow-app');
    Object.entries(options.internalHeaders || {}).forEach(([name, value]) => {
      proxyReq.setHeader(name, value);
    });

    if (options.backendSessionCookie) {
      proxyReq.setHeader('cookie', options.backendSessionCookie);
    } else {
      proxyReq.removeHeader('cookie');
    }
    return;
  }

  proxyReq.removeHeader('cookie');
  Object.entries(buildTrustedForwardedHeaders(req)).forEach(([name, value]) => {
    proxyReq.setHeader(name, value);
  });
}

export function copyBackendResponseHeaders(res: Response, headers: ResponseHeaders = {}): void {
  Object.entries(headers).forEach(([name, value]) => {
    const lowerName = String(name || '').toLowerCase();

    if (BLOCKED_BACKEND_RESPONSE_HEADERS.has(lowerName) || lowerName.startsWith('access-control-')) {
      return;
    }

    if (value !== undefined) {
      res.setHeader(name, value);
    }
  });
}

export function stripBackendCorsResponseHeaders(headers: IncomingHttpHeaders = {}): void {
  Object.keys(headers).forEach((name) => {
    if (String(name).toLowerCase().startsWith('access-control-')) {
      delete headers[name];
    }
  });
}
