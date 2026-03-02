const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const apiRoutes = require('./routes/api');
const logger = require('./utils/logger');
const { errorMiddleware, createError } = require('./utils/errorHandler');
const path = require('path');
const fs = require('fs');
const http = require('http');
const websocketService = require('./services/websocketService');
const { getAllowedOrigins, isOriginAllowed } = require('./utils/networkConfig');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = getAllowedOrigins();
logger.info(`Allowed origins configurate: ${allowedOrigins.join(', ')}`);

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', true);
} else if (process.env.TRUST_PROXY === 'false') {
  app.set('trust proxy', false);
} else {
  app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
}

// Aumenta il timeout del server per gestire richieste più lunghe
const SERVER_TIMEOUT = parseInt(process.env.SERVER_TIMEOUT || '60000', 10); // 60 secondi

// Middleware di sicurezza potenziati
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"], // Aggiunto per WebSockets
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  xssFilter: true,
  noSniff: true,
  referrerPolicy: { policy: 'same-origin' },
}));

// CORS configurato solo per origini specifiche
app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin, allowedOrigins)) {
      return callback(null, true);
    }

    logger.warn(`Richiesta CORS bloccata per origin non consentita: ${origin || 'unknown'}`);
    return callback(createError(403, 'Origine non consentita', 'FORBIDDEN'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
  credentials: true,
  maxAge: 86400 // 24 ore
}));

// Limita la dimensione del payload
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Configurazione logging migliorata
app.use(morgan('combined', { 
  stream: { 
    write: message => logger.info(message.trim()) 
  },
  skip: (req) => req.url === '/health' // Evita log eccessivi per endpoint health
}));

// [MIGLIORATO] Sistema di rate limiting più granulare
// Configurazione di base più restrittiva
const baseRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 200, // Richieste per IP nel periodo
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip, // Usa solo IP anziché IP + path
  skip: (req) => req.path === '/health', // Skip rate limit per health check
  message: { 
    error: { 
      message: 'Troppe richieste, riprova più tardi',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  }
});

// Rate limit più restrittivo per operazioni di ricerca
const searchRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minuti
  max: 30, // 30 richieste per finestra
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { 
    error: { 
      message: 'Troppe richieste di ricerca, riprova più tardi',
      code: 'SEARCH_RATE_LIMIT_EXCEEDED'
    }
  }
});

// Rate limit specifico per operazioni di refresh
const refreshRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 3, // 3 richieste al minuto
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { 
    error: { 
      message: 'Troppe richieste di aggiornamento, riprova più tardi',
      code: 'REFRESH_RATE_LIMIT_EXCEEDED'
    }
  }
});

// Rate limit per operazioni WebSocket
const wsRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minuti
  max: 60, // 60 richieste per finestra
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { 
    error: { 
      message: 'Troppe richieste WebSocket, riprova più tardi',
      code: 'WS_RATE_LIMIT_EXCEEDED'
    }
  }
});

// Applica i rate limiter ai percorsi specifici
app.use('/api', baseRateLimit);
app.use('/api/news/search', searchRateLimit);
app.use('/api/refresh', refreshRateLimit);
app.use('/api/ws', wsRateLimit);

// Crea cartella logs se non esiste
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Routes
app.use('/api', apiRoutes);

// Health check route con informazioni WebSocket
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const wsStats = websocketService.getStatistics();
  
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime),
    memory: process.memoryUsage(),
    websocket: {
      active: wsStats.activeConnectionsCount,
      total: wsStats.totalConnections
    }
  });
});

// WebSocket status route
app.get('/api/ws/status', (req, res) => {
  const wsStats = websocketService.getStatistics();
  res.json(wsStats);
});

// Gestione 404 migliorata
app.use((req, res, next) => {
  const error = new Error(`Risorsa non trovata: ${req.originalUrl}`);
  error.status = 404;
  error.code = 'RESOURCE_NOT_FOUND';
  next(error);
});

// Middleware per gestione errori centralizzata
app.use(errorMiddleware);

// Crea server HTTP separato per permettere a Socket.IO di connettersi
const server = http.createServer(app);

// Inizializza il servizio WebSocket
websocketService.initialize(server);

// Avvia il server
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} with WebSocket support`);
});

// Gestione timeout migliorata
server.timeout = SERVER_TIMEOUT;
server.keepAliveTimeout = 65000; // Leggermente più alto di CLIENT_HEADER_TIMEOUT
server.headersTimeout = 66000; // Leggermente più alto di KEEP_ALIVE_TIMEOUT

// Gestione shutdown graceful
process.on('SIGTERM', () => {
  logger.info('SIGTERM ricevuto. Shutdown graceful in corso...');
  server.close(() => {
    logger.info('Server HTTP terminato.');
    process.exit(0);
  });
  
  // Se il server non si chiude entro 10 secondi, forza la chiusura
  setTimeout(() => {
    logger.error('Impossibile chiudere le connessioni in tempo, forzatura terminazione');
    process.exit(1);
  }, 10000);
});

module.exports = server; // Export per eventuali test futuri
