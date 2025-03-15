FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --production

COPY . .

# Create logs directory
RUN mkdir -p logs

EXPOSE 5000

CMD ["node", "server.js"]