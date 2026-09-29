# Auth Admin CLI

Run these from the checkout whose SQLite data you want to manage.

On the production server, run auth admin commands with the system Node/npm path pinned to `/usr/bin`.
The production service uses `/usr/bin/node`; this prevents an interactive shell with nvm from picking a different Node version and failing to load native modules such as `better-sqlite3`.

```bash
env PATH=/usr/bin:/bin:$PATH /usr/bin/npm ...
```

For local development, plain `npm ...` is fine when your shell Node version matches the installed `node_modules`.

## Create An Isolated Manager Workspace

Use this when a manager should have their own Jira config, team roster, synced issues, Team Tracker, and settings.

```bash
env PATH=/usr/bin:/bin:$PATH /usr/bin/npm run auth:create-user --workspace=server -- \
  --username new-manager \
  --password 'change-me' \
  --display-name 'New Manager' \
  --role manager
```

If users already exist, this creates a new manager-owned workspace.

## Delete A Shared-Workspace Manager Login

Use this for a manager account accidentally created from Settings inside another manager's workspace.

First preview the deletion:

```bash
env PATH=/usr/bin:/bin:$PATH /usr/bin/npm run auth:delete-user --workspace=server -- \
  --username shared-manager \
  --workspace-id default \
  --role manager \
  --dry-run
```

Then delete the login account:

```bash
env PATH=/usr/bin:/bin:$PATH /usr/bin/npm run auth:delete-user --workspace=server -- \
  --username shared-manager \
  --workspace-id default \
  --role manager \
  --confirm shared-manager
```

By default this removes only the app login and active sessions. It keeps shared workspace data such as Jira config, issues, team members, tags, and Team Tracker data.

## Optional Private Data Purge

If the mistaken manager account was used and you also want to remove its private manager data, add `--purge-private-data`:

```bash
env PATH=/usr/bin:/bin:$PATH /usr/bin/npm run auth:delete-user --workspace=server -- \
  --username shared-manager \
  --workspace-id default \
  --role manager \
  --confirm shared-manager \
  --purge-private-data
```

This removes that manager's alert dismissals, saved Team Tracker views, and Manager Desk data. Linked tracker work is preserved and detached from the deleted Manager Desk items.

## Reset A Password

Use this when someone is locked out or has forgotten their password. It works for any active account (manager, developer, admin), sets the new password without needing the old one, and signs the account out on every device.

Prefer `--password-stdin` so the password does not land in shell history or `ps`:

```bash
printf '%s' 'new-password-here' | env PATH=/usr/bin:/bin:$PATH /usr/bin/npm run auth:reset-password --workspace=server -- \
  --username alice \
  --password-stdin
```

Or pass it directly (visible in shell history and process listings):

```bash
env PATH=/usr/bin:/bin:$PATH /usr/bin/npm run auth:reset-password --workspace=server -- \
  --username alice \
  --password 'new-password-here'
```

The command prints `{ reset, username, role, sessionsRevoked }` and never prints the password. The same length rules as account creation apply (8 to 200 characters). Unknown or inactive usernames fail with an error.

The in-app path is Settings > Developer access > **Reset password**. It is manager-only and works for developer accounts only; a manager cannot reset another manager's password from the UI, so a lost manager password is recovered with this command on the host. It also clears any login lockout for that username.

Note that a lockout from failed attempts is held in memory per client IP and username; it expires by itself after at most 15 minutes and is cleared by a restart of the service.

## Safety Rules

The delete command refuses to delete:

- the workspace owner manager account
- the last active manager in a workspace
- a user whose role does not match `--role`

Use `--dry-run` before deleting, and take a backup before production account maintenance.
