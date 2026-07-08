#!/usr/bin/env bash
# End-to-end proof for the canonical compose.yaml (Docker 4 payoff).
# Verifies that ONE `docker compose up` brings the whole arena up:
#   - the project network + `me` volume are auto-created (no `docker network create`)
#   - avatar finds `profile` (redis) AND `server` (arena-server) BY NAME
#   - short-form `depends_on` is enough (avatar does not lose the race to redis)
#   - pets/cattle: `down` keeps the `me` volume, `up` restores the character
set -euo pipefail
cd "$(dirname "$0")/.."

P="arenae2e"                       # isolated compose project name
DC="docker compose -p $P -f compose.yaml"
NET="${P}_default"
VOL="${P}_me"
SPEC="$PWD/scripts/assert.mjs"

say() { printf '\n=== %s ===\n' "$1"; }
fail() { printf '\nFAIL: %s\n' "$1"; $DC logs --no-color 2>&1 | tail -40 || true; exit 1; }

cleanup() { $DC down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# spectator: connect to the arena-server BY NAME from inside the project network,
# using the avatar image (it bundles `ws` at /app/node_modules). Proves server
# discovery works with no published port + no `docker network create`.
spectate() { # <nama> <min-score>
  docker run --rm --network "$NET" -v "$SPEC:/app/assert.mjs" \
    ghcr.io/infratify/arena-avatar node /app/assert.mjs ws://server:3000 "$1" "$2"
}
running() { $DC ps --status running --services | sort | tr '\n' ' '; }
avatar_up() { curl -fsS http://localhost:8080/ >/dev/null 2>&1; }

say "0. no version: key (compose v2), config parses clean"
$DC config >/dev/null || fail "compose.yaml did not parse"
grep -qE '^\s*version:' compose.yaml && fail "compose.yaml must NOT carry a version: key (v2)" || true

say "1. ONE command up: network + volume + 3 containers auto-created"
$DC up -d
for i in $(seq 1 30); do [ "$(running)" = "avatar profile server " ] && break; sleep 1; done
[ "$(running)" = "avatar profile server " ] || fail "not all 3 services running: [$(running)]"
docker network ls --format '{{.Name}}' | grep -qx "$NET" || fail "project network $NET not auto-created"
docker volume  ls --format '{{.Name}}' | grep -qx "$VOL" || fail "named volume $VOL not auto-created"
echo "OK 3 services up; network $NET + volume $VOL auto-created"

say "2. avatar reached profile (redis) BY NAME — serves :8080, no crash"
for i in $(seq 1 20); do avatar_up && break; sleep 1; done
avatar_up || fail "avatar :8080 not serving (redis race / profile unresolved?)"
docker inspect -f '{{.State.Status}}' "${P}-avatar-1" | grep -qx running || fail "avatar container not running"
echo "OK avatar serving :8080 (profile resolved by name over the project network)"

say "3. seed name in the me volume, avatar rejoins, server sees it BY NAME"
$DC exec -T profile redis-cli SET nama "Ariff" >/dev/null
$DC restart avatar >/dev/null
for i in $(seq 1 20); do avatar_up && break; sleep 1; done
for i in $(seq 1 5); do spectate "Ariff" 0 && break || sleep 1; done
spectate "Ariff" 0 || fail "server never saw avatar 'Ariff' (server not resolved by name?)"
echo "OK arena-server saw avatar 'Ariff' via ws://server:3000 (server by name)"

say "4. move avatar → score climbs → persisted to the me volume"
( cd server && node -e "const W=require('ws');const w=new W('ws://127.0.0.1:8080');w.on('open',()=>{let n=0;const t=setInterval(()=>{w.send(JSON.stringify({t:'move',dir:'right'}));if(++n>=6){clearInterval(t);setTimeout(()=>w.close(),300);}},100);});w.on('error',e=>{console.error(e);process.exit(1);});" )
sleep 2
SCORE=$($DC exec -T profile redis-cli GET score); echo "score in volume: ${SCORE:-<none>}"
[ "${SCORE:-0}" -ge 1 ] || fail "score did not persist to the volume"

say "5. pets/cattle: down keeps the me volume, up restores the character"
$DC down    # NOTE: no -v → volume must survive
docker network ls --format '{{.Name}}' | grep -qx "$NET" && fail "network survived down (should be gone)" || true
docker volume  ls --format '{{.Name}}' | grep -qx "$VOL" || fail "volume me was removed by plain down (should persist)"
$DC up -d
for i in $(seq 1 30); do [ "$(running)" = "avatar profile server " ] && break; sleep 1; done
GOTN=$($DC exec -T profile redis-cli GET nama); GOTS=$($DC exec -T profile redis-cli GET score)
[ "$GOTN" = "Ariff" ] || fail "nama did not survive down/up (got '$GOTN')"
[ "${GOTS:-0}" -ge 1 ] || fail "score did not survive down/up (got '$GOTS')"
echo "OK after down+up: nama='$GOTN' score=$GOTS survived (cattle came and went, pet 'me' stayed)"

say "6. depends_on race stress: 3× down/up, avatar must never lose to redis"
for r in 1 2 3; do
  $DC down >/dev/null
  $DC up -d >/dev/null
  ok=0
  for i in $(seq 1 25); do avatar_up && { ok=1; break; }; sleep 1; done
  [ "$ok" = 1 ] || fail "round $r: avatar failed to come up (depends_on race?)"
  docker inspect -f '{{.State.Status}}' "${P}-avatar-1" | grep -qx running \
    || fail "round $r: avatar not running after up"
  echo "OK round $r: avatar up, no race"
done

say "ALL COMPOSE PROOFS PASSED — short-form depends_on is sufficient"
