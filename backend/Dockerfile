# Build stage
FROM node:18-alpine AS build

# Imposta la directory di lavoro
WORKDIR /app

# Copia i file di configurazione delle dipendenze
COPY package*.json ./

# Installa le dipendenze di produzione
RUN npm install --production

# Production stage
FROM node:18-alpine

# Crea un utente non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nodeuser

# Installa dipendenze per il parsing HTML
RUN apk add --no-cache --virtual .gyp python3 make g++

# Imposta la directory di lavoro
WORKDIR /usr/src/app

# Copia i node_modules dalla fase di build
COPY --from=build /app/node_modules ./node_modules

# Copia il codice
COPY . .

# Crea le directory necessarie e imposta i permessi
RUN mkdir -p logs && \
    mkdir -p data && \
    chown -R nodeuser:nodejs logs && \
    chown -R nodeuser:nodejs data

# Esponi la porta
EXPOSE 5000

# Imposta le variabili d'ambiente
ENV NODE_ENV=production
ENV PORT=5000

# Esegui l'app come utente non-root
USER nodeuser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

# Comando di avvio
CMD ["node", "server.js"]