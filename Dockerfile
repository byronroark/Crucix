FROM node:22-bookworm-slim

WORKDIR /app

# curl + CA bundle; Debian curl TLS differs from Alpine (Cloudflare on acleddata.com)
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy package files first for better layer caching
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

# Default port (override with -e PORT=xxxx)
EXPOSE 3117

# Health check
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD curl -sf "http://localhost:${PORT:-3117}/api/health" || exit 1

CMD ["node", "server.mjs"]
