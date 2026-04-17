# MCP Connection Debug Guide

Troubleshooting steps for when the MCP server appears disconnected or unreachable.

---

## Quick Checks (Start Here)

### 1. Verify Server Health

```bash
# Test health endpoint
curl https://mcp.podiem.io/health
```

**Expected:** `{"status":"ok"}`

**If it fails:**
- Server is down → Check Docker
- Returns HTML/login page → Cloudflare Access blocking
- SSL error → Check Cloudflare SSL configuration

### 2. Verify Container is Running

```bash
# SSH into VM
gcloud compute ssh your-instance --zone your-zone

# Check container status
docker ps | grep mcp

# Should show:
# qdrant-mcp-server   Up XX minutes   0.0.0.0:3000->3000/tcp
```

**If not running:**
```bash
cd ~/qdrant-mcp-server
docker compose -f compose.deploy.yaml up -d
docker logs qdrant-mcp-server
```

### 3. Test MCP Endpoint Directly

```bash
# Test with API key
curl -X POST https://mcp.podiem.io/mcp \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_API_KEY" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

**Expected:** JSON-RPC response with server capabilities

**Common responses:**
- `401 Unauthorized` → API key is wrong or missing
- `404 Not Found` → Wrong URL path (try `/mcp` vs `/`)
- HTML redirect → Cloudflare Access blocking
- `502 Bad Gateway` → Container not running or crashed
- `{"error":{"message":"Bad Request: Server not initialized"}}` → See Issue 7 below

---

## Step-by-Step Debugging

### Step 1: Check Server Logs

```bash
# SSH into VM
ssh your-instance

# Check container logs
docker logs qdrant-mcp-server --tail 100

# Follow live logs
docker logs qdrant-mcp-server -f
```

**Look for:**
- `Qdrant MCP server running on HTTP` → Server started successfully
- Error messages → Fix the reported error
- No logs → Container not running

### Step 2: Verify Environment Variables

```bash
# Check .env.deploy exists and has values
cat ~/qdrant-mcp-server/.env.deploy

# Verify critical values:
# EMBEDDING_API_KEY=<your-ollama-api-key>
# QDRANT_URL=https://qdrant.podiem.io
# EMBEDDING_BASE_URL=https://ollama.podiem.io
```

### Step 3: Check Nginx Configuration

```bash
# Test Nginx config
sudo nginx -t

# Check Nginx error logs
sudo tail -50 /var/log/nginx/error.log

# Check if Nginx is running
sudo systemctl status nginx
```

**If Nginx is misconfigured:**
```bash
# Reload Nginx
sudo systemctl reload nginx
```

### Step 4: Test Without Cloudflare (Direct IP)

```bash
# Test direct to VM IP (bypass Cloudflare)
curl http://<GCP_VM_EXTERNAL_IP>:3000/health
```

**If this works but Cloudflare doesn't:**
- Cloudflare Access is blocking → Check Zero Trust policies
- SSL mode mismatch → Check Cloudflare SSL setting
- DNS not propagating → Wait 5 minutes, or `dig mcp.podiem.io`

### Step 5: Verify API Key Matches

The server uses `EMBEDDING_API_KEY` in `.env.deploy` to authenticate incoming requests.
The client must send this same value as the `X-Api-Key` header.

```bash
# Server side (on VM)
cat ~/qdrant-mcp-server/.env.deploy | grep EMBEDDING_API_KEY

# Client side — check your claude.json MCP config:
# "headers": { "X-Api-Key": "<must match EMBEDDING_API_KEY>" }

# They MUST match exactly (case-sensitive, no extra spaces)
```

### Step 6: Enable Claude Code Debug Logging

```bash
# Run with debug output
claude --debug

