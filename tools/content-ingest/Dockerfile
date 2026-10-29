# Runs the content pipeline against the repository's content/ and contracts/.
# The compose file mounts both directories, so the image stays read-only.
FROM node:24-alpine

WORKDIR /app/tools/content-ingest
COPY tools/content-ingest/package.json tools/content-ingest/package-lock.json ./
RUN npm ci --omit=dev
COPY tools/content-ingest/ ./

WORKDIR /app
ENTRYPOINT ["node", "/app/tools/content-ingest/cli.mjs"]
