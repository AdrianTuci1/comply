# Content library, ingestion pipeline and email-link sessions. No npm dependencies.
FROM node:24-alpine

WORKDIR /app
COPY src/server/api ./src/server/api

WORKDIR /app/src/server/api

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4300

EXPOSE 4300

CMD ["node", "server.mjs"]