# Look for MCP-related lines:
# [DEBUG] MCP server "qdrant-podiem": ...
# [ERROR] MCP server "qdrant-podiem": ...
```

Key things to check in the debug output:
- `HTTP transport options` — confirms the URL and headers being sent
- `HTTP Connection failed` — shows the actual error from the server
- `No token data found` — normal, not an error

---

## Common Issues & Fixes

### Issue 1: Wrong URL Path

**Symptom:** `404 Not Found` or connection timeout

**Fix:** Ensure URL ends with `/mcp`

```json
{
  "qdrant-podiem": {
    "type": "http",
    "url": "https://mcp.podiem.io/mcp"
  }
}
```

**NOT:**
```json
"url": "https://mcp.podiem.io"        // Missing /mcp
"url": "https://mcp.podiem.io/mcp/"   // Extra trailing slash
```

### Issue 2: Wrong Claude Code MCP Config Format

**Symptom:** MCP server never connects, no debug output from the server

**Cause:** Using `@modelcontextprotocol/inspector` as the command. The inspector is a
debugging tool, not an MCP transport. It will not connect Claude Code to the server.

**Wrong:**
```json
"qdrant-podiem": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/inspector", "https://mcp.podiem.io/mcp",
           "--header", "X-Api-Key: YOUR_KEY"]
}
```

**Correct:**
```json
"qdrant-podiem": {
  "type": "http",
  "url": "https://mcp.podiem.io/mcp",
  "headers": {
    "X-Api-Key": "YOUR_KEY"
  }
}
```

To update via CLI (from inside your project directory):
```bash
claude mcp add --transport http qdrant-podiem https://mcp.podiem.io/mcp \
  --header "X-Api-Key: YOUR_KEY" --scope project
```

### Issue 3: API Key Mismatch

**Symptom:** `401 Unauthorized` or silent disconnect

**Fix:** Verify exact match (case-sensitive, no extra spaces)

```bash
# Generate fresh key if needed
openssl rand -hex 32

# Update .env.deploy on server
nano ~/qdrant-mcp-server/.env.deploy

# Update headers in your claude.json MCP config

# Restart server
docker compose -f compose.deploy.yaml restart
```

### Issue 4: Cloudflare Access Blocking

**Symptom:** curl returns HTML instead of JSON, or redirects to login page

**Check:**
```bash
curl -I https://mcp.podiem.io/health

# Look for:
# HTTP/2 200  → Good
# HTTP/2 302  → Redirect (Access blocking)
# HTTP/2 403  → Forbidden (Access blocking)
```

**Fix:**
1. Go to Cloudflare Zero Trust Dashboard
2. **Access** → **Applications** → **Qdrant MCP Server**
3. Check policies - ensure your email/IP is allowed
4. Or temporarily disable Access for testing

**Alternative:** Add `/mcp` path to allowed paths, or create a separate policy for API access.

### Issue 5: SSL/TLS Errors

**Symptom:** SSL handshake failed or certificate error

**Check Cloudflare SSL mode:**
- **Flexible** → Cloudflare HTTPS, Nginx HTTP (port 80)
- **Full** → Cloudflare HTTPS, Nginx HTTP (any port)
- **Full (Strict)** → Cloudflare HTTPS, Nginx HTTPS (port 443 with cert)

**Fix:**
```bash
# If using Flexible (simplest), ensure Nginx listens on port 80
# Your Nginx config should have:
#   server { listen 80; ... }
# NOT:
#   server { listen 443 ssl; ... }
```

### Issue 6: Container Crashed

**Symptom:** Health check fails, container not running

**Check:**
```bash
docker ps -a | grep mcp

# If exited:
docker logs qdrant-mcp-server

# Common crash reasons:
# 1. Port 3000 already in use
# 2. Invalid .env.deploy values
# 3. Missing dependencies (Qdrant/Ollama unreachable)
# 4. TypeScript build error (see Issue 8)
```

**Fix:**
```bash
# Restart container
docker compose -f compose.deploy.yaml down
docker compose -f compose.deploy.yaml up -d

