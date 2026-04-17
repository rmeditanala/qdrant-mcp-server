# Nginx Setup for MCP Server

Configure Nginx to expose the MCP server at `mcp.podiem.io`.

---

## Nginx Configuration

Create `/etc/nginx/sites-available/mcp-server`:

```nginx
server {
    listen 443 ssl;
    server_name mcp.podiem.io;

    # Cloudflare Origin Certificate (same as qdrant and ollama)
    ssl_certificate /etc/ssl/cloudflare/cert.pem;
    ssl_certificate_key /etc/ssl/cloudflare/key.pem;

    client_max_body_size 256M;

    location / {
        proxy_pass http://localhost:3000;

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # MCP SDK COMPATIBILITY FIX
        # Override Accept header to match MCP Streamable HTTP spec
        proxy_set_header Accept "application/json, text/event-stream";

        # SSE streaming support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Prevent buffering for SSE
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header X-Accel-Buffering no;
    }
}

server {
    listen 80;
    server_name mcp.podiem.io;
    return 301 https://$host$request_uri;
}
```

---

## Setup Steps

### Step 1: Create Config File

```bash
# SSH into your VM
gcloud compute ssh your-instance --zone your-zone

# Create the config file
sudo nano /etc/nginx/sites-available/mcp-server
```

Paste the config content above, save and exit.

### Step 2: Enable Site

```bash
# Create symlink to enable the site
sudo ln -s /etc/nginx/sites-available/mcp-server /etc/nginx/sites-enabled/

# Verify the symlink
ls -la /etc/nginx/sites-enabled/
# Should show: mcp-server -> /etc/nginx/sites-available/mcp-server
```

### Step 3: Test and Reload Nginx

```bash
# Test configuration
sudo nginx -t

# Should show:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful

# Reload Nginx
sudo systemctl reload nginx
```

---

## Cloudflare DNS Setup

Add DNS record in Cloudflare Dashboard:

1. Go to **DNS** → **Records**
2. Add new record:
   - **Type**: A
   - **Name**: `mcp`
   - **Content**: `<your-gcp-vm-external-ip>`
   - **Proxy status**: Proxied (orange cloud) ✅
3. Save

Wait 1-5 minutes for DNS propagation.

---

## Verify Setup

```bash
# Test local access
curl http://localhost:3000/health

# Test Nginx HTTP
curl -H "Host: mcp.podiem.io" http://localhost/health

# Test HTTPS via Cloudflare
curl https://mcp.podiem.io/health
```

Expected response:
```json
{"status":"ok"}
```

---

## Troubleshooting

### Nginx Fails to Start

```bash
# Check logs
sudo journalctl -u nginx --no-pager | tail -50

# Common issues:
# 1. SSL cert missing - verify /etc/ssl/cloudflare/cert.pem exists
# 2. Port already in use - check with: sudo ss -tlnp | grep -E '80|443'
# 3. Syntax error - run: sudo nginx -t
```

### 502 Bad Gateway

```bash
# MCP server not running or not accessible
docker compose -f ~/qdrant-mcp-server/compose.deploy.yaml ps

# Check if port 3000 is accessible
curl http://localhost:3000/health

# If not running, start it
cd ~/qdrant-mcp-server
docker compose -f compose.deploy.yaml up -d
```

### SSL Certificate Errors

```bash
# Verify cert files exist
ls -la /etc/ssl/cloudflare/

# Verify cert matches your domain
openssl x509 -in /etc/ssl/cloudflare/cert.pem -noout -subject
```

### DNS Not Resolving

```bash
# Check DNS propagation
dig mcp.podiem.io +short

# Should show your GCP VM external IP

# Force Cloudflare purge if needed
# Cloudflare Dashboard → Caching → Configuration → Purge Everything
```

---

## Verify Your Existing Nginx Configs

Ensure all three sites are enabled:

```bash
ls -la /etc/nginx/sites-enabled/
# Should show:
# default
# ollama
# qdrant
# mcp-server
```

If any are missing:

```bash
sudo ln -s /etc/nginx/sites-available/ollama /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/qdrant /etc/nginx/sites-enabled/
```

---

## Quick Reference

| Service | Config File | Port | URL |
|---------|-------------|------|-----|
| Ollama | `/etc/nginx/sites-available/ollama` | 11434 | https://ollama.podiem.io |
| Qdrant | `/etc/nginx/sites-available/qdrant` | 6333 | https://qdrant.podiem.io |
| MCP Server | `/etc/nginx/sites-available/mcp-server` | 3000 | https://mcp.podiem.io |
