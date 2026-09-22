import { BlockList } from 'node:net';

const DEFAULT_PROD_ORIGINS = ['http://localhost', 'http://localhost:80', 'http://127.0.0.1', 'http://127.0.0.1:80'];

const localIpv4Addresses = new BlockList();
localIpv4Addresses.addSubnet('10.0.0.0', 8, 'ipv4');
localIpv4Addresses.addSubnet('127.0.0.0', 8, 'ipv4');
localIpv4Addresses.addSubnet('192.168.0.0', 16, 'ipv4');
localIpv4Addresses.addSubnet('172.16.0.0', 12, 'ipv4');

function isLocalNetworkOrigin(origin: string) {
  try {
    const parsedOrigin = new URL(origin);
    const hostname = parsedOrigin.hostname.toLowerCase();

    return hostname === 'localhost'
      || hostname === '::1'
      || hostname.endsWith('.local')
      || localIpv4Addresses.check(hostname, 'ipv4');
  } catch {
    return false;
  }
}

function matchesAllowedOrigin(origin: string, allowedOrigin: string) {
  if (allowedOrigin === '*') {
    return true;
  }

  if (allowedOrigin === '@local-network') {
    return isLocalNetworkOrigin(origin);
  }

  if (allowedOrigin.includes('*')) {
    const pattern = new RegExp(`^${RegExp.escape(allowedOrigin).replace(/\\\*/g, '.*')}$`);
    return pattern.test(origin);
  }

  return allowedOrigin === origin;
}

function getAllowedOrigins() {
  const rawOrigins = process.env.ALLOWED_ORIGINS || '';
  const parsedOrigins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (parsedOrigins.length > 0) {
    return parsedOrigins;
  }

  if (process.env.NODE_ENV === 'production') {
    return DEFAULT_PROD_ORIGINS;
  }

  return ['*'];
}

function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) {
    return true;
  }

  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    return false;
  }

  return allowedOrigins.some((allowedOrigin) => matchesAllowedOrigin(origin, allowedOrigin));
}

export default {
  getAllowedOrigins,
  isOriginAllowed
};
