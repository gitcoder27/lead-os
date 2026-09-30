# Hostinger Domain To VPS Deployment Runbook

## Goal

Move this app from the current Cloudflare Quick Tunnel URL to a stable HTTPS URL on your own domain from Hostinger.

This runbook covers:

- how to create the DNS records for a subdomain in Hostinger
- how to point the subdomain to your VPS
- how to expose the existing app through `nginx`
- how to add HTTPS with Let's Encrypt
- how to test from your office laptop
- how to support either one hostname or two hostnames

## Short Recommendation

Start with **one** hostname:

- `dashboard.yourdomain.com`

Then use app paths for each role:

- manager entry: `https://dashboard.yourdomain.com/`
- developer entry: `https://dashboard.yourdomain.com/my-day`

This is the cleanest setup for this repo.

Two subdomains are also possible:

- `manager.yourdomain.com`
- `developer.yourdomain.com`

But they are a convenience feature, not a security boundary. This app already handles role access in the application itself.

## Why One Hostname Is Better For This Repo

This repo already behaves like a single same-origin production app:

- the backend serves the built frontend in production
- the frontend calls `/api` on the same origin
- the app already has path-based views like `/my-day`, `/team-tracker`, and `/manager-desk`

Relevant files:

- `server/src/app.ts`
- `client/src/lib/api.ts`
- `client/src/App.tsx`

Important caveat for a two-subdomain setup:

- the current session cookie does **not** set a `Domain` attribute
- that means login sessions are host-specific
- if a user logs in on `manager.yourdomain.com`, that login is not automatically shared with `developer.yourdomain.com`

Relevant file:

- `server/src/services/auth.service.ts`

Because of that, the recommended first rollout is still a single hostname.

## Current Deployment Assumption

This runbook assumes:

- the app is already deployed on the VPS
- the Node app runs on port `3001`
- the app is or will be managed by `systemd`
- the current app service name is `lead-os`

Relevant docs:

- `docs/21-systemd-cloudflare-quick-tunnel-runbook.md`
- `docs/22-cloudflare-ops-quick-reference.md`

## Placeholders Used In This Document

Replace these values before running commands:

- `YOUR_DOMAIN` -> your real domain, for example `example.com`
- `VPS_IP` -> your VPS public IPv4 address
- `DASHBOARD_HOST` -> `dashboard.YOUR_DOMAIN`
- `MANAGER_HOST` -> `manager.YOUR_DOMAIN`
- `DEVELOPER_HOST` -> `developer.YOUR_DOMAIN`

## Architecture

Final target flow:

1. A browser opens `https://dashboard.YOUR_DOMAIN`
2. DNS resolves that hostname to `VPS_IP`
3. `nginx` receives the request on ports `80` and `443`
4. `nginx` forwards traffic to `http://127.0.0.1:3001`
5. the Node app serves both the frontend and the API

## Routine Redeploy After Code Changes

Once the domain setup is live, use this process whenever you want production to pick up newer code from this repo.

### One-Command Deploy

You can now trigger the production redeploy from the development checkout with one command:

```bash
cd /home/ubuntu/Development/lead-os
npm run deploy:prod
```

Equivalent npm form:

```bash
cd /home/ubuntu/Development/lead-os
npm run deploy -- prod
```

What it does:

- switches into the production checkout at `/home/ubuntu/apps/lead-os-prod`
- refuses to run if the production checkout is dirty
- fetches and fast-forwards to `origin/main`
- runs `npm install`
- runs the full production build
- restarts `lead-os`
- verifies the manager URL, developer `/my-day` URL, and `/api/health`

Important:

- database migration is already handled automatically on server startup in `server/src/index.ts`
- the command is designed for this VPS layout and expects the production checkout to exist at `/home/ubuntu/apps/lead-os-prod`

### Production And Development Separation

This VPS now uses two separate checkouts:

- development workspace: `/home/ubuntu/Development/lead-os`
- production checkout: `/home/ubuntu/apps/lead-os-prod`

The live `lead-os` service runs from the production checkout, not from the development workspace.

That means:

