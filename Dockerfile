FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 6667

CMD ["node", "dist/bin/agentchat.js", "serve"]
