FROM node:18-alpine

WORKDIR /app

RUN npm install ws

COPY stub-server.mjs .

EXPOSE 6667

CMD ["node", "stub-server.mjs"]
