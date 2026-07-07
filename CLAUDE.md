# CLAUDE.md — devops-bootcamp-game

A minimal, live **multiplayer 2D avatar arena** built as a *teaching prop* for the
DevOps bootcamp **Docker 3** session (volumes + user-defined networks + registry
pull). It is not a real product — its only job is to make three Docker concepts
**visible and fun** for a non-technical cohort (60% "heard of Docker", hands-on
weak, may not know SDLC).

> **This repo does not exist to be a game. It exists to make `docker run`,
> `-v`, `--network`, and `-e` produce a visible, social payoff.** Every design
> decision serves that, not gameplay depth.

## The one-sentence pitch (to a student)

"Run two containers on your laptop — a *remember-box* and an *avatar* — wire them
together, and your character walks into the room everyone can see on the screen.
Kill your containers, run them again, and your character is exactly as you left
it."

## Why this shape (the pedagogy contract)

Docker 3 teaches three things; this prop maps each to something a beginner can
*see*:

| Docker concept (Docker 3 LO) | What the student does | What they see |
|---|---|---|
| **Registry pull** (LO1) | `docker run ghcr.io/infratify/arena-avatar` | They pull *my* published image — "you pull a cattle template from a registry", the mirror of pushing their own app to ECR earlier in the session |
| **Named volume** (LO2) | `-v me:/data` on the profile store | Kill the container, re-run, character (name/colour/score) **survived** |
| **User-defined network** (LO3) | `docker network create arena` + `--network arena` | The avatar finds the profile store **by name**; without the network it **fails** (built-in productive-failure) |

### Pets vs cattle (the session's reinforcing spine — keep it literal-anchored)

- **The containers are cattle** — `docker rm -f` them freely, run new ones. Numbered, disposable.
- **The volume `me` is the pet** — your character lives here; it must survive the cattle.
- **The user-defined network `arena` is how cattle find each other** — by *name*, because a container's IP changes every run (memorising an IP is pet-thinking).
- **The shared room is reached by a published port + the host's IP** — the `-p` / IP they already know from Docker 1–2.

