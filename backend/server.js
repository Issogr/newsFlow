const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const apiRoutes = require('./routes/api');
const logger = require('./utils/logger');
const { errorMiddleware } = require('./utils/errorHandler');
const path = require('path');
const fs = require('fs'); // Aggiunto import di fs

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5000;

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
      connectSrc: ["'self'"],
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
  origin: process.env.NODE_ENV === 'production' 
    ? ['http://localhost', 'http://localhost:80', 'http://frontend'] 
    : true,
  methods: ['GET'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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

// Rate limiting migliorato con finestre separate per ogni endpoint
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 200, // 200 richieste per finestra
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Usa sia IP che endpoint come chiave per limitare diversamente in base all'endpoint
    return `${req.ip}-${req.path}`;
  },
  skip: (req) => req.path === '/health', // Skip rate limit per health check
  message: { 
    error: { 
      message: 'Troppe richieste, riprova più tardi',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  }
});

app.use('/api', apiLimiter);

// Crea cartella logs se non esiste
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Routes
app.use('/api', apiRoutes);

// Health check route migliorato
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime),
    memory: process.memoryUsage()
  });
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

// Imposta il timeout del server
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
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