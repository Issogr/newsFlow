# syntax=docker/dockerfile:1.7

# Build stage
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build

ARG TARGETARCH

# Imposta la directory di lavoro
WORKDIR /app

# Copia i file di configurazione delle dipendenze
COPY package*.json ./

# Installa le dipendenze di produzione per la piattaforma target senza emulare npm sotto QEMU
RUN --mount=type=cache,id=newsflow-backend-npm,target=/root/.npm,sharing=locked \
    npm_arch="${TARGETARCH:-$(node -p 'process.arch')}" && \
    if [ "$npm_arch" = "amd64" ]; then npm_arch="x64"; fi && \
    npm_config_platform=linux npm_config_arch="$npm_arch" npm_config_libc=glibc npm ci --omit=dev --no-audit --no-fund

# Production stage
FROM node:24-bookworm-slim

# Crea un utente non-root
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates wget && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --home-dir /usr/src/app --shell /usr/sbin/nologin --no-create-home nodeuser

# Imposta la directory di lavoro
WORKDIR /usr/src/app

# Copia i node_modules dalla fase di build
COPY --from=build /app/node_modules ./node_modules

# Copia il codice
COPY . .

# Crea la directory dati e imposta i permessi
RUN mkdir -p data && \
    chown -R nodeuser:nodejs data

# Esponi la porta
EXPOSE 5000

# Imposta le variabili d'ambiente
ENV NODE_ENV=production
ENV PORT=5000

# Esegui l'app come utente non-root
USER nodeuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

# Comando di avvio
CMD ["node", "server.js"]
