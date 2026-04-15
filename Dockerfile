# Build stage
FROM node:22-bookworm AS builder

WORKDIR /app

# Install build dependencies for native modules (tree-sitter)
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 \
  build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:22-bookworm-slim

WORKDIR /app

# Copy built files and all dependencies (including native modules)
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Environment variables
ENV TRANSPORT_MODE=http
ENV HTTP_PORT=3000
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start server
CMD ["node", "build/index.js"]
