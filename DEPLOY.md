# Deployment Guide: GCP with Docker + Cloudflare

Production deployment guide for running Qdrant MCP Server on GCP with Docker, behind Cloudflare proxy.

## Architecture

```
[Team Members]
    ↓ (HTTPS via Cloudflare)
[mcp.podiem.io] ← Cloudflare Access (Layer 1)
    ↓ (HTTPS)
[Nginx/Cloudflare Edge]
    ↓
[GCP VM Instance]
    ├── qdrant-mcp-server (Docker, port 3000)
    │       ↓ (EMBEDDING_API_KEY auth - Layer 2)
    │
    ├── qdrant.podiem.io (Docker, port 6333)
    └── ollama.podiem.io (Docker, port 11434)
```

## Prerequisites

- GCP VM instance with Docker installed
- Existing Qdrant container running (`qdrant.podiem.io`)
- Existing Ollama container running (`ollama.podiem.io`)
- Cloudflare DNS configured for your domain
- Cloudflare Zero Trust account (for Access policies)

---

## Step 1: Build and Prepare

### 1.1 Clone Repository

```bash
# SSH into GCP instance
gcloud compute ssh your-instance --zone your-zone

# Clone the repository
git clone https://github.com/your-org/qdrant-mcp-server.git
cd qdrant-mcp-server

# Install dependencies
npm install

# Build production bundle
npm run build
```

### 1.2 Verify Existing Services

```bash
# Check Qdrant is accessible
curl https://qdrant.podiem.io/health

# Check Ollama is accessible
curl https://ollama.podiem.io/api/version

# Verify embedding model is available
curl https://ollama.podiem.io/api/tags | grep nomic-embed-text
```

If model is missing:
```bash
docker exec ollama ollama pull nomic-embed-text
```

---

## Step 2: Docker Configuration

### 2.1 Create Dockerfile

```dockerfile
# Build stage
FROM node:22-bookworm AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:22-bookworm-slim

WORKDIR /app

# Copy built files
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --only=production

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
```

**Why Debian-based (`bookworm-slim`) instead of Alpine?**
- Tree-sitter (used for AST-aware code chunking) has native C bindings that may fail to compile on Alpine due to musl libc differences
- Better compatibility with native Node modules
- Slightly larger image size (~200MB vs ~150MB), but more reliable

### 2.2 Create Production Compose File

Create `compose.deploy.yaml`:

> **Note on naming**: Modern Docker Compose (v2+) uses `compose.yaml` or `compose.yml` (without hyphen).
> The older `docker-compose.yml` format was for v1 (standalone binary). Both work, but we follow
> the modern convention used throughout this project. If you prefer the old name, rename to
> `docker-compose.deploy.yml` and use `docker-compose` instead of `docker compose`.

```yaml
# Production compose for GCP deployment
# Uses existing Qdrant and Ollama containers

services:
  qdrant-mcp-server:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: qdrant-mcp-server
    ports:
      - "3000:3000"
    env_file:
      - .env.deploy
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    networks:
      - mcp-network
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "1.0"
        reservations:
          memory: 256M

networks:
  mcp-network:
    driver: bridge
```

---

## Step 3: Environment Configuration

### 3.1 Create `.env.deploy`

```bash
cp .env.example .env.deploy
```

Edit `.env.deploy`:

```env
# Transport Mode
TRANSPORT_MODE=http
HTTP_PORT=3000

# Qdrant Configuration (via Cloudflare)
QDRANT_URL=https://qdrant.podiem.io
QDRANT_API_KEY=your-qdrant-api-key-if-required

# Embedding Provider: Ollama (via Cloudflare)
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=https://ollama.podiem.io
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_DIMENSIONS=768

# Security Layer 2: API Key (shared with team)
EMBEDDING_API_KEY=generate-a-secure-token-here

# Rate Limiting (optional, adjust as needed)
EMBEDDING_MAX_REQUESTS_PER_MINUTE=1000
EMBEDDING_RETRY_ATTEMPTS=3
EMBEDDING_RETRY_DELAY=500

# Logging
LOG_LEVEL=info

# HTTP Server Settings
HTTP_REQUEST_TIMEOUT_MS=300000
```

**Generate a secure API key:**
```bash
openssl rand -hex 32
```

---

## Step 4: Cloudflare Configuration

### 4.1 Add DNS Record

In Cloudflare Dashboard:

