#!/usr/bin/env bash
# Registration dry run (docs/72 SR-13): bootstrap an owner, issue an invite, sign a friend up and
# check isolation both ways on a THROWAWAY install. Never run this against production data.
#
# The workspace root is a temp directory, so data/ and backups land there, not in the repo. Jira is
# pointed at an unroutable address and no sync runs. Usage: scripts/registration-dry-run.sh [port]
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$(mktemp -d -t leados-dryrun.XXXXXX)"
PORT="${1:-3092}"
trap 'kill "$(cat "$S/pid" 2>/dev/null)" 2>/dev/null; rm -rf "$S"' EXIT
mkdir -p "$S/server" "$S/data/backups"
cd "$S/server"

export NODE_ENV=development JIRA_API_TOKEN=scratch-not-real JIRA_BASE_URL=http://127.0.0.1:9 \
  JIRA_AUTO_SYNC_ENABLED=false PORT=$PORT LEADOS_PUBLIC_URL=http://127.0.0.1:$PORT \
  DASHBOARD_DB_PATH="$S/data/run.db"
TSX="$REPO/node_modules/.bin/tsx"
J='-H Content-Type:application/json'
pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; pass=$((pass+1)); else echo "FAIL  $1 expected=$2 actual=$3"; fail=$((fail+1)); fi
}
start() { LEADOS_REGISTRATION=$1 "$TSX" "$REPO/server/src/index.ts" >"$S/server.log" 2>&1 & echo $! >"$S/pid"; for i in $(seq 1 60); do curl -s -o /dev/null localhost:$PORT/api/auth/bootstrap && return; sleep 1; done; echo "server did not start"; tail -20 "$S/server.log"; exit 1; }
stop() { kill "$(cat "$S/pid")" 2>/dev/null; sleep 2; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "== 1. registration OFF"
start off
check "invite check 404 when off" 404 "$(code "localhost:$PORT/api/auth/invite?token=x")"
check "signup 404 when off" 404 "$(code -X POST $J -d '{"inviteToken":"x","username":"friend","displayName":"F","password":"Str0ng!pass-123"}' localhost:$PORT/api/auth/signup)"
echo "-- bootstrap owner"
check "bootstrap owner 201" 201 "$(code -c "$S/owner.jar" -X POST $J -d '{"username":"owner","password":"Owner-pass-12345","displayName":"Owner","role":"manager"}' localhost:$PORT/api/auth/register)"
check "second anonymous register refused" 401 "$(code -X POST $J -d '{"username":"x2","password":"Owner-pass-12345","displayName":"X","role":"manager"}' localhost:$PORT/api/auth/register)"
curl -s -b "$S/owner.jar" $J localhost:$PORT/api/capture -o "$S/cap.json" -w 'capture %{http_code}\n' -d '{"text":"OWNER-SECRET-TASK call vendor","clientToday":"2026-10-10","tz":"UTC"}'
curl -s -b "$S/owner.jar" -X PUT $J -d '{"body":"OWNER-SECRET-NOTE private","revision":0}' localhost:$PORT/api/notes/2026-10-10 -w 'note %{http_code}\n' -o /dev/null
stop

echo "== 2. registration INVITE"
start invite
cd "$S/server"
INV=$(LEADOS_REGISTRATION=invite "$TSX" "$REPO/server/src/scripts/invite.ts" --create --note "dry-run friend" 2>"$S/inv.err")
TOKEN=$(echo "$INV" | sed -n 's/.*invite=\([^"]*\)".*/\1/p')
echo "$INV" | sed 's/invite=[^"]*/invite=<redacted>/'
check "invite list omits token" 0 "$(LEADOS_REGISTRATION=invite "$TSX" "$REPO/server/src/scripts/invite.ts" --list | grep -c "$TOKEN")"
check "valid invite check 200" 200 "$(code "localhost:$PORT/api/auth/invite?token=$TOKEN")"
check "bad invite 410 on signup" 410 "$(code -X POST $J -d '{"inviteToken":"nope","username":"friend","displayName":"Friend","password":"Friend-pass-12345"}' localhost:$PORT/api/auth/signup)"
check "signup 201" 201 "$(code -c "$S/friend.jar" -X POST $J -d "{\"inviteToken\":\"$TOKEN\",\"username\":\"friend\",\"displayName\":\"Friend\",\"password\":\"Friend-pass-12345\",\"timeZone\":\"Asia/Kolkata\"}" localhost:$PORT/api/auth/signup)"
check "invite reuse 410" 410 "$(code -X POST $J -d "{\"inviteToken\":\"$TOKEN\",\"username\":\"friend2\",\"displayName\":\"Friend\",\"password\":\"Friend-pass-12345\"}" localhost:$PORT/api/auth/signup)"

echo "== 3. isolation"
ME=$(curl -s -b "$S/friend.jar" localhost:$PORT/api/auth/me)
echo "friend session: $(echo "$ME" | tr -d '\n' | cut -c1-260)"
OWNER_WS=$(curl -s -b "$S/owner.jar" localhost:$PORT/api/auth/me | sed -n 's/.*"workspaceId":"\([^"]*\)".*/\1/p')
FRIEND_WS=$(echo "$ME" | sed -n 's/.*"workspaceId":"\([^"]*\)".*/\1/p')
check "different workspaces" 1 "$([ -n "$FRIEND_WS" ] && [ "$OWNER_WS" != "$FRIEND_WS" ] && echo 1 || echo 0)"
check "friend not install admin" 0 "$(echo "$ME" | grep -c '"isInstallAdmin":true')"
for p in "/api/tasks?viewDef=%7B%7D&tz=UTC" "/api/today?tz=UTC" "/api/notes/2026-10-10" "/api/team/developers"; do
  body=$(curl -s -b "$S/friend.jar" "localhost:$PORT$p")
  check "friend sees no owner data: $p" 0 "$(echo "$body" | grep -c 'OWNER-SECRET')"
done
# /api/search echoes the query, so judge it by the result rows, not the raw body.
check "friend search results empty" 0 "$(curl -s -b "$S/friend.jar" "localhost:$PORT/api/search?q=OWNER-SECRET" | grep -o '"title":"[^"]*"' | grep -c OWNER-SECRET)"
check "owner search finds own data (positive control)" 1 "$([ "$(curl -s -b "$S/owner.jar" "localhost:$PORT/api/search?q=OWNER-SECRET" | grep -o '"title":"[^"]*"' | grep -c OWNER-SECRET)" -ge 1 ] && echo 1 || echo 0)"
check "owner sees own note" 1 "$(curl -s -b "$S/owner.jar" localhost:$PORT/api/notes/2026-10-10 | grep -c OWNER-SECRET-NOTE)"
check "friend /api/backups forbidden" 403 "$(code -b "$S/friend.jar" localhost:$PORT/api/backups)"
check "owner /api/backups allowed" 200 "$(code -b "$S/owner.jar" localhost:$PORT/api/backups)"
check "friend PUT backup settings forbidden" 403 "$(code -b "$S/friend.jar" -X PUT $J -d '{"backupIntervalMinutes":60}' localhost:$PORT/api/config/settings)"
curl -s -b "$S/friend.jar" $J -d '{"text":"FRIEND-ONLY-TASK","clientToday":"2026-10-10","tz":"UTC"}' localhost:$PORT/api/capture -o /dev/null -w 'friend capture %{http_code}\n'
check "owner search shows no friend data" 0 "$(curl -s -b "$S/owner.jar" "localhost:$PORT/api/search?q=FRIEND-ONLY" | grep -o '"title":"[^"]*"' | grep -c FRIEND-ONLY)"
check "friend search finds own task (positive control)" 1 "$(curl -s -b "$S/friend.jar" "localhost:$PORT/api/search?q=FRIEND-ONLY" | grep -o '"title":"[^"]*"' | grep -c FRIEND-ONLY)"
check "friend logout 200" 200 "$(code -b "$S/friend.jar" -X POST localhost:$PORT/api/auth/logout)"
check "owner login still ok" 200 "$(code -X POST $J -d '{"username":"owner","password":"Owner-pass-12345"}' localhost:$PORT/api/auth/login)"
stop

echo "== 4. kill switch back OFF; existing accounts keep working"
start off
check "signup 404 again" 404 "$(code -X POST $J -d '{"inviteToken":"x","username":"z","displayName":"Z","password":"Friend-pass-12345"}' localhost:$PORT/api/auth/signup)"
check "friend can still log in" 200 "$(code -X POST $J -d '{"username":"friend","password":"Friend-pass-12345"}' localhost:$PORT/api/auth/login)"
stop

echo "== 5. delete-workspace dry run (no --apply)"
cd "$S/server"
"$TSX" "$REPO/server/src/scripts/delete-workspace.ts" --workspace "$FRIEND_WS" | head -12
echo "default refused:"; "$TSX" "$REPO/server/src/scripts/delete-workspace.ts" --workspace default --confirm default --apply 2>&1 | head -2

echo; echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