# If still crashing, rebuild
docker compose -f compose.deploy.yaml build --no-cache
docker compose -f compose.deploy.yaml up -d
```

### Issue 7: "Bad Request: Server not initialized"

**Symptom:** Claude Code debug log shows:
```
HTTP Connection failed: Streamable HTTP error: Error POSTing to endpoint:
{"error":{"code":-32000,"message":"Bad Request: Server not initialized"}}
```

**Cause:** The HTTP transport is running in **stateful mode** (`sessionIdGenerator` set to a
UUID-generating function). In stateful mode, the transport rejects any request that is not
an `initialize` message and has no session ID. Claude Code sends a connectivity probe before
the real `initialize` handshake, which triggers this error.

**Fix:** The transport in `src/index.ts` must use stateless mode:

```typescript
// CORRECT - stateless mode
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
});

// WRONG - stateful mode, breaks per-request servers
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
  enableJsonResponse: true,
});
```

After fixing, rebuild and redeploy:
```bash
git pull
docker compose -f compose.deploy.yaml build
docker compose -f compose.deploy.yaml up -d
```

### Issue 8: TypeScript Build Failure (Docker)

**Symptom:** `docker compose build` fails with a `tsc` error.

**Common errors and fixes:**

**`TS2322: Type '() => undefined' is not assignable to type '() => string'`**

Caused by a bad merge leaving `sessionIdGenerator: () => undefined` in the source.
Fix: change it to `sessionIdGenerator: undefined`.

**`TS1117: An object literal cannot have multiple properties with the same name`**

Caused by a merge conflict leaving two `sessionIdGenerator` lines in the same object.

```bash
# Check for duplicates on the server
grep -n "sessionIdGenerator" src/index.ts

# Remove the duplicate line (keep only: sessionIdGenerator: undefined)
```

### Issue 9: CORS or Connection Drop Issues

**Symptom:** Connection starts but drops immediately

**Check Nginx config has correct proxy headers:**
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

---

## Enable Verbose Logging

### Server-Side Logging

```bash
# Set LOG_LEVEL to debug
nano ~/qdrant-mcp-server/.env.deploy

# Change:
LOG_LEVEL=debug

# Restart
docker compose -f compose.deploy.yaml restart

# Watch logs
docker logs qdrant-mcp-server -f
```

### Client-Side Debugging

```bash
# Run Claude Code with debug logging
claude --debug

# Filter MCP-related lines only
claude --debug 2>&1 | grep "MCP server"
```

### Network Debug

```bash
# Test with verbose curl
curl -v https://mcp.podiem.io/health

# Check DNS resolution
dig mcp.podiem.io +short

# Test SSL certificate
openssl s_client -connect mcp.podiem.io:443 -servername mcp.podiem.io
```

---

## Quick Fix Checklist

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `404 Not Found` | Wrong URL path | Add `/mcp` to URL |
| `401 Unauthorized` | API key mismatch | Verify `X-Api-Key` matches `EMBEDDING_API_KEY` |
| MCP never connects | Wrong config format (using inspector) | Use `type: http` config format (Issue 2) |
| `"Server not initialized"` | Stateful transport mode | Set `sessionIdGenerator: undefined` (Issue 7) |
| HTML response | Cloudflare Access blocking | Disable or whitelist your email |
| `502 Bad Gateway` | Container down | `docker compose up -d` |
| SSL error | SSL mode mismatch | Check Cloudflare SSL setting |
| Connection timeout | Firewall blocking | Check GCP firewall rules |
| Build fails in Docker | TypeScript error | See Issue 8 |
| Silent disconnect | Multiple issues | Check server logs first |

---

## Reset Everything

If all else fails, start fresh:

```bash
# On VM
cd ~/qdrant-mcp-server

# Stop everything
docker compose -f compose.deploy.yaml down

# Clean rebuild
docker compose -f compose.deploy.yaml build --no-cache
docker compose -f compose.deploy.yaml up -d

# Verify
docker logs qdrant-mcp-server
curl http://localhost:3000/health

# Test from client
curl -X POST https://mcp.podiem.io/mcp \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```
