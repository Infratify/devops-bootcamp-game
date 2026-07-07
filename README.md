# devops-bootcamp-game

A live multiplayer 2D avatar arena used as a teaching prop in the **Docker 3**
bootcamp session: students run two containers on their laptop, wire them
together, and their character walks into a shared room shown on a projector. The
design rationale and the student-facing command contract live in
[`CLAUDE.md`](./CLAUDE.md).

Three moving parts:

| Component | Built from | Image | Port |
|---|---|---|---|
| `arena-server` — the shared room | `server/` | `ghcr.io/infratify/arena-server` | 3000 |
| `arena-avatar` — the student client | `avatar/` | `ghcr.io/infratify/arena-avatar` | 8080 |
| profile store | official image (not built here) | `redis` | 6379 |

## Repository layout

```
server/     arena-server — shared room + spectator/projector view
avatar/     arena-avatar — student client; reads redis, joins the room
scripts/    e2e.sh (full docker end-to-end) + assert.mjs helper
assets/     source pixel-art (Aseprite files + sheets) the sprites derive from
docs/       design specs and implementation plans
.github/    publish-images.yml — CI that builds + pushes both images to GHCR
CLAUDE.md   design rationale + the pinned student command contract
```

## Components

### `server/` → `arena-server`

Node 20, ESM, depends on `ws`. A WebSocket hub plus static HTTP server on `PORT`
(default 3000). It tracks an ephemeral roster of connected avatars and broadcasts
it to everyone, and serves the spectator/projector canvas at `/`. No server-side
persistence — surviving a restart is the student's volume job.

- `src/app.js` — HTTP + WebSocket server, serves `public/`
- `src/room.js` — roster and world state, input sanitisation, world bounds
- `src/messages.js` — wire protocol (`welcome`, `roster`) parse/build
- `src/constants.js` — world dimensions
- `public/` — spectator view (`spectator.js`, `index.html`) + the shared render code

### `avatar/` → `arena-avatar`

Node 20, ESM, depends on `ws` and `redis`. On start it connects to the profile
store **by name** (`REDIS_HOST`, default `profile`), reads the persistent `nama`,
then connects to the shared room (`SERVER`) and serves the student's canvas at
`:8080`. It fails loudly if it can't reach `profile` (that failure is the network
lesson) and degrades to local-only if `SERVER` is unreachable.

- `src/index.js` — entry: wires the redis store + room link, prints the loud
  "remember-box not found" banner, handles graceful shutdown
- `src/app.js` — local HTTP + WebSocket view on `:8080`
- `src/store.js` — redis client; reads/writes the profile, issues `SAVE` on write
- `src/roomlink.js` — WebSocket client to the shared server, with auto-reconnect
- `src/movement.js` — 8-direction movement math + world clamping
- `src/character.js` — colour resolution (`COLOR` env → stored → default)
- `src/messages.js`, `src/constants.js`
- `public/` — student view (`avatar.js`, `index.html`) + the shared render code

Env: `COLOR` (per-run colour), `SERVER` (`ip:port` of the room), `REDIS_HOST`
(default `profile`). There is deliberately no `NAME` env — the name is read from
the volume so it survives restarts.

### profile store — `redis`

The official image, run as `--name profile -v me:/data`. Holds each student's
character (name, colour, score, last position). The avatar issues `SAVE` (RDB) on
every write so the character survives `docker rm -f`. Not built in this repo.

### Shared browser client

Both `public/` directories carry the same rendering code, kept in sync:

- `vendor/pixi.min.js` — PixiJS v8, vendored (no CDN, no build step)
- `arena-anim.js` — pure facing/walk animation logic, derived from movement (unit-tested)
- `arena-avatar.js` — sprite factory: white 16×32 chibi + per-player colour ring + nameplate
- `sprites/char-idle.png`, `char-walk.png` — 32×32 frames across 5 facing rows

## Build & run

Images are published to GHCR by CI (below). To build from source instead:

```bash
docker build -t infratify/arena-server ./server
docker build -t infratify/arena-avatar ./avatar
```

The full student flow — plus the volume and network proofs — is the pinned
contract in [`CLAUDE.md`](./CLAUDE.md). The short version:

```bash
docker network create arena
docker run -d --name profile --network arena -v me:/data redis
docker exec profile redis-cli SET nama "Ariff"
docker run -d --name avatar --network arena -p 8080:8080 \
  -e COLOR="cyan" -e SERVER="<instructor-ip>:3000" infratify/arena-avatar
# open http://localhost:8080
```

## Develop & test

Each package is standalone; run `npm install` in `server/` and `avatar/`.

```bash
cd server && npm install && npm start    # room on :3000
cd avatar && npm install && npm start     # needs a reachable redis + SERVER

npm test            # in either package — node --test unit/integration suites
./scripts/e2e.sh    # full docker end-to-end: volume survival, loud-fail without
                    # --network arena, graceful degrade, two-player room
```

## CI

`.github/workflows/publish-images.yml` builds both images (multi-arch
`amd64`/`arm64`) and pushes them to GHCR on a `v*` tag or manual dispatch:

- `ghcr.io/infratify/arena-server`
- `ghcr.io/infratify/arena-avatar`

The org is `Infratify`; the workflow lowercases it because GHCR references must be
lowercase. The packages must be set to public in the org's package settings
before students can pull them unauthenticated.

## More

- [`CLAUDE.md`](./CLAUDE.md) — why the prop is shaped this way, the single-host
  networking split, the pinned command contract, and hosting the room on EC2.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — design specs and build plans.
