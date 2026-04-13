FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM node:22-alpine AS bff-deps

WORKDIR /app/bff

COPY bff/package*.json ./
RUN npm install --omit=dev

FROM node:22-alpine

WORKDIR /app/bff
ENV NODE_ENV=production
ENV PORT=80

COPY --from=bff-deps /app/bff/node_modules ./node_modules
COPY bff/package*.json ./
COPY bff/server.js ./server.js
COPY --from=frontend-build /app/frontend/dist ./public

EXPOSE 80

CMD ["node", "server.js"]
