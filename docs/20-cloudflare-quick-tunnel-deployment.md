# Cloudflare Quick Tunnel Deployment Plan

## Goal

Expose this dashboard from the existing VPS so a small remote team can access it in a browser over the internet without:

- buying a domain
- installing VPN software
- installing any client software on team laptops

This plan uses a Cloudflare Quick Tunnel as the first implementation path.

## Why This Option

This repository already supports a simple production deployment model:

- the frontend is built with Vite
- the backend runs on Express
- in production, Express serves the built frontend from `client/dist`
- the application data is stored locally on the VPS in SQLite

That means the app can run as a single Node service on the VPS, while Cloudflare provides a public HTTPS URL that forwards traffic to the local app.

## Fit For This Project

Current constraints for this project:

- team members are remote
- team members must access the app directly in a browser
- VPN is not allowed
- no client installation on office laptops
- no paid domain purchase
- the application is already running on a cloud VPS

Given those constraints, Cloudflare Quick Tunnel is the best free first step.

## Important Notes

- Quick Tunnel is suitable for internal pilot use and small-team access.
- It is not the final long-term production-grade setup.
- The public hostname is temporary and Cloudflare-managed.
- If the tunnel process stops, public access stops.
- This approach should be treated as the first deployment stage, not the permanent architecture.

## High-Level Architecture

1. Build the frontend locally on the VPS.
2. Start the Node server in production mode on the VPS.
3. The server listens on a local port such as `3001`.
4. Start a Cloudflare Quick Tunnel that forwards a public HTTPS URL to `http://localhost:3001`.
5. Share the generated HTTPS URL with the team.

## Repo-Specific Notes

### Production app behavior

The backend already serves the built frontend in production mode.

Relevant file:

- `server/src/app.ts`

This means we do not need a separate frontend host for the first deployment.

### Local runtime port

The backend uses port `3001` by default.

Relevant file:

- `server/src/config.ts`

### Database location

The default SQLite database path is:

- `data/dashboard.db`

Relevant file:

- `server/src/db/paths.ts`

## Deployment Flow

### Step 1: Install dependencies

Run from repo root:

```bash
npm install
```

### Step 2: Build the app

Run from repo root:

```bash
npm run build
```

Expected result:

- frontend assets are generated in `client/dist`
- backend TypeScript is compiled to `server/dist`

### Step 3: Start the app in production mode

Run from repo root:

```bash
NODE_ENV=production npm run start
```

Expected result:

- backend starts on `http://localhost:3001`
- non-API routes are served from the production frontend build

### Step 4: Start Cloudflare Quick Tunnel

Forward the public tunnel to the local server:

```bash
cloudflared tunnel --url http://localhost:3001
```

Expected result:

- Cloudflare returns a public `https://...trycloudflare.com` URL
- team members can open that URL directly in a browser

## Recommended Operating Model

For the initial rollout:

- run the Node app under a persistent process manager
- run the tunnel under a persistent process manager
- keep both processes on the VPS

Reason:

- if either process stops, the dashboard becomes unavailable

Possible process managers:

- `systemd`
- `pm2`

`systemd` is preferred on a Linux VPS.

## Security Expectations

This app uses login-based access, so public exposure should always go through HTTPS.

Cloudflare Quick Tunnel provides the public HTTPS endpoint, which makes it acceptable for this initial rollout.

Even with HTTPS, the following still matter:

- use strong passwords for all dashboard users
- create only the minimum required user accounts
- restrict VPS shell access
- keep the server updated
- monitor who has manager access

## Client IP And TRUST_PROXY

`cloudflared` connects to the app from the same host, so Node sees every request as coming from `127.0.0.1` and the login throttle (keyed on `IP:username`) treats all visitors as one client. Set `TRUST_PROXY=loopback` in the app's `.env` so Express takes the visitor address from `X-Forwarded-For`, which Cloudflare sets. Node then only trusts that header from the local `cloudflared` process. Do not use `true`: it is rejected on purpose because it lets clients spoof their IP. Leaving `TRUST_PROXY` unset keeps the old behavior. The live deployment now uses `nginx`; see the "Client IP And TRUST_PROXY" section in `docs/23-hostinger-domain-vps-deployment-runbook.md`.

## Operational Risks

### Temporary hostname

The public URL is not a stable branded domain.

Impact:

- the shared URL may change if the tunnel is recreated

### Tunnel process dependency

If `cloudflared` stops, the dashboard is unreachable.

Impact:

- availability depends on keeping the tunnel running

### Not ideal for long-term production

Quick Tunnel is a practical zero-cost path, but not the final desired hosting model.

Impact:

- future migration to a stable hostname should still be expected

## What We Should Implement For This Repo

Phase 1:

- verify the app builds cleanly on the VPS
- run the backend in production mode
- confirm local access on `localhost:3001`
- install and run `cloudflared`
- verify remote login and main workflows through the public Quick Tunnel URL

Phase 2:

- add persistent service definitions for the app and the tunnel
- document restart commands
- document log locations
- verify access after VPS reboot

## Validation Checklist

- `npm install` completes successfully
- `npm run build` completes successfully
- `NODE_ENV=production npm run start` serves the application locally
- `cloudflared tunnel --url http://localhost:3001` returns a public HTTPS URL
- a remote team member can load the login page
- a manager account can sign in
- a developer account can sign in to My Day
- API requests succeed through the tunnel
- the app still works after restarting the server process

## Future Upgrade Path

If this pilot is successful, the next improvement should be moving from Quick Tunnel to a stable internet-facing setup such as:

- a real domain with Cloudflare-managed tunnel routing
- or a standard reverse proxy with a proper domain and TLS

That should be treated as a later phase, after the free pilot setup is proven.