- building in the development workspace does not update the public site
- production has its own `client/dist`, `server/dist`, `.env`, and `data/`
- development and production SQLite files are separate unless you explicitly point them at the same path
- the production domain is proxied by `nginx` to `127.0.0.1:3001`
- local Vite dev should proxy to `127.0.0.1:3002`, not `3001`

For compile-only validation in the development workspace, prefer:

```bash
cd /home/ubuntu/Development/lead-os
npm run typecheck
npm run build:check
```

For local interactive development in the development workspace, use dedicated client proxy env vars:

```env
PORT=3002
VITE_API_PORT=3002
```

If you must point the local frontend at a non-local API, set `VITE_API_PROXY_TARGET` explicitly and opt in with `ALLOW_REMOTE_DEV_PROXY=true`.

Quick separation check when both dev and prod are running on the same VPS:

```bash
curl -s http://127.0.0.1:3002/api/auth/bootstrap
curl -s http://127.0.0.1:5173/api/auth/bootstrap
curl -s http://127.0.0.1:3001/api/auth/bootstrap
```

Expected:

- `5173` matches `3002`
- `3001` may differ

If `5173` matches `3001`, the Vite process is proxying to production and must be restarted with the correct env.

### What Production Actually Runs

- backend runtime: `server/dist/server/src/index.js`
- frontend runtime assets: `client/dist/`
- service name: `lead-os`
- production checkout path: `/home/ubuntu/apps/lead-os-prod`

This means source changes in `server/src/` or `client/src/` do **not** affect production until you rebuild and restart the service.

### Backend-Only Changes

If you changed only backend files and did not change frontend or shared UI code:

```bash
cd /home/ubuntu/apps/lead-os-prod
npm run build --workspace=server
sudo systemctl restart lead-os
sudo systemctl status lead-os --no-pager
curl -s https://manager.YOUR_DOMAIN/api/health
```

### Frontend Changes Or Full App Changes

If you changed frontend code, shared contracts, or anything used by both workspaces:

```bash
cd /home/ubuntu/apps/lead-os-prod
npm install
npm run build
sudo systemctl restart lead-os
sudo systemctl status lead-os --no-pager
curl -I https://manager.YOUR_DOMAIN
curl -I https://developer.YOUR_DOMAIN/my-day
curl -s https://manager.YOUR_DOMAIN/api/health
```

### If The VPS Needs The Latest Git Changes First

```bash
cd /home/ubuntu/apps/lead-os-prod
git pull
npm install
npm run build
sudo systemctl restart lead-os
```

### Fast Validation Checklist

After redeploying:

1. confirm the service is running
2. confirm the manager URL returns HTTP 200
3. confirm the developer URL or `/my-day` returns HTTP 200
4. confirm `/api/health` returns `{"status":"ok"}`
5. sign in once in the browser and check the changed screen or route

### Important Failure Pattern

If `npm run build` fails, production will continue serving the older built assets already present in `client/dist` and `server/dist`.

Do **not** restart the service expecting new code to appear unless the relevant build step succeeded.

## Phase 1: Decide Which Hostname Pattern You Want

### Option A: Recommended

Use one subdomain:

- `dashboard.YOUR_DOMAIN`

Share these URLs with users:

- manager URL: `https://dashboard.YOUR_DOMAIN/`
- developer URL: `https://dashboard.YOUR_DOMAIN/my-day`

Why this is best:

- simplest DNS setup
- simplest `nginx` setup
- one HTTPS certificate
- one login hostname
- no cross-subdomain session confusion

### Option B: Optional

Use two subdomains:

- `manager.YOUR_DOMAIN`
- `developer.YOUR_DOMAIN`

Both hostnames still point to the same VPS and the same Node app.

Important:

- this does **not** create separate deployments
- this does **not** create stronger authorization
- manager/developer permissions still come from the app login and role model
- users may need to log in separately on each hostname because the session cookie is host-specific today

## Phase 2: Verify The App On The VPS First

Before touching DNS, verify the app is healthy locally on the VPS.

Run:

```bash
cd /home/ubuntu/apps/lead-os-prod
curl -I http://localhost:3001
curl -s http://localhost:3001/api/health
sudo systemctl status lead-os --no-pager
```

Expected:

- `http://localhost:3001` returns HTTP 200
- `/api/health` returns `{"status":"ok"}`
- `lead-os` is `active (running)`

