const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const apiRoutes = require('./routes/api');
const logger = require('./utils/logger');
const { errorMiddleware } = require('./utils/errorHandler');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5000;

// Aumenta il timeout del server per gestire richieste più lunghe
const SERVER_TIMEOUT = parseInt(process.env.SERVER_TIMEOUT || '60000', 10); // 60 secondi

// Determina l'ambiente
const isProduction = process.env.NODE_ENV === 'production';

// Configura CORS in modo più sicuro
const corsOptions = {
  origin: process.env.CORS_ORIGIN || (isProduction ? 
    ['http://localhost', 'http://frontend'] : '*'),
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24 ore
};

// Middleware
app.use(helmet({
  contentSecurityPolicy: isProduction ? undefined : false,
})); // Security headers
app.use(cors(corsOptions)); // CORS configurato
app.use(express.json()); // Parse JSON requests

// Logging delle richieste migliorato
app.use(morgan('combined', { 
  stream: { 
    write: message => logger.http(message.trim()) 
  },
  skip: (req, res) => {
    // In produzione, salta il logging delle richieste ai path di health check
    // per ridurre il rumore nei log
    return isProduction && req.path === '/health';
  }
}));

// Configura rate limiting più intelligente
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  // Non applicare limiti agli health check
  skip: (req, res) => req.path === '/health' || req.path === '/api/health',
  // Messaggio personalizzato
  message: {
    error: {
      message: 'Troppe richieste, riprova più tardi.',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  }
});

// Applica rate limiting solo alle routes API
app.use('/api', limiter);

// Routes
app.use('/api', apiRoutes);

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Route 404 per gestire i percorsi non trovati
app.use((req, res, next) => {
  res.status(404).json({
    error: {
      message: 'Risorsa non trovata',
      code: 'NOT_FOUND'
    }
  });
});

// Error handling middleware (deve essere l'ultimo middleware)
app.use(errorMiddleware);

// Imposta il timeout del server
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

server.timeout = SERVER_TIMEOUT;

// Configurazione pulizia cache
const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 ora

/**
 * Funzione per pulire la cache e prevenire memory leaks
 */
function cleanupMemoryCache() {
  try {
    const cache = require('memory-cache');
    
    // Pulizia dei job asincroni
    const asyncProcessor = require('./services/asyncProcessor');
    asyncProcessor.cleanupJobs();
    
    // Log pulizia completata
    logger.debug('Memory cache cleanup executed');
  } catch (err) {
    logger.error(`Error during cache cleanup: ${err.message}`);
  }
}

// Imposta pulizia periodica della cache
setInterval(cleanupMemoryCache, CACHE_CLEANUP_INTERVAL);
logger.info(`Cache cleanup scheduled every ${CACHE_CLEANUP_INTERVAL / 60000} minutes`);

// Gestione degli errori non catturati
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // In produzione è meglio riavviare il processo tramite un process manager come PM2
  if (isProduction) {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Gestione segnali di terminazione
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

module.exports = server; // Per test