#!/usr/bin/env bash
# E2E proof for the Docker 4 STUDENT EDIT (Amali 5/6): extend the canonical
# compose.yaml with a second avatar. Pinned extension (slides quote verbatim):
#   profile2  — redis, volume me2:/data  (own remember-box; two avatars MUST
#               NOT share one profile: x/y/score keys would clobber)
#   avatar2   — arena-avatar, ports "8081:8080", REDIS_HOST: profile2,
#               COLOR different, SERVER local or "<instructor-ip>:3000"
#   volumes   — me2: added at top level
# Proves: one `up -d` → 5 services; both :8080/:8081 serve; distinct namas in
# the server roster; avatar2 writes isolated to profile2.
set -euo pipefail
cd "$(dirname "$0")/.."

P="arena2e2e"
TMP="$(mktemp -d)"
SPEC="$PWD/scripts/assert.mjs"
SRVDIR="$PWD/server"

python3 - "$PWD/compose.yaml" "$TMP/compose.yaml" <<'EOF'
import re, sys
src = open(sys.argv[1]).read()
ext = '''
  profile2:
    image: redis
    volumes:
      - me2:/data

  avatar2:
    image: ghcr.io/infratify/arena-avatar
    ports:
      - "8081:8080"
    environment:
      COLOR: red
      SERVER: server:3000
      REDIS_HOST: profile2
    depends_on:
      - profile2
      - server
'''
out = re.sub(r'\nvolumes:\n  me:\n', ext + '\nvolumes:\n  me:\n  me2:\n', src)
assert out != src, 'top-level volumes block not found — compose.yaml drifted?'
open(sys.argv[2], 'w').write(out)
EOF

cd "$TMP"
DC="docker compose -p $P -f compose.yaml"
NET="${P}_default"
fail() { printf '\nFAIL: %s\n' "$1"; $DC logs --no-color 2>&1 | tail -40 || true; exit 1; }
cleanup() { $DC down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

running() { $DC ps --status running --services | sort | tr '\n' ' '; }
up8080() { curl -fsS http://localhost:8080/ >/dev/null 2>&1; }
up8081() { curl -fsS http://localhost:8081/ >/dev/null 2>&1; }
spectate() { docker run --rm --network "$NET" -v "$SPEC:/app/assert.mjs" \
    ghcr.io/infratify/arena-avatar node /app/assert.mjs ws://server:3000 "$1" "$2"; }
move() { ( cd "$SRVDIR" && node -e "const W=require('ws');const w=new W('ws://127.0.0.1:$1');w.on('open',()=>{let n=0;const t=setInterval(()=>{w.send(JSON.stringify({t:'move',dir:'right'}));if(++n>=6){clearInterval(t);setTimeout(()=>w.close(),300);}},100);});w.on('error',e=>{console.error(e);process.exit(1);});" ); }

echo "=== 1. one up -d: 5 services ==="
$DC config >/dev/null || fail "extended compose.yaml did not parse"
$DC up -d
for i in $(seq 1 40); do [ "$(running)" = "avatar avatar2 profile profile2 server " ] && break; sleep 1; done
[ "$(running)" = "avatar avatar2 profile profile2 server " ] || fail "not all 5 running: [$(running)]"
echo "OK 5 services running"

echo "=== 2. both avatars serve ==="
for i in $(seq 1 20); do up8080 && up8081 && break; sleep 1; done
up8080 || fail ":8080 not serving"
up8081 || fail ":8081 not serving (REDIS_HOST: profile2 unresolved?)"
echo "OK :8080 + :8081 serving"

echo "=== 3. distinct namas, both in server roster ==="
$DC exec -T profile  redis-cli SET nama "Satu" >/dev/null
$DC exec -T profile2 redis-cli SET nama "Dua"  >/dev/null
$DC restart avatar avatar2 >/dev/null
for i in $(seq 1 20); do up8080 && up8081 && break; sleep 1; done
ok=0; for i in $(seq 1 8); do spectate "Satu" 0 >/dev/null 2>&1 && { ok=1; break; }; sleep 1; done
[ "$ok" = 1 ] || fail "roster missing 'Satu'"
spectate "Dua" 0 >/dev/null 2>&1 || fail "roster missing 'Dua' (avatar2 not joined?)"
echo "OK roster shows Satu + Dua"

echo "=== 4. isolation: avatar2 writes ONLY to profile2 ==="
move 8081; sleep 2
S2=$($DC exec -T profile2 redis-cli GET score); S1=$($DC exec -T profile redis-cli GET score)
echo "profile2 score=${S2:-<none>} profile score=${S1:-<none>}"
[ "${S2:-0}" -ge 1 ] || fail "avatar2 move did not persist to profile2"
[ "${S1:-0}" -eq 0 ] 2>/dev/null || [ -z "${S1:-}" ] || fail "avatar2 move leaked into profile (score=$S1)"
echo "OK writes isolated per profile"

echo "ALL AVATAR2 EXTENSION PROOFS PASSED"
