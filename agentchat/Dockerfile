FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 6667

CMD ["node", "bin/agentchat.js", "serve"]
