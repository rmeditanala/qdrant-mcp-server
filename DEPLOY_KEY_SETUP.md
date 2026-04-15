# GitHub Deploy Key Setup Guide

Configure SSH-based authentication for pulling the repository on GCP VM.

---

## Step 1: Generate SSH Key on GCP VM

```bash
# SSH into your VM
gcloud compute ssh your-instance --zone your-zone

# Generate SSH key (no passphrase for automated use)
ssh-keygen -t ed25519 -C "deploy-key-gcp-vm" -f ~/.ssh/github_deploy -N ""

# This creates:
# ~/.ssh/github_deploy     (private key)
# ~/.ssh/github_deploy.pub (public key)
```

---

## Step 2: Add Public Key to GitHub

```bash
# Copy the public key
cat ~/.ssh/github_deploy.pub
# Output looks like: ssh-ed25519 AAAA... deploy-key-gcp-vm
```

Then in GitHub:

1. Go to your repo: **Settings** → **Deploy keys**
2. Click **Add deploy key**
3. Title: `GCP VM Deploy Key`
4. Key: Paste the output from `cat ~/.ssh/github_deploy.pub`
5. ✅ Check **"Allow write access"** only if you want to push from VM (optional)
6. Click **Add key**

---

## Step 3: Configure SSH on VM

Create SSH config file:

```bash
cat > ~/.ssh/config << 'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config
```

---

## Step 4: Clone the Repository

```bash
# Test SSH connection
ssh -T git@github.com
# Should show: Hi <org>/<repo>! You've successfully authenticated...

# Clone using SSH URL
cd ~
git clone git@github.com:your-org/qdrant-mcp-server.git
cd qdrant-mcp-server
```

---

## Step 5: Deploy

> **Note**: You **don't need** to run `npm install` or `npm run build` on the VM!
> The Dockerfile handles all installation and building inside the container.

```bash
# Configure environment variables
nano .env.deploy  # Edit with actual values

# Build and deploy with Docker (handles npm install + build automatically)
docker compose -f compose.deploy.yaml build
docker compose -f compose.deploy.yaml up -d

# Verify
docker compose -f compose.deploy.yaml ps
curl http://localhost:3000/health
```

---

## Future Updates

When you make changes and want to update:

> **Note**: Docker rebuilds everything automatically. No need for manual `npm install` or `npm run build`.

```bash
# SSH into VM
cd ~/qdrant-mcp-server

# Pull latest changes
git pull origin main

# Rebuild and restart (Docker handles npm install + build)
docker compose -f compose.deploy.yaml build --no-cache
docker compose -f compose.deploy.yaml down
docker compose -f compose.deploy.yaml up -d

# Check logs
docker compose -f compose.deploy.yaml logs -f
```

---

## Quick Deploy Script

Create a helper script for easy updates:

```bash
cat > ~/deploy-mcp.sh << 'SCRIPT'
#!/bin/bash
set -e

echo "🔄 Pulling latest changes..."
cd ~/qdrant-mcp-server
git pull origin main

echo "🔨 Rebuilding Docker image..."
docker compose -f compose.deploy.yaml build --no-cache

echo "🚀 Restarting services..."
docker compose -f compose.deploy.yaml down
docker compose -f compose.deploy.yaml up -d

echo "✅ Deployment complete!"
echo "📊 Checking health..."
sleep 2
curl -s http://localhost:3000/health | jq . 2>/dev/null || curl -s http://localhost:3000/health
SCRIPT

chmod +x ~/deploy-mcp.sh
```

### Usage

```bash
# Deploy latest changes
~/deploy-mcp.sh
```

---

## Security Notes

- ✅ Deploy keys are **read-only by default** (unless you enable write access)
- ✅ Tied to a single repository (more secure than personal access tokens)
- ✅ Can be revoked at any time from GitHub settings
- ✅ No password or passphrase needed for automated deployments
- ⚠️ Store private key securely (`~/.ssh/github_deploy`)
- ⚠️ Never commit or share the private key

---

## Troubleshooting

### Permission Denied (publickey)

```bash
# Check SSH key permissions
ls -la ~/.ssh/github_deploy
# Should be: -rw------- (600)

# Fix permissions if needed
chmod 600 ~/.ssh/github_deploy
chmod 644 ~/.ssh/github_deploy.pub
chmod 600 ~/.ssh/config

# Test with verbose output
ssh -vT git@github.com
```

### Clone Fails

```bash
# Verify SSH config
cat ~/.ssh/config

# Verify key is added in GitHub
# Settings → Deploy keys → Should show your key

# Try manual SSH test
ssh -T git@github.com
```

### Key Fingerprint Mismatch

```bash
# Show fingerprint of your key
ssh-keygen -lf ~/.ssh/github_deploy.pub

# Compare with fingerprint shown in GitHub deploy keys page
```

---

## Cleanup (If Needed)

To remove deploy key and start fresh:

```bash
# Remove from VM
rm ~/.ssh/github_deploy ~/.ssh/github_deploy.pub
# Edit ~/.ssh/config to remove github.com block

# Remove from GitHub
# Settings → Deploy keys → Delete the deploy key
```