1. Go to **DNS** → **Records**
2. Add new record:
   - **Type**: A
   - **Name**: `mcp`
   - **Content**: `<your-gcp-vm-external-ip>`
   - **Proxy status**: Proxied (orange cloud) ✅
3. Save

### 4.2 Configure Cloudflare Access (Layer 1)

1. Go to **Zero Trust** → **Access** → **Applications**
2. Click **Add an application**
3. Select **Self-hosted**
4. Configure:
   - **Application name**: `Qdrant MCP Server`
   - **Domain**: `mcp.podiem.io`
   - **Path**: `/mcp`
5. Add **Policies**:
   - **Policy name**: `Allow Team`
   - **Action**: Allow
   - **Configure rules**:
     - Email domain: `@yourcompany.com`
     - OR specific emails: `dev1@company.com`, `dev2@company.com`
6. Save

### 4.3 Test Cloudflare Access

```bash
# Should redirect to Cloudflare login
curl -I https://mcp.podiem.io/mcp

# After authentication, should return health check
curl https://mcp.podiem.io/health
```

---

## Step 5: Deploy

### 5.1 Build and Start

```bash
# Build Docker image
docker compose -f compose.deploy.yaml build

# Start service
docker compose -f compose.deploy.yaml up -d

# Verify container is running
docker compose -f compose.deploy.yaml ps

# Check logs
docker compose -f compose.deploy.yaml logs -f
```

### 5.2 Test Deployment

```bash
# Local health check
curl http://localhost:3000/health

# Via Cloudflare (requires Access authentication)
curl https://mcp.podiem.io/health

# Test MCP endpoint (should require auth)
curl https://mcp.podiem.io/mcp
```

### 5.3 Verify Qdrant and Ollama Connectivity

```bash
# From inside MCP container
docker exec qdrant-mcp-server wget -qO- https://qdrant.podiem.io/health
docker exec qdrant-mcp-server wget -qO- https://ollama.podiem.io/api/version
```

---

## Step 6: Team Access Setup

### 6.1 Share Connection Details

Provide team members with:

1. **MCP Server URL**: `https://mcp.podiem.io/mcp`
2. **API Key**: The value of `EMBEDDING_API_KEY` from `.env.deploy`

### 6.2 Claude Code Configuration

Team members add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "qdrant": {
      "type": "http",
      "url": "https://mcp.podiem.io/mcp",
      "env": {
        "EMBEDDING_API_KEY": "shared-team-token-from-env-deploy"
      }
    }
  }
}
```

### 6.3 First-Time Access Flow

1. User opens Claude Code
2. Claude connects to `mcp.podiem.io`
3. Cloudflare Access prompts for login (Layer 1)
4. After authentication, MCP server validates `EMBEDDING_API_KEY` (Layer 2)
5. Connection established ✅

---

## Step 7: Code Indexing Workflow

Since we now use **directory-based collection naming**, the workflow is:

### 7.1 One Developer Indexs the Codebase

```bash
# Developer A (on their machine)
/mcp__qdrant__index_codebase /path/to/saas-podiem-front
```

This creates collection: `code_saas-podiem-front`

### 7.2 All Team Members Can Search

```bash
# Developer B (different machine, different path)
/mcp__qdrant__search_code /different/path/saas-podiem-front "authentication logic"

# Developer C (also works!)
/mcp__qdrant__search_code /another/path/saas-podiem-front "database queries"
```

**Key**: As long as the directory name matches (`saas-podiem-front`), the search works!

---

## Security Architecture

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| **Layer 1** | Cloudflare Access | User authentication and authorization |
| **Layer 2** | `EMBEDDING_API_KEY` | API-level authentication |
| **Layer 3** | GCP Firewall | IP range restriction (optional) |
| **Layer 4** | Built-in Rate Limiting | 100 requests/15min per IP |
| **Layer 5** | HTTPS (Cloudflare) | Encryption in transit |

### GCP Firewall Rules (Optional Layer 3)

```bash
# Restrict to specific IP ranges
gcloud compute firewall-rules create allow-mcp-internal \
    --allow tcp:3000 \
    --source-ranges=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 \
    --target-tags=mcp-server \
    --description="Allow MCP server from internal networks only"
```

---

## Maintenance

### Update MCP Server

```bash
cd /path/to/qdrant-mcp-server

# Pull latest changes
git pull

