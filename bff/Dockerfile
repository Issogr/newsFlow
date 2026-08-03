# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:24.18.1-bookworm-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN --mount=type=cache,id=newsflow-frontend-npm,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM node:24.18.1-bookworm-slim AS bff-build

WORKDIR /app/bff

COPY bff/package*.json ./
RUN --mount=type=cache,id=newsflow-bff-npm,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

COPY bff/tsconfig*.json ./
COPY bff/server.ts ./
COPY bff/lib ./lib
RUN npm run build && npm prune --omit=dev

FROM node:24.18.1-bookworm-slim

WORKDIR /app/bff
ENV NODE_ENV=production
ENV PORT=80

COPY --from=bff-build /app/bff/node_modules ./node_modules
COPY bff/package*.json ./
COPY --from=bff-build /app/bff/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./public
RUN mkdir -p data && chown -R node:node /app/bff

USER node

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/server.js"]