Always pair the analogy with the literal mechanism on the same slide (per the
slides repo's literal-pedagogy rule). Pets/cattle is a *reinforcement* device at
this stage (containers already taught literally in Docker 1–2), not a
first-contact metaphor.

## The single-host networking truth (design-critical — do not get this wrong)

**Docker user-defined networks are single-host.** They only connect containers on
the *same machine*. Students on different laptops **cannot** share one Docker
network with the instructor's server. So there are two distinct "networking"
things, in two places:

1. **Student joins the shared room** → connects to the instructor server's
   **published port + IP** (`-e SERVER=<host-ip>:3000`). This is `-p` /
   port-mapping — already known, *reused*, not the new concept.
2. **The user-defined network (the actual LO3 concept — by-name resolution)** →
   demonstrated **locally on each student's own machine**, between *their* avatar
   container and *their* profile store. This is the hands-on LO3.

This split is a feature: every student does LO2 + LO3 hands-on, and only the
*join* reaches across the network to the shared server.

## Architecture (3 components)

```
  INSTRUCTOR (one host, EC2, security-group port 3000 open)
  ┌─────────────────────────────┐
  │  arena-server  (published)  │  ← shared 2D room + projector/spectator view at /
  └──────────────▲──────────────┘
                 │  WebSocket to <host-ip>:3000  (published port + IP; reused -p concept)
   ┌─────────────┴───────────────────────────────────┐
   │ EACH STUDENT (their own laptop / Docker Desktop) │
   │   docker network create arena                    │
   │   ┌───────────────┐   by name    ┌────────────┐  │
   │   │ avatar        │ ───"profile"──▶│ profile    │  │
   │   │ (arena-avatar)│  over "arena" │ (redis)    │  │
   │   │  -e SERVER    │               │ -v me:/data│  │  ← volume "me" = the pet
   │   │  -e COLOR     │               └────────────┘  │
   │   │  -p 8080:8080 │                                │
   │   └───────────────┘  serves localhost:8080 view   │
   └──────────────────────────────────────────────────┘
```

1. **`infratify/arena-server`** *(I build + publish)* — the shared room. Instructor
   runs **one** on EC2. WebSocket hub: accepts avatar joins, tracks
   `{name, colour, x, y}`, broadcasts the roster to everyone. Serves a spectator
   canvas at `/` for the projector (everyone watches avatars pop in). Room state
   is **ephemeral** (no server-side persistence — keeps it simple; persistence is
   the *student's* job via their volume). Env: `PORT` (default 3000).

2. **`redis`** *(turnkey official image — do not build)* — each student's **profile
   store**, run as `--name profile -v me:/data`. Holds their character
   (`name`, `colour`, `score`, last position). Framed on slides as "kotak ingatan"
   (memory box) — **never** "database"/"SQL". **Ensure durable persistence to the
   volume**: the avatar issues `SAVE` (RDB) on every profile write. Do **not** use
   AOF (`--appendonly yes`) — a plain `redis` re-run boots `appendonly no`, loads
   `dump.rdb`, and ignores the AOF, silently breaking the volume proof — so `SAVE`
   is what makes the "kill it, character survived" demo reliable.

3. **`infratify/arena-avatar`** *(I build + publish)* — each student's client.
   - Env: `COLOR` (avatar colour, per-run), `SERVER` (`ip:port` of the instructor
     room), `REDIS_HOST` (default `profile`). **No `NAME` env** — the name is read
     from the profile store (volume), so the persistent identity survives restarts.
   - On start: connect to `profile` (redis) **by name** over `arena` → read `nama`
     (+ colour fallback) → connect to `SERVER` WebSocket → serve a small canvas
     client at `localhost:8080` where the student sees the room and moves
     (arrows/WASD, **8-directional** — hold two keys for diagonals). Movement +
     score changes write back to redis (so the volume matters).
   - Must **fail loudly and clearly** if it can't resolve `profile` (that failure
     IS the network lesson) and **degrade gracefully** if `SERVER` is unreachable
     (still runs locally so the volume/network labs work without the shared room).

## The pinned student-facing contract (SOURCE OF TRUTH — shared with the slides)

The Docker 3 slides (`slides/2026/docker3/`) author commands **verbatim** from
this block. **If you rename an image, env var, port, volume, or network here, you
MUST update the slides** (`outlines/2026/docker3.md` + `slides/2026/docker3/pages/`).
Keep this contract stable.

```bash
# ---- LO2 volume: a remember-box that keeps your character ----
docker network create arena
docker run -d --name profile --network arena -v me:/data redis
docker exec profile redis-cli SET nama "Ariff"      # seed your persistent name

# ---- LO3 network: your avatar reads "profile" by name, then joins the room ----
docker run -d --name avatar --network arena -p 8080:8080 \
  -e COLOR="cyan" -e SERVER="<instructor-ip>:3000" \
  ghcr.io/infratify/arena-avatar
# open http://localhost:8080  → you're in as "Ariff"; everyone sees you on the projector

# ---- volume proof (pets vs cattle) ----
docker rm -f profile
docker run -d --name profile --network arena -v me:/data redis   # same volume "me"
docker exec profile redis-cli GET nama              # → "Ariff" — survived

# ---- network proof (productive failure) ----
docker run -d --name avatar -p 8080:8080 -e SERVER="..." ghcr.io/infratify/arena-avatar
#   ^ no --network arena  → avatar cannot resolve "profile" → clear error
#   add --network arena   → works
```

**Env vs volume split (deliberate teaching distinction):** `nama` lives in the
profile store (volume `me`) → **persists** across restarts; `COLOR` is passed as
`-e COLOR` → **per-run config**, ephemeral. The avatar reads `nama` from `profile`
by name (which is *why* it needs the network), and takes `COLOR`/`SERVER` from env.

- **Owner/namespace:** `infratify` (matches the bootcamp glossary; `infratify.com` domain).
  Images are published to GHCR: `ghcr.io/infratify/arena-{server,avatar}` (the `Infratify`
  org is lowercased for the registry).
- **Fixed identifiers:** network `arena`, profile container `profile`, avatar
  container `avatar`, volume `me`, avatar client port `8080`, server port `3000`.
- Students **only ever `docker run`** — they never build the game. Building is
  handled here; images are published to a registry they pull from.

## Tech stack (recommendation — lean, reliable, matches the cohort's toolchain)

- **Node 20+** (the bootcamp already teaches `node:20`; `arena-*` images `FROM node:20-alpine`).
- **`ws`** for WebSockets (tiny, battle-tested). No game engine.
- **PixiJS v8 (vendored browser build) on an HTML5 `<canvas>` + native `WebSocket`** for the client view — Pixi is committed into each image (`public/vendor/pixi.min.js`, global `PIXI`, no bundler/build step, no CDN) so it stays bulletproof and offline-cacheable. Avatars are **16×32 pixel-art chibi sprites** (vendored `public/sprites/char-{idle,walk}.png`, 32×32 frames × 4 frames × 5 facing rows), left white and given a per-player **colour ring + nameplate** rather than tinting the sprite; facing + walk animation are derived client-side from movement (see the design specs).
- **`redis` npm client** in the avatar for the profile store.
- Keep total dependencies minimal. No build step beyond what's needed; small images.

Alternative considered and rejected: a terminal/TUI client — lighter on
classroom logistics but arrow-key/raw-mode handling over `docker run -it` is
finicky and less "cool". Browser canvas wins on the wow factor the cohort needs.

## Hosting the shared server (in class)

- Run `arena-server` on an **EC2 instance with a security-group inbound rule for
  port 3000** — robust, and it's another AWS muscle-memory beat the cohort will
  recognise (they set up security groups in AWS 1–4).
- Not the instructor's laptop: classroom wifi often isolates clients, blocking
  laptop-to-laptop inbound connections.
- A Cloudflare Tunnel to a locally-run server is a fallback (they learned Tunnel
  in Cloudflare 2) but EC2 + open port is simpler and more reliable.

## Build status

**Built and proven (2026-07-06).** `arena-server` + `arena-avatar` + `redis` join a
shared room; the full pinned `docker run` flow is verified end-to-end by
`scripts/e2e.sh` (volume survival, loud-fail without `--network arena`, graceful
degrade, two-player room), plus 38 `node:test` unit/integration tests. Node/ESM,
`ws` + `redis`, PixiJS v8 vendored. Merged to `main`. Design + plan live in
`docs/superpowers/specs/2026-07-06-arena-design.md` and
`docs/superpowers/plans/2026-07-06-arena.md`.

**UI/UX sprite overhaul (2026-07-07, merged to `main`).** Procedural avatars replaced
by pixel-art chibi sprites with 8-direction movement + facing and a colour ring +
nameplate cue; both the projector and student views share one `arena-avatar.js`
factory + a pure, unit-tested `arena-anim.js`. Contract-stable (no image/env/port/
volume/network/roster/message change → slides unaffected). Load-tested: 60 avatars
moving continuously ≈ **4.6% of one CPU core**, ~69 MB RSS, steady 20 roster
broadcasts/sec of ~4.6 KB — comfortable headroom for a full cohort. Specs/plan:
`docs/superpowers/specs/2026-07-06-arena-sprite-overhaul-design.md`,
`docs/superpowers/plans/2026-07-06-arena-sprite-overhaul.md`.

**Published to GHCR (2026-07-07).** CI (`.github/workflows/publish-images.yml`) builds both
images multi-arch (amd64/arm64) and pushes to `ghcr.io/infratify/arena-server` +
`ghcr.io/infratify/arena-avatar` on `v*` tags or manual dispatch; `v1.0.0` + `latest` are
live. The `Infratify` org name is lowercased in the workflow (GHCR refs must be lowercase).
One manual step remains before students can pull: flip the two GHCR packages to **public**
in the org's package settings.

Done:
1. ✅ **Prototype proven first** — with the real `docker run` flow via
   `scripts/e2e.sh` (two simulated students on one host). **No `docker compose`** was
   needed or used — compose stays Docker 4's payoff; Docker 3 wires by hand on purpose.
2. ✅ `arena-server`: WebSocket hub + spectator canvas at `/`. Ephemeral roster.
3. ✅ `arena-avatar`: redis-by-name profile load/init → WS join → canvas at `:8080`
   → movement/score persisted to redis.
4. ✅ Failure modes: clear error when `profile` unresolvable; graceful local-only
   when `SERVER` unreachable; hub survives a misbehaving avatar.
5. ✅ Durable redis persistence to `/data` via explicit `SAVE` (RDB) on writes —
   **not** AOF (a plain `redis` re-run boots `appendonly no` and loads `dump.rdb`,
   ignoring the AOF).

6. ✅ **Published to GHCR** — `.github/workflows/publish-images.yml` (matrix build,
   multi-arch amd64/arm64) pushes `ghcr.io/infratify/arena-server` +
   `ghcr.io/infratify/arena-avatar` on `v*` tags / manual dispatch; `v1.0.0` + `latest`
   are live. Remaining manual step: set the GHCR packages **public** so students pull
   unauthenticated.

Remaining:
7. ⬜ **Sync the slides** (`outlines/2026/docker3.md` + `slides/2026/docker3/`) to the
   pinned contract — the pull refs are now GHCR-prefixed (`ghcr.io/infratify/arena-*`).

## Guardrails

- **Must be rock-solid for a live class.** A buggy prop in front of a hands-weak
  cohort that must finish in-class is a disaster. Prototype and prove before slides.
- **Students only `docker run`.** No game code, no builds on their side.
- **Low-jargon.** "Remember-box", "room", "avatar" — never "database", "pub/sub",
  "state machine".
- **Fail loud in the prop** (unresolvable `profile` = the lesson), but never crash
  the shared room because one avatar misbehaves.
- **Contract stability.** The pinned command block above is a shared interface with
  the slides repo — treat renames as breaking changes.

## Related

- Slides repo: `~/repo/slides-devops-bootcamp` — outline `outlines/2026/docker3.md`,
  deck `slides/2026/docker3/`.
- The three.js app pushed to ECR in Docker 3 LO1 (a *different* prop): `~/repo/devops-bootcamp-app`.
