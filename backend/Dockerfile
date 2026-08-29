# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:24.20.0-bookworm-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN --mount=type=cache,id=newsflow-frontend-npm,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM node:24.20.0-bookworm-slim AS backend-build

ARG TARGETARCH

# Imposta la directory di lavoro
WORKDIR /app/backend

# Copia i file di configurazione delle dipendenze
COPY backend/package*.json ./

# Installa le dipendenze e compila TypeScript per la piattaforma target senza emulare npm sotto QEMU
RUN --mount=type=cache,id=newsflow-backend-npm,target=/root/.npm,sharing=locked \
    npm_arch="${TARGETARCH:-$(node -p 'process.arch')}" && \
    if [ "$npm_arch" = "amd64" ]; then npm_arch="x64"; fi && \
    npm_config_os=linux npm_config_cpu="$npm_arch" npm_config_libc=glibc npm ci --no-audit --no-fund

COPY backend/tsconfig*.json ./
COPY backend/app.ts backend/server.ts ./
COPY backend/config ./config
COPY backend/routes ./routes
COPY backend/services ./services
COPY backend/utils ./utils

RUN npm run build && npm prune --omit=dev

# Production stage
FROM node:24.20.0-bookworm-slim

# Crea un utente non-root
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --home-dir /usr/src/app --shell /usr/sbin/nologin --no-create-home nodeuser

# Imposta la directory di lavoro
WORKDIR /usr/src/app

# Copia i node_modules dalla fase di build
COPY --from=backend-build /app/backend/node_modules ./node_modules

# Copia solo gli artefatti e i metadati necessari in produzione
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/package*.json ./
COPY --from=frontend-build /app/frontend/dist ./public

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
  CMD node -e "fetch('http://127.0.0.1:5000/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Comando di avvio
CMD ["node", "--enable-source-maps", "dist/server.js"]
