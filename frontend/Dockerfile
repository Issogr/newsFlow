# Build stage
FROM node:18-alpine AS build

# Imposta la directory di lavoro
WORKDIR /app

# Copia i file di configurazione delle dipendenze
COPY package*.json ./

# Installa le dipendenze
RUN npm install

# Copia il resto del codice sorgente
COPY . .

# Costruisci l'applicazione
RUN npm run build

# Production stage
FROM nginx:alpine

# Copia la configurazione nginx personalizzata
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Rimuovi i file predefiniti
RUN rm -rf /usr/share/nginx/html/*

# Copia i file buildati dall'app React
COPY --from=build /app/build /usr/share/nginx/html

# Esponi la porta 80
EXPOSE 80

# Avvia nginx
CMD ["nginx", "-g", "daemon off;"]