# Rebuild
docker compose -f compose.deploy.yaml build --no-cache

# Restart
docker compose -f compose.deploy.yaml down
docker compose -f compose.deploy.yaml up -d

# Verify
docker compose -f compose.deploy.yaml logs -f
```

### View Logs

```bash
# Follow logs
docker compose -f compose.deploy.yaml logs -f

# Last 100 lines
docker compose -f compose.deploy.yaml logs --tail=100

# JSON logs (for parsing)
docker compose -f compose.deploy.yaml logs --tail=50 | jq .
```

### Health Checks

```bash
# Container health
docker compose -f compose.deploy.yaml ps

# HTTP health
curl http://localhost:3000/health

# Via Cloudflare
curl https://mcp.podiem.io/health
```

### Restart Service

```bash
docker compose -f compose.deploy.yaml restart
```

### Stop Service

```bash
docker compose -f compose.deploy.yaml down
```

---

## Troubleshooting

### MCP Server Won't Start

```bash
# Check logs
docker compose -f compose.deploy.yaml logs

# Common issues:
# 1. Port 3000 already in use
# 2. Invalid .env.deploy values
# 3. Build failed
```

### Cannot Connect to Qdrant

```bash
# Test from host
curl https://qdrant.podiem.io/health

# Test from container
docker exec qdrant-mcp-server wget -qO- https://qdrant.podiem.io/health

# If SSL verification fails, you may need:
# QDRANT_URL=http://<qdrant-container-ip>:6333
```

### Cannot Connect to Ollama

```bash
# Test from host
curl https://ollama.podiem.io/api/version

# Test from container
docker exec qdrant-mcp-server wget -qO- https://ollama.podiem.io/api/tags

# Verify model is pulled
curl https://ollama.podiem.io/api/tags | grep nomic-embed-text
```

### Cloudflare Access Blocking Requests

```bash
# Check Access logs in Cloudflare Dashboard
# Zero Trust → Logs → Access

# Verify your email is in allowed list
# Zero Trust → Access → Applications → Qdrant MCP Server → Policies
```

### API Key Authentication Fails

```bash
# Verify EMBEDDING_API_KEY matches in:
# 1. .env.deploy on server
# 2. Claude config env on client

# Test with curl
curl -H "X-Api-Key: your-token" https://mcp.podiem.io/mcp
```

---

## Monitoring and Alerts

### Docker Resource Usage

```bash
# CPU and memory
docker stats qdrant-mcp-server

# Disk usage
docker system df
```

### Set Up Cloudflare Analytics

- Go to **Analytics** → **Logs**
- Filter by `mcp.podiem.io`
- Monitor request patterns and errors

### Prometheus Metrics (Future Enhancement)

Consider adding `/metrics` endpoint for:
- Request count
- Error rates
- Latency percentiles
- Embedding cache hit rate

---

## Backup and Recovery

### Qdrant Data Backup

```bash
# Qdrant data is in Docker volume
docker run --rm \
  -v qdrant_data:/source:ro \
  -v $(pwd):/backup \
  alpine tar czf /backup/qdrant-backup-$(date +%Y%m%d).tar.gz -C /source .

# Store in GCS
gsutil cp qdrant-backup-*.tar.gz gs://your-backup-bucket/
```

### MCP Server Config Backup

```bash
# Backup .env.deploy
gsutil cp .env.deploy gs://your-backup-bucket/mcp-env-$(date +%Y%m%d).env

# Backup compose file
gsutil cp compose.deploy.yaml gs://your-backup-bucket/
```

---

## Cost Estimation

### GCP Resources (Monthly)

| Resource | Specification | Estimated Cost |
|----------|--------------|----------------|
| Compute Engine | e2-medium (2 vCPU, 4GB RAM) | ~$25-30 |
| Cloudflare | Free tier (Access included) | $0 |
| Storage | 20GB SSD | ~$3 |
| **Total** | | **~$28-33/month** |

### Scaling

For larger teams or codebases:

- **Upgrade to e2-standard-2** (2 vCPU, 8GB RAM) - ~$50/month
- **Add more Ollama models** - increase disk space
- **Enable Cloudflare cache** for better performance

---

## Next Steps

- [ ] Set up CI/CD pipeline for automated deployments
- [ ] Add Prometheus + Grafana monitoring
- [ ] Configure automated backups
- [ ] Set up Slack alerts for downtime
- [ ] Document team-specific workflows
