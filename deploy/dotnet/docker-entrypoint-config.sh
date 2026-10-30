#!/bin/sh
# Rewrites config.js at container start so the API origin can change without a rebuild,
# mirroring the post-deploy config.js edit on a CDN or Static Web App.
set -eu

api_base="${COMPLY_API_BASE:-http://localhost:7071}"
api_base="${api_base%/}"
escaped=$(printf '%s' "$api_base" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g")

cat > /usr/share/nginx/html/config.js <<EOF
globalThis.COMPLY_CONFIG = { apiBase: '${escaped}' };
EOF

echo "config.js apiBase=${api_base}"
