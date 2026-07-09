#!/usr/bin/env bash
# E2E proof for the Docker 4 STUDENT EDIT (Amali 4/5/6): extend the canonical
# compose.yaml with a second avatar using the SAVE-SLOT model. Pinned extension
# (slides quote verbatim) — ONE profile, ONE volume, no exec:
#   avatar2 — arena-avatar, ports "8081:8080", SLOT: "2" (its own save file in
#             the shared remember-box; two avatars must never share bare keys —
#             x/y/score would clobber), NAME (nameplate, written through to the
#             save), COLOR different, SERVER local or "<instructor-ip>:3000".
# Proves: one `up -d` → 4 services; both :8080/:8081 serve; roster shows the
# NAME env with zero exec; avatar2 writes land under 2:* only.
#
# Builds the avatar image locally so the proof covers the working tree (the
# published GHCR image must carry the same code — publish before class).
set -euo pipefail
cd "$(dirname "$0")/.."

P="arena2e2e"
IMG="ghcr.io/infratify/arena-avatar:e2e-local"
TMP="$(mktemp -d)"
SPEC="$PWD/scripts/assert.mjs"
SRVDIR="$PWD/server"

docker build -q -t "$IMG" avatar >/dev/null

python3 - "$PWD/compose.yaml" "$TMP/compose.yaml" "$IMG" <<'EOF'
import re, sys
src_path, dest_path, img = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(src_path).read()
ext = f'''
  avatar2:
    image: {img}
    ports:
      - "8081:8080"
    environment:
      COLOR: red
      NAME: Dua
      SLOT: "2"
      SERVER: server:3000
    depends_on:
      - profile
      - server
'''
out = re.sub(r'\nvolumes:\n  me:\n', ext + '\nvolumes:\n  me:\n', src)
assert out != src, 'top-level volumes block not found — compose.yaml drifted?'
# avatar1 also runs the locally built image so the bare-key default is proven
out = out.replace('image: ghcr.io/infratify/arena-avatar\n', f'image: {img}\n')
open(dest_path, 'w').write(out)
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
    "$IMG" node /app/assert.mjs ws://server:3000 "$1" "$2"; }
move() { ( cd "$SRVDIR" && node -e "const W=require('ws');const w=new W('ws://127.0.0.1:$1');w.on('open',()=>{let n=0;const t=setInterval(()=>{w.send(JSON.stringify({t:'move',dir:'right'}));if(++n>=6){clearInterval(t);setTimeout(()=>w.close(),300);}},100);});w.on('error',e=>{console.error(e);process.exit(1);});" ); }

echo "=== 1. one up -d: 4 services, one profile, one volume ==="
$DC config >/dev/null || fail "extended compose.yaml did not parse"
$DC up -d
for i in $(seq 1 40); do [ "$(running)" = "avatar avatar2 profile server " ] && break; sleep 1; done
[ "$(running)" = "avatar avatar2 profile server " ] || fail "not all 4 running: [$(running)]"
echo "OK 4 services running"

echo "=== 2. both avatars serve ==="
for i in $(seq 1 20); do up8080 && up8081 && break; sleep 1; done
up8080 || fail ":8080 not serving"
up8081 || fail ":8081 not serving (SLOT/NAME env broke boot?)"
echo "OK :8080 + :8081 serving"

echo "=== 3. NAME lands in the roster with ZERO exec ==="
ok=0; for i in $(seq 1 8); do spectate "Dua" 0 >/dev/null 2>&1 && { ok=1; break; }; sleep 1; done
[ "$ok" = 1 ] || fail "roster missing 'Dua' (NAME env not honoured?)"
N2=$($DC exec -T profile redis-cli GET "2:nama")
[ "$N2" = "Dua" ] || fail "NAME not written through to the save (2:nama='$N2')"
echo "OK roster shows Dua; 2:nama persisted"

echo "=== 4. save-slot isolation: avatar2 writes ONLY under 2:* ==="
move 8081; sleep 2
S2=$($DC exec -T profile redis-cli GET "2:score"); S1=$($DC exec -T profile redis-cli GET score)
echo "2:score=${S2:-<none>} score=${S1:-<none>}"
[ "${S2:-0}" -ge 1 ] || fail "avatar2 move did not persist under 2:score"
[ "${S1:-0}" -eq 0 ] 2>/dev/null || [ -z "${S1:-}" ] || fail "avatar2 leaked into bare score ($S1)"
echo "=== 5. bare keys still belong to avatar1 (Docker 3 flow unchanged) ==="
move 8080; sleep 2
S1=$($DC exec -T profile redis-cli GET score)
[ "${S1:-0}" -ge 1 ] || fail "avatar1 move did not persist to bare score"
echo "OK writes isolated per save slot"

echo "ALL SAVE-SLOT PROOFS PASSED"
