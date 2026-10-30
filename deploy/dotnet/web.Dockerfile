# Static hosting for the split deployment: builds the Angular app and serves it with nginx.
# The API and MCP endpoint live on the .NET Functions host, so nothing is proxied here.
# Build from the repository root:
#   docker build -f deploy/dotnet/web.Dockerfile -t comply/web .
FROM node:24-alpine AS build

WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
RUN npm run build

FROM nginx:1.27-alpine

RUN mkdir -p /etc/nginx/snippets
COPY deploy/dotnet/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/dotnet/nginx-headers.conf /etc/nginx/snippets/comply-headers.conf
COPY deploy/dotnet/docker-entrypoint-config.sh /docker-entrypoint.d/40-comply-config.sh
RUN chmod +x /docker-entrypoint.d/40-comply-config.sh

COPY --from=build /app/dist/web/browser/ /usr/share/nginx/html/

# Rewritten into config.js on every start; the API origin for the split deployment.
ENV COMPLY_API_BASE=http://localhost:7071

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
