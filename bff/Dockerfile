FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS bff-deps

WORKDIR /app/bff

RUN apk add --no-cache python3 make g++

COPY bff/package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine

WORKDIR /app/bff
ENV NODE_ENV=production
ENV PORT=80

COPY --from=bff-deps /app/bff/node_modules ./node_modules
COPY bff/package*.json ./
COPY bff/server.js ./server.js
COPY --from=frontend-build /app/frontend/dist ./public
RUN mkdir -p data && chown -R node:node /app/bff

USER node

EXPOSE 80

CMD ["node", "server.js"]
