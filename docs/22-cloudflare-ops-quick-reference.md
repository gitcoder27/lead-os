# Cloudflare Ops Quick Reference

This document is now historical.

The production deployment no longer uses the Cloudflare Quick Tunnel as the primary access path. The current live setup uses:

- `nginx`
- `https://lead.daycommand.online`
- `https://developer.daycommand.online`

Use `docs/23-hostinger-domain-vps-deployment-runbook.md` for the active VPS deployment and redeploy process.

Keep this document only for rollback or legacy tunnel troubleshooting. If you do fall back to the tunnel, set `TRUST_PROXY=loopback` (see `docs/20`) so the login throttle sees real visitor IPs.

## Current Services

- app service: `lead-os`
- tunnel service: `defects-cloudflared`

## Check Status

```bash
sudo systemctl status lead-os defects-cloudflared --no-pager
```

## Start Services

```bash
sudo systemctl start lead-os
sudo systemctl start defects-cloudflared
```

## Stop Services

```bash
sudo systemctl stop defects-cloudflared
sudo systemctl stop lead-os
```

## Restart Services

Restart app only:

```bash
sudo systemctl restart lead-os
```

Restart tunnel only:

```bash
sudo systemctl restart defects-cloudflared
```

Restart both:

```bash
sudo systemctl restart lead-os
sudo systemctl restart defects-cloudflared
```

## Get Current Public URL

```bash
sudo journalctl -u defects-cloudflared -n 50 --no-pager
```

Look for:

```text
https://<random-name>.trycloudflare.com
```

## Deploy Code Changes

Run after pulling or copying updated code to the VPS:

```bash
cd /home/ubuntu/apps/lead-os-prod
npm install
npm run build
sudo systemctl restart lead-os
sudo systemctl status lead-os --no-pager
```

For non-deploy validation in the development workspace, use:

```bash
cd /home/ubuntu/Development/lead-os
npm run typecheck
npm run build:check
```

## When To Restart Tunnel

Usually do **not** restart the tunnel after normal app code changes.

Restart the tunnel only if:

- it is down
- logs show tunnel errors
- you intentionally want a fresh tunnel process

Reason:

- restarting `lead-os` applies new code
- restarting `defects-cloudflared` can generate a different public URL

## After VPS Reboot

These services are enabled in `systemd`, so they should start automatically.

To verify:

```bash
sudo systemctl status lead-os defects-cloudflared --no-pager
```

## Useful Logs

App logs:

```bash
sudo journalctl -u lead-os -f
```

Tunnel logs:

```bash
sudo journalctl -u defects-cloudflared -f
```

## Health Check Checklist

Use this checklist when you want to confirm the dashboard is still available.

### 1. Check both services are running

```bash
sudo systemctl status lead-os defects-cloudflared --no-pager
```

Expected:

- both services show `active (running)`

### 2. Check the app locally on the VPS

```bash
curl -I http://localhost:3001
curl -s http://localhost:3001/api/health
```

Expected:

- `http://localhost:3001` returns `HTTP 200`
- `/api/health` returns `{"status":"ok"}`

### 3. Get the current public URL

```bash
sudo journalctl -u defects-cloudflared -n 50 --no-pager
```

Expected:

- a recent `https://<random>.trycloudflare.com` URL appears in the logs

### 4. Check the public manager URL

```bash
curl -I https://<current-random-url>.trycloudflare.com
```

Expected:

- returns `HTTP 200`

### 5. Check the public My Day URL

```bash
curl -I https://<current-random-url>.trycloudflare.com/my-day
```

Expected:

- returns `HTTP 200`

## Common Failure Scenarios

The dashboard can still become unavailable if:

- the VPS is rebooted, shut down, or unavailable
- the app process crashes and cannot recover cleanly
- the Cloudflare tunnel process crashes and is recreated
- the public Quick Tunnel URL changes after tunnel restart
- the VPS loses internet connectivity
- a bad deployment is pushed and the app fails after restart
- Cloudflare Quick Tunnel has a service-side issue

## Fast Recovery Steps

If the dashboard is down:

```bash
sudo systemctl status lead-os defects-cloudflared --no-pager
sudo systemctl restart lead-os
sudo systemctl restart defects-cloudflared
sudo journalctl -u defects-cloudflared -n 50 --no-pager
```

After restarting the tunnel:

- use the latest public URL from the logs
- the previous public URL may no longer work
