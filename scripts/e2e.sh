#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

S="127.0.0.1:3000"
HOSTGW="--add-host=host.docker.internal:host-gateway"
SERVER_ENV="host.docker.internal:3000"
NONET_LOG="$(mktemp)"

say() { printf '\n=== %s ===\n' "$1"; }

cleanup() {
  docker rm -f arena-server profile avatar profile2 avatar2 avatar-nonet avatar-degrade >/dev/null 2>&1 || true
  docker network rm arena >/dev/null 2>&1 || true
  docker volume rm me me2 >/dev/null 2>&1 || true
  rm -f "$NONET_LOG"
}
trap cleanup EXIT
cleanup

say "build"
docker build -q -t infratify/arena-server ./server
docker build -q -t infratify/arena-avatar ./avatar

say "1. happy path: network + profile + nama + server + avatar"
docker network create arena >/dev/null
docker run -d --name profile --network arena -v me:/data redis >/dev/null
sleep 1
docker exec profile redis-cli SET nama "Ariff" >/dev/null
docker run -d --name arena-server -p 3000:3000 infratify/arena-server >/dev/null
sleep 1
docker run -d --name avatar --network arena $HOSTGW -p 8080:8080 \
  -e COLOR="cyan" -e SERVER="$SERVER_ENV" infratify/arena-avatar >/dev/null
sleep 2
( cd server && node ../scripts/assert.mjs "ws://$S" "Ariff" 0 )

say "2. movement + score climbs"
( cd server && node -e "const W=require('ws');const w=new W('ws://127.0.0.1:8080');w.on('open',()=>{let n=0;const t=setInterval(()=>{w.send(JSON.stringify({t:'move',dir:'right'}));if(++n>=5){clearInterval(t);w.close();}},100);});" )
sleep 2
( cd server && node ../scripts/assert.mjs "ws://$S" "Ariff" 1 )

say "3. volume proof: kill profile, re-run from volume me, nama survived"
docker rm -f profile >/dev/null
docker run -d --name profile --network arena -v me:/data redis >/dev/null
sleep 1
GOT=$(docker exec profile redis-cli GET nama)
[ "$GOT" = "Ariff" ] && echo "OK nama survived: $GOT" || { echo "FAIL nama=$GOT"; exit 1; }
SCORE=$(docker exec profile redis-cli GET score)
echo "score persisted: $SCORE"; [ "${SCORE:-0}" -ge 1 ] || { echo "FAIL score not persisted"; exit 1; }

say "4. network proof: avatar WITHOUT --network arena fails loud, server unaffected"
set +e
timeout 20 docker run --name avatar-nonet $HOSTGW -e SERVER="$SERVER_ENV" infratify/arena-avatar >"$NONET_LOG" 2>&1
CODE=$?
set -e
grep -q -- "--network arena" "$NONET_LOG" && [ "$CODE" -ne 0 ] && echo "OK loud fail (exit $CODE)" || { echo "FAIL no loud error"; cat "$NONET_LOG"; exit 1; }
docker rm -f avatar-nonet >/dev/null 2>&1 || true
( cd server && node ../scripts/assert.mjs "ws://$S" "Ariff" 0 ) && echo "OK server still serving"

say "5. graceful degrade: bogus SERVER, :8080 still serves"
docker run -d --name avatar-degrade --network arena $HOSTGW -p 8090:8080 \
  -e COLOR="pink" -e SERVER="10.255.255.1:3000" infratify/arena-avatar >/dev/null
sleep 2
curl -fsS http://localhost:8090/ | grep -q "<title>Arena" && echo "OK degrade serves :8080"
docker rm -f avatar-degrade >/dev/null

say "6. two players share the room"
docker run -d --name profile2 --network arena -v me2:/data redis >/dev/null
sleep 1
docker exec profile2 redis-cli SET nama "Siti" >/dev/null
docker run -d --name avatar2 --network arena $HOSTGW -p 8081:8080 \
  -e COLOR="orange" -e SERVER="$SERVER_ENV" -e REDIS_HOST="profile2" infratify/arena-avatar >/dev/null
sleep 2
( cd server && node ../scripts/assert.mjs "ws://$S" "Ariff" 0 ) && echo "OK first player still present"
( cd server && node ../scripts/assert.mjs "ws://$S" "Siti" 0 ) && echo "OK second player joined"

say "ALL PROOFS PASSED"
