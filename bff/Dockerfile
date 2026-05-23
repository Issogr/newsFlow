# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN --mount=type=cache,id=newsflow-frontend-npm,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS bff-deps

ARG TARGETARCH

WORKDIR /app/bff

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY bff/package*.json ./
RUN --mount=type=cache,id=newsflow-bff-npm,target=/root/.npm,sharing=locked \
    npm_arch="${TARGETARCH:-$(node -p 'process.arch')}" && \
    if [ "$npm_arch" = "amd64" ]; then npm_arch="x64"; fi && \
    npm_config_platform=linux npm_config_arch="$npm_arch" npm_config_libc=glibc npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim

WORKDIR /app/bff
ENV NODE_ENV=production
ENV PORT=80

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates wget && \
    rm -rf /var/lib/apt/lists/*

COPY --from=bff-deps /app/bff/node_modules ./node_modules
RUN node -e "require('better-sqlite3')"
COPY bff/package*.json ./
COPY bff/server.js ./server.js
COPY bff/lib ./lib
COPY --from=frontend-build /app/frontend/dist ./public
RUN mkdir -p data && chown -R node:node /app/bff

USER node

EXPOSE 80

CMD ["node", "server.js"]