If the app is not running yet, build and start it:

```bash
cd /home/ubuntu/apps/lead-os-prod
npm install
npm run build
sudo systemctl restart lead-os
sudo systemctl status lead-os --no-pager
```

## Phase 3: Create The Subdomain In Hostinger

### Important Hostinger Note

Because your app is running on a VPS, you usually do **not** need a special "create subdomain website" screen in Hostinger.

For this VPS setup, a subdomain is normally created by adding a DNS record in the DNS Zone Editor.

That means:

- you do not need Hostinger shared hosting for this
- you do not need to upload files to Hostinger
- you do not need to install the app inside Hostinger
- you only need DNS records that point to your VPS

### How To Reach The Correct Hostinger Screen

In Hostinger, the exact labels can change slightly, but the path is generally:

1. Log in to Hostinger hPanel
2. Open `Domains`
3. Select the domain you bought
4. Open the DNS or nameserver management area
5. Open `DNS Zone Editor` or the equivalent DNS records page

If you cannot find a "Subdomain" button, that is fine. For this VPS use case, the DNS Zone Editor is the correct place.

### Single Hostname DNS Setup

Create this DNS record:

- Type: `A`
- Name / Host: `dashboard`
- Value / Points to: `VPS_IP`
- TTL: default

Result:

- `dashboard.YOUR_DOMAIN` -> `VPS_IP`

### Two Hostname DNS Setup

Create these DNS records:

- Type: `A`, Name: `manager`, Value: `VPS_IP`
- Type: `A`, Name: `developer`, Value: `VPS_IP`

Result:

- `manager.YOUR_DOMAIN` -> `VPS_IP`
- `developer.YOUR_DOMAIN` -> `VPS_IP`

### Wait For DNS Propagation

DNS is not always instant. Wait a few minutes, then verify from the VPS or your laptop:

```bash
dig +short dashboard.YOUR_DOMAIN
dig +short manager.YOUR_DOMAIN
dig +short developer.YOUR_DOMAIN
```

Expected:

- the hostname you created resolves to `VPS_IP`

If `dig` is not installed, use:

```bash
nslookup dashboard.YOUR_DOMAIN
```

## Phase 4: Prepare The VPS For Public HTTPS Traffic

Install `nginx` if it is not already installed:

```bash
sudo apt update
sudo apt install -y nginx
```

Allow web traffic through the firewall.

If UFW is enabled:

```bash
sudo ufw allow 'Nginx Full'
sudo ufw status
```

If your server does not have the `Nginx Full` app profile, allow the ports directly:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

### Oracle Cloud Image Firewall Note

Some Oracle Cloud Ubuntu images also enforce host-level `iptables` rules even when `ufw` is not installed.

Typical symptom:

- DNS resolves correctly
- `nginx` is listening on port `80`
- local `curl` to `127.0.0.1` works
- public HTTP requests and Certbot HTTP challenges time out

Check the live policy:

```bash
sudo iptables -L INPUT -n --line-numbers
```

If you only see SSH allowed before a final reject rule, open `80` and `443` on the VPS itself and persist the change:

```bash
sudo iptables -I INPUT 5 -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

On these images, persisted rules are commonly stored in:

```bash
/etc/iptables/rules.v4
```

After saving, retry the HTTP check and Certbot. If it still times out, the remaining block is likely in the cloud provider security list / NSG rather than inside the VM.

## Phase 5: Configure Nginx

### Option A: One Hostname

Create:

`/etc/nginx/sites-available/lead-os`

Use this content:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name dashboard.YOUR_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/lead-os /etc/nginx/sites-enabled/lead-os
sudo nginx -t
sudo systemctl reload nginx
```

### Option B: Two Hostnames To The Same App

Create:

`/etc/nginx/sites-available/lead-os`

Use this content first:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name manager.YOUR_DOMAIN developer.YOUR_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/lead-os /etc/nginx/sites-enabled/lead-os
sudo nginx -t
sudo systemctl reload nginx
```

### Optional Convenience Redirect For Developer Hostname

If you choose two subdomains, you may want:

- `https://developer.YOUR_DOMAIN/` -> `https://developer.YOUR_DOMAIN/my-day`

