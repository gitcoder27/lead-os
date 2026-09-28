# Systemd Runbook For Cloudflare Quick Tunnel

## Goal

Run this dashboard on the VPS without depending on an active SSH terminal session.

This runbook covers:

- keeping the app running after SSH disconnect
- keeping the Cloudflare Quick Tunnel running after SSH disconnect
- starting and stopping both services manually
- restarting after code changes
- updating the deployed app when local code changes are pushed to the VPS

## What This Solves

If the app is started directly from an SSH terminal, closing the terminal can stop the process.

Using `systemd` fixes that by running the processes as system services.

With this approach:

- the dashboard does not depend on an open SSH terminal
- the app can restart automatically if it crashes
- the app can start automatically when the VPS reboots
- the tunnel can restart automatically if it crashes

## Important Limitation

This runbook still uses **Cloudflare Quick Tunnel**.

That means:

- the tunnel can stay running under `systemd`
- but the generated `trycloudflare.com` URL is still not guaranteed to be permanent
- if the tunnel is recreated, the public URL may change

So this is a persistence solution, not a permanent stable-hostname solution.

## Services We Will Run

We need two services:

1. the dashboard app service
2. the `cloudflared` service

### App service responsibility

- runs the built Node backend in production mode
- serves the frontend from `client/dist`
- listens on port `3001`

### Tunnel service responsibility

- exposes `http://localhost:3001` through Cloudflare Quick Tunnel
- gives the public HTTPS URL used by the team

## Prerequisites

Before using these steps:

- repo is present on the VPS
- dependencies are installed
- `cloudflared` is installed
- production build succeeds

Commands:

```bash
cd /home/ubuntu/Development/lead-os
npm install
npm run build
```

## App Service

Create:

`/etc/systemd/system/lead-os.service`

Recommended content:

```ini
[Unit]
Description=LeadOS App
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Development/lead-os
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

If the tunnel is your public path, also add `Environment=TRUST_PROXY=loopback` to the `[Service]` block (or set it in the app's `.env`). Without it the login throttle sees every visitor as `127.0.0.1` and one person's failed attempts lock the account for everyone. See `docs/20-cloudflare-quick-tunnel-deployment.md` ("Client IP And TRUST_PROXY").

## Tunnel Service

Create:

`/etc/systemd/system/defects-cloudflared.service`

Recommended content:

```ini
[Unit]
Description=Cloudflare Quick Tunnel For LeadOS
After=network.target lead-os.service
Requires=lead-os.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Development/lead-os
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --url http://localhost:3001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Enable The Services

After creating the service files:

```bash
sudo systemctl daemon-reload
sudo systemctl enable lead-os
sudo systemctl enable defects-cloudflared
```

## Start The Services

Start the dashboard app:

```bash
sudo systemctl start lead-os
```

Start the Cloudflare tunnel:

```bash
sudo systemctl start defects-cloudflared
```

## Check Status

Check app status:

```bash
sudo systemctl status lead-os
```

Check tunnel status:

```bash
sudo systemctl status defects-cloudflared
```

## Get The Public URL

Since Quick Tunnel generates the public URL at startup, read it from the tunnel logs:

```bash
sudo journalctl -u defects-cloudflared -n 50 --no-pager
```

Look for the line containing:

```text
https://<random-name>.trycloudflare.com
```

## Stop The Services

Stop the tunnel:

```bash
sudo systemctl stop defects-cloudflared
```

Stop the app:

```bash
sudo systemctl stop lead-os
```

## Start Again Later

If you previously stopped them and want to start them again:

```bash
sudo systemctl start lead-os
sudo systemctl start defects-cloudflared
```

## Restart The Services

If the app is already running and you want to restart it:

```bash
sudo systemctl restart lead-os
```

If you want to restart the tunnel:

```bash
sudo systemctl restart defects-cloudflared
```

After restarting the tunnel, re-check the logs because the public URL may change.

## View Logs

App logs:

```bash
sudo journalctl -u lead-os -f
```

Tunnel logs:

```bash
sudo journalctl -u defects-cloudflared -f
```

## Normal Daily Operation

After initial setup, the normal flow is:

1. do nothing if the services are already running
2. check status only when needed
3. restart only if there is an issue

Useful checks:

```bash
sudo systemctl status lead-os
sudo systemctl status defects-cloudflared
```

## Deployment Update Flow After Code Changes

If you make code changes locally and then update the project on the VPS, follow this flow.

### Step 1: SSH into the VPS

```bash
ssh <your-vps>
```

### Step 2: Go to the project directory

```bash
cd /home/ubuntu/Development/lead-os
```

### Step 3: Pull or copy the latest code

If using Git:

```bash
git pull
```

If you deploy by copying files manually, update the project files first and then continue.

### Step 4: Install dependencies if package files changed

```bash
npm install
```

### Step 5: Rebuild the app

```bash
npm run build
```

### Step 6: Restart the app service

```bash
sudo systemctl restart lead-os
```

### Step 7: Decide whether the tunnel also needs restart

Usually:

- if only app code changed, restart only `lead-os`
- if the tunnel is healthy, you do not need to restart `defects-cloudflared`

Restart the tunnel only if:

- the tunnel service is down
- the tunnel logs show errors
- you intentionally want a fresh tunnel process

Tunnel restart command:

```bash
sudo systemctl restart defects-cloudflared
```

If you restart the tunnel, check the public URL again because it may change.

## Quick Update Checklist

For normal code deployment:

```bash
cd /home/ubuntu/Development/lead-os
git pull
npm install
npm run build
sudo systemctl restart lead-os
sudo systemctl status lead-os
```

Only if needed:

```bash
sudo systemctl restart defects-cloudflared
sudo journalctl -u defects-cloudflared -n 50 --no-pager
```

## Quick Start Checklist

If services were stopped:

```bash
sudo systemctl start lead-os
sudo systemctl start defects-cloudflared
sudo systemctl status lead-os
sudo systemctl status defects-cloudflared
sudo journalctl -u defects-cloudflared -n 50 --no-pager
```

## Quick Stop Checklist

If you want the system fully stopped:

```bash
sudo systemctl stop defects-cloudflared
sudo systemctl stop lead-os
```

## Recommended Operating Rule

Use this rule for day-to-day maintenance:

- restart the app after code changes
- do not restart the tunnel unless necessary

Reason:

- restarting the app applies new code
- restarting the tunnel can generate a different public URL

## Expected Result

After this setup:

- you can close SSH
- the app keeps running
- the tunnel keeps running
- teammates can access the dashboard from the public URL
- after code changes, you rebuild and restart the app service

