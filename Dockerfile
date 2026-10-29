# One image serves the Angular build, the API, and the MCP endpoint on a single
# port. The same handler is wrapped by the Azure Functions entry point.
FROM node:24-alpine AS web

WORKDIR /app
COPY src/web/package.json src/web/package-lock.json ./
RUN npm ci
COPY src/web ./
RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app
COPY src/server/api ./src/server/api
COPY --from=web /app/dist/web/browser ./web

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV COMPLY_WEB_ROOT=/app/web
ENV COMPLY_DATA_DIR=/app/data

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server/api/server.mjs"]