Do that only **after** the basic proxy setup works.

Example later adjustment:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name developer.YOUR_DOMAIN;

    location = / {
        return 302 /my-day;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

This is optional. Do not add it until the main hostname is already working.

## Phase 6: Add HTTPS With Let's Encrypt

Install Certbot using the official snap-based method:

```bash
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

### One Hostname Certificate

```bash
sudo certbot --nginx -d dashboard.YOUR_DOMAIN
```

### Two Hostname Certificate

```bash
sudo certbot --nginx -d manager.YOUR_DOMAIN -d developer.YOUR_DOMAIN
```

During the Certbot flow:

- enter your email address
- agree to the terms
- choose the option that redirects HTTP to HTTPS

After this, Certbot should update the `nginx` config for TLS automatically.

Verify:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Phase 7: Validate Public Access

From the VPS:

```bash
curl -I https://dashboard.YOUR_DOMAIN
curl -I https://dashboard.YOUR_DOMAIN/my-day
curl -s https://dashboard.YOUR_DOMAIN/api/health
```

If you chose two hostnames:

```bash
curl -I https://manager.YOUR_DOMAIN
curl -I https://developer.YOUR_DOMAIN
curl -I https://developer.YOUR_DOMAIN/my-day
curl -s https://manager.YOUR_DOMAIN/api/health
```

Then test from your office laptop:

1. open the new HTTPS URL in the browser
2. confirm the login screen loads
3. sign in as a manager
4. confirm the dashboard and manager pages work
5. open the developer entry URL
6. sign in as a developer
7. confirm `/my-day` works

## Phase 8: Cut Over From Cloudflare

Only after the new domain works correctly:

```bash
sudo systemctl stop defects-cloudflared
sudo systemctl disable defects-cloudflared
sudo systemctl status lead-os --no-pager
```

You can keep the old tunnel for a short overlap period if you want a rollback path.

## Recommended Rollout Sequence

Use this exact order:

1. verify the app is healthy on `localhost:3001`
2. create the DNS record in Hostinger
3. wait for the subdomain to resolve to the VPS
4. install and configure `nginx`
5. validate the site on plain HTTP
6. run Certbot and enable HTTPS redirect
7. test from your office laptop
8. share the new URL with the team
9. stop the Cloudflare tunnel after validation

## Security Notes

### Recommended Before Wider Team Use

1. Use strong passwords for all dashboard accounts.
2. Keep VPS SSH locked down with keys if possible.
3. Keep only ports `22`, `80`, and `443` open publicly.
4. Keep the app behind `nginx`; do not expose port `3001` to the internet.
5. Keep regular backups of the SQLite database, and copy them off the VPS (see [Backups and restore](#backups-and-restore)).

### Important Repo-Specific Follow-Up

Before wider internet exposure, make this code change in a follow-up task:

- add the `Secure` attribute to the session cookie in production

Why:

- the current cookie already uses `HttpOnly` and `SameSite=Lax`
- but it does not currently set `Secure`

Relevant file:

- `server/src/services/auth.service.ts`

### Client IP And TRUST_PROXY

The app sits behind `nginx` on the same host, so every request reaches Node from `127.0.0.1`. Without further setup Express reports that address as the client IP, and the login throttle (which keys on `IP:username`) treats every user as one client: five bad passwords from anyone can lock a given account, including the manager, for up to 15 minutes.

Set this in the production `.env` (`/home/ubuntu/apps/lead-os-prod/.env`) and restart the service:

```env
TRUST_PROXY=loopback
```

Why `loopback`:

- Node only trusts `X-Forwarded-For` from a peer on the loopback interface, which is `nginx` here. A direct connection from any other address cannot spoof its IP.
- The `nginx` block above sets `X-Forwarded-For $proxy_add_x_forwarded_for`, which appends the real peer after anything the client sent. Express takes the right-most untrusted entry, so a client-supplied `X-Forwarded-For` prefix cannot change its key.
- `true` is rejected at startup on purpose: it trusts every hop and lets any client pick its own IP. An invalid value also fails startup rather than being ignored.

Other values:

- a hop count such as `1` also works for exactly one proxy in front of the app
- if Cloudflare proxying (orange cloud) is ever put in front of `nginx`, `loopback` would report Cloudflare's edge IP instead of the visitor. Use a hop count of `2` only if every request always passes through Cloudflare, or restore the visitor IP in `nginx` with the `real_ip` module first

Verify after a restart:

```bash
sudo journalctl -u lead-os -n 50 --no-pager | grep "trust proxy"
```

You should see `Express trust proxy enabled` with `trustProxy: "loopback"`. If `TRUST_PROXY` is unset the app behaves exactly as before.

### Two Subdomain Caveat

If you use two hostnames, remember:

- a hostname is not a role boundary
- manager vs developer access is still controlled by the app user role
- session sharing across subdomains is not configured today

## Backups and restore

LeadOS snapshots the whole SQLite database into the backup directory (default: a `backups/` folder under the repo-root `data/`). Managers manage this in **Settings → Data & Backups**: turn the schedule on or off, set the frequency and retention, press **Back up now**, and download a snapshot. The routes behind it (`GET /api/backups`, `POST /api/backups/run`, `GET /api/backups/:name/download`) are manager-only.

A backup contains every table, including password hashes, session ids and encrypted secrets. Treat a downloaded file like the database itself.

### Restore is CLI-only

Restore replaces the live database, so it is deliberately not an endpoint or a button. On the machine that hosts LeadOS, stop the server, then run from the checkout that owns that database:

```bash
npm run backup:restore -- <path-to-backup-db>
```

The script verifies the file, moves the current database files into `backups/restore-archive/`, and copies the backup into place. Start the server afterwards.

### Copy backups off the box

Snapshots live on the same disk as the database, so they do not survive losing the VPS. LeadOS has no built-in off-box upload; copy the folder with a scheduled job instead. For example, an hourly `rsync` from the production checkout to another host (adjust the paths and host):

```bash
0 * * * * rsync -a --ignore-existing /home/ubuntu/apps/lead-os-prod/data/backups/ backup-user@backup-host:/srv/lead-os-backups/
```

Or, with an S3-compatible bucket and the AWS CLI:

```bash
0 * * * * aws s3 sync /home/ubuntu/apps/lead-os-prod/data/backups/ s3://your-bucket/lead-os-backups/ --only-show-errors
```

Test a restore from an off-box copy now and then, and never run these against the development checkout's data.

## Troubleshooting

### Problem: I Cannot Find A Hostinger Subdomain Screen

For this VPS setup, that is usually fine.

Use the DNS Zone Editor and create an `A` record for the subdomain instead.

### Problem: DNS Record Exists But HTTPS Fails

Check:

1. the hostname resolves to the correct VPS IP
2. ports `80` and `443` are open
3. `nginx` is running
4. `certbot --nginx` was run against the exact hostname

### Problem: The App Loads But API Calls Fail

Check:

1. `lead-os` is running
2. `curl -s http://localhost:3001/api/health` works on the VPS
3. `nginx` is proxying to `127.0.0.1:3001`
4. `nginx` was reloaded after the config change

### Problem: Developer URL Opens The Wrong Page

Use the direct route:

- `https://dashboard.YOUR_DOMAIN/my-day`

If you want `developer.YOUR_DOMAIN/` to jump to `/my-day`, add the optional `nginx` redirect after the main deployment works.

## Final Recommendation

For the first stable rollout, use:

- `dashboard.YOUR_DOMAIN`

Then give:

- managers: `https://dashboard.YOUR_DOMAIN/`
- developers: `https://dashboard.YOUR_DOMAIN/my-day`

Only move to two hostnames if you still want the convenience after the single-hostname setup is already working.

## Reference Links

- [Hostinger: point a domain to your VPS](https://www.hostinger.com/support/1583227-how-to-point-a-domain-to-your-vps-at-hostinger/)
- [Hostinger: create a subdomain](https://www.hostinger.com/support/1583205-how-to-create-a-subdomain/)
- [NGINX: reverse proxy guide](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy)
- [Certbot: NGINX instructions](https://certbot.eff.org/instructions?ws=nginx&os=snap)
- [Ubuntu Server: firewall documentation](https://documentation.ubuntu.com/server/how-to/security/firewalls/)
- [Let's Encrypt FAQ](https://letsencrypt.org/docs/faq/)
