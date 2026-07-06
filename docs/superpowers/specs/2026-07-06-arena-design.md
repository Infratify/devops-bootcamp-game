# Arena — build design (Docker 3 teaching prop)

**Date:** 2026-07-06
**Status:** design approved, ready for implementation plan
**Contract source of truth:** [`CLAUDE.md`](../../../CLAUDE.md) — the pinned
student-facing command block and fixed identifiers live there and are shared with
the slides repo. This spec designs *how we build* to satisfy that contract; it does
**not** redefine it. If the two ever disagree, `CLAUDE.md` wins.

---

## 1. Scope of this build session

Build the real thing and **prove it locally by hand** (the actual `docker run`
flow a student uses), so the slides can depend on it (`CLAUDE.md` milestone #1,
"de-risk first"). Concretely: milestones 1–5.

**In scope**
- `arena-server` — WebSocket hub + spectator canvas at `/`.
- `arena-avatar` — redis-by-name profile load/init → WS join → interactive canvas
  at `:8080` → movement + score persisted to redis.
- `redis` profile store with durable persistence to the `me` volume.
- Failure modes: loud fail when `profile` unresolvable; graceful local-only when
  `SERVER` unreachable; hub survives a misbehaving avatar.
- Verification by running the pinned `docker run` commands and asserting behavior.

**Out of scope (deferred)**
- Publishing images to a registry (milestone 6) — needs registry creds/decisions.
- A `docker-compose.yml` — the instructor/student flow is by-hand `docker run`;
  compose is Docker 4's payoff and not needed to prove this. (Per user direction.)

---

## 2. The pinned contract (restated from `CLAUDE.md` — do not drift)

```bash
# LO2 volume — a remember-box that keeps your character
docker network create arena
docker run -d --name profile --network arena -v me:/data redis
docker exec profile redis-cli SET nama "Ariff"      # seed your persistent name

# LO3 network — your avatar reads "profile" by name, then joins the room
docker run -d --name avatar --network arena -p 8080:8080 \
  -e COLOR="cyan" -e SERVER="<instructor-ip>:3000" \
  infratify/arena-avatar
# open http://localhost:8080 → you're in as "Ariff"

# volume proof
docker rm -f profile
docker run -d --name profile --network arena -v me:/data redis
docker exec profile redis-cli GET nama              # → "Ariff" — survived

# network proof (productive failure)
docker run -d --name avatar -p 8080:8080 -e SERVER="..." infratify/arena-avatar
#   ^ no --network arena → cannot resolve "profile" → clear error; add it → works
```

**Fixed identifiers:** network `arena` · profile container `profile` · avatar
container `avatar` · volume `me` · avatar view port `8080` · server port `3000` ·
namespace `infratify`.

**Env vs volume split (deliberate teaching distinction):**
- `nama` lives in the profile store (volume `me`) → **persists** across restarts.
  Seeded by the student with `redis-cli SET nama`. The avatar **reads** it; it
  never fabricates or overwrites it.
- `COLOR` is passed `-e COLOR` → **per-run config**, ephemeral.
- `SERVER` is `-e SERVER` → which room to join (published port + IP; the reused
  `-p` concept, not the new LO3 concept).

---

## 3. Architecture & components

Three components; only two are ours to build.

### 3.1 `arena-server` (we build → `infratify/arena-server`)
The shared room. Instructor runs **one** on EC2 (security-group port `3000` open).
- One HTTP server on `PORT` (default `3000`) that:
  - serves the spectator page at `/` (static `public/`), and
  - accepts WebSocket upgrades on the same port.
- Ephemeral in-memory roster: `Map<id, {nama, colour, x, y, score}>`. No
  server-side persistence — persistence is the *student's* job via their volume.
- Two kinds of WS clients:
  - **avatars** — send `join` then `update`; get added to the roster.
  - **spectators** (the projector page) — send `hello:spectator`; receive roster
    broadcasts but never appear in the roster.
- Broadcasts the roster to everyone, **coalesced** to ≤ ~20 msgs/s (one pending
  broadcast scheduled per tick, not one per inbound message).
- **Robustness is a hard requirement:** every inbound message is JSON-parsed and
  validated inside try/catch; malformed input is ignored, never fatal. One avatar
  can never crash the hub or disrupt other players. A dropped socket just removes
  its roster entry and rebroadcasts.

### 3.2 `redis` (turnkey official image — we do NOT build)
Each student's profile store. Run exactly as the contract says: `redis`, no extra
flags. Durability is achieved by the **avatar** issuing `SAVE` (see §6) — this is
what lets the student command stay a bare `redis`.

### 3.3 `arena-avatar` (we build → `infratify/arena-avatar`)
Each student's client, and the only process on the `arena` network that talks to
both `profile` and the room. It is a **relay**: the browser at `localhost:8080` is
a thin view; it never touches redis or the server directly (see §4).
- Env: `COLOR` (per-run colour), `SERVER` (`ip:port` of the room, optional-ish —
  absence/unreachable → local-only), `REDIS_HOST` (default `profile`). The view
  port is fixed at `8080`.
- Startup sequence in §4; failure behavior in §7.

---

## 4. Data flow (the important part)

The container does the container-networking; the browser is a dumb screen.

```
browser (localhost:8080) ──WS──► avatar process ──redis (by name)──► profile
      ▲   renders room               │                               (nama, colour,
      └────── roster ────────────────┤                                score, x, y)
                                      └──WS──► arena-server (join + updates;
                                               broadcasts roster back)
```

**Avatar startup:**
1. Connect to redis at `REDIS_HOST` (default `profile`). **Cannot resolve/connect
   → fail loud and exit non-zero** (this is the LO3 lesson — see §7.1).
2. `GET nama`.
   - present → that's the persistent name.
   - absent → in-memory placeholder `tanpa-nama`, log a plain-language hint
     (`run: docker exec profile redis-cli SET nama "YourName"`). Do **not** write
     `nama` — the student owns that identity.
3. Resolve colour: `COLOR` env wins → else stored `colour` key → else a default.
4. Load `score`, `x`, `y` (defaults: `0`, and a spawn position). Persist any
   newly-initialized fields, then **`SAVE` once** so the student's seeded `nama`
   (and defaults) are flushed to `dump.rdb` on the volume immediately (§6).
5. Start the local HTTP server on `8080`: serves the interactive Pixi page and a
   WS endpoint for the browser.
6. Connect to `SERVER` over WS and send `join {nama, colour, x, y, score}`.
   **Unreachable → local-only mode** (§7.2): keep serving `:8080`, keep persisting,
   show a "not in the room yet" banner, retry connection in the background.

**Runtime loop:** browser keydown → avatar computes new `x,y` (clamped) and
`score += 1` → updates in memory → debounced write to redis + `SAVE` (§6) → sends
`update {x, y, score}` to server → server rebroadcasts roster → avatar forwards it
to the browser → Pixi renders everyone.

---

## 5. WebSocket protocol

Small, explicit JSON messages. Unknown/malformed messages are ignored.

**Browser → avatar process**
- `{"t":"move","dir":"up|down|left|right"}` — one step in a direction.

**Avatar process → browser**
- `{"t":"you","id","nama","colour","x","y","score","room":true|false}` — initial
  self state + whether the room is connected.
- `{"t":"roster","players":[{id,nama,colour,x,y,score}]}` — full roster to render.
- `{"t":"room","connected":true|false}` — room connection status changed (banner).

**Avatar process → arena-server**
- `{"t":"join","nama","colour","x","y","score"}`
- `{"t":"update","x","y","score"}`

**Spectator page → arena-server**
- `{"t":"hello","role":"spectator"}`

**arena-server → all**
- `{"t":"roster","players":[{id,nama,colour,x,y,score}]}` (coalesced).

Full-roster broadcasts (not deltas) keep clients trivially correct and stateless;
roster size is a classroom (tens), so payload is negligible.

---

## 6. Redis data model & persistence (get this exactly right)

**Top-level string keys** (not a hash), to match the contract's `SET nama` /
`GET nama` verbatim: `nama`, `colour`, `score`, `x`, `y`.

**Persistence = RDB via explicit `SAVE`. Not AOF.** Rationale (the trap):
- The volume proof re-runs a **plain** `redis` container. Plain redis boots with
  `appendonly no`, so on restart it loads `dump.rdb` and **ignores any AOF**.
- Therefore enabling AOF at runtime (`CONFIG SET appendonly yes`) would silently
  *not* survive `docker rm -f profile` + re-run. RDB is the only mechanism the
  restarted plain container will actually read back.
- So the avatar issues `SAVE` (writes `/data/dump.rdb`):
  - **once on startup** (flushes the student's seeded `nama` to disk), and
  - **debounced (~750 ms)** after movement writes, and
  - **on graceful shutdown** (SIGTERM/SIGINT).
- `SAVE` blocks redis, but the dataset is a handful of keys → sub-millisecond;
  debouncing avoids disk churn during rapid movement. (`BGSAVE` is an acceptable
  alternative but adds "already in progress" handling for no real benefit here.)

This is what makes "kill it → `GET nama` still returns Ariff, score intact"
reliable, while keeping the student's `docker run … redis` command flag-free.

---

## 7. Failure modes

### 7.1 Loud fail — unresolvable `profile` (the LO3 lesson)
If redis can't be resolved/connected at startup, print a clear, boxed,
plain-language message and `exit(1)`:
> Couldn't find your remember-box **"profile"**. Your avatar and profile must be
> on the same network. Did you add `--network arena` to `docker run`?

No stack trace as the headline; low-jargon (never "DNS"/"resolve"). The failure
*is* the teaching moment, so it must read like a lesson, not a crash.

### 7.2 Graceful degrade — `SERVER` unreachable
If the room can't be reached (missing/blocked/instructor server down): the avatar
still serves `:8080`, still loads/saves the character, still lets the student move
(score still climbs and persists). The page shows a calm banner ("You're set up —
waiting for the room…"), and the avatar retries the WS connection with backoff so
it joins automatically when the room appears. The volume + network labs work with
no shared server at all.

### 7.3 Hub robustness
The server never trusts avatar input (§3.1). A malformed message, a flood, or an
abrupt disconnect affects only that one connection.

---

## 8. Visual design (procedural, tinted — zero asset files)

Everything drawn in PixiJS; no external art. Deliberate art direction, not flat
shapes.

- **Avatar:** a rounded "bean" creature drawn with `Graphics`, **tinted live by
  `-e COLOR`** (this makes the colour env var a visible payoff). Two small eyes, a
  soft outer glow. Squash/bounce on each step, and smooth interpolation between
  roster updates (avatars glide, don't teleport).
- **Name is the primary identity; colour is secondary.** With a 50+ cohort the
  distinguishable-colour budget is small and colours *will* repeat, so the `nama`
  label is **always shown** above every avatar (never hover-only), rendered as
  crisp `Text`/`BitmapText` with a dark outline/halo so it stays legible over any
  avatar colour, over the grid, and on a projector at the back of the room. Colour
  is flair and a rough grouping cue, not the disambiguator. We do **not** enforce
  unique colours (collisions are fine, even funny) — the name disambiguates.
- **Designed for a crowd:** the world is a large fixed play area (~1600×1000) that
  the spectator view fits to screen, and avatars **spawn spread out** across it
  (not stacked on one point) so 50+ names don't pile up on arrival. Labels carry a
  small vertical offset + halo so that even when two avatars overlap, both names
  stay readable.
- **Room:** coded background — soft radial gradient, a subtle grid, a gentle
  vignette; a title and a live player count. Feels like an inviting space.
- **Feedback:** a little particle pop when a player joins and small dust on steps
  (cheap `Graphics`/particles — no assets).
- **Self-marker:** the student's own avatar gets a ring + "you" tag so they can
  pick themselves out of a crowd on both their screen and the projector.
- **Colour handling:** parse `COLOR` permissively (named CSS colours + hex) via
  Pixi's `Color`; fall back to a pleasant default on garbage input (never crash).

The spectator page (`/`) and the avatar page (`:8080`) share this look but differ
in behavior: spectator is watch-only; avatar adds input + the "you" marker + the
room-status banner.

---

## 9. Tech & repo layout

- **Node 20** in the images (`FROM node:20-alpine`) to match the cohort's
  toolchain, even though local dev is newer. Deps: `ws` (both), `redis` (avatar).
- **PixiJS v8**, vendored as the **browser build** (`pixi.min.js`, global `PIXI`)
  into each package's `public/vendor/` and loaded with a plain `<script>` tag —
  **no bundler, no build step, works offline, no CDN** (classroom wifi is hostile).
  Pixi is MIT; ship its licence alongside the vendored file.
- Two self-contained packages (mirrors the two images; keeps units small):

```
server/
  package.json            # ws
  src/index.js            # HTTP + WS hub + static serving
  public/index.html       # spectator canvas
  public/spectator.js     # Pixi render of the roster
  public/vendor/pixi.min.js
  Dockerfile              # FROM node:20-alpine
avatar/
  package.json            # ws, redis
  src/index.js            # redis-by-name + WS-to-server + local HTTP/WS for browser
  public/index.html       # interactive canvas
  public/avatar.js        # Pixi render + input + banner
  public/vendor/pixi.min.js
  Dockerfile              # FROM node:20-alpine
docs/superpowers/specs/2026-07-06-arena-design.md
.dockerignore  .gitignore
```

A shared render routine is intentionally **not** extracted yet (the two pages
differ enough); revisit only if duplication actually hurts.

---

## 10. Verification plan (prove by hand — no compose)

Build both images, then run the pinned commands and assert. A small Node WS client
drives assertions; Playwright screenshots the spectator canvas for visual proof.

1. **Build:** `docker build` both images succeed; images are small.
2. **Happy path:** `network create arena` → run `profile` → `SET nama "Ariff"` →
   run `arena-server` (published `:3000`) → run `avatar` (`-e COLOR=cyan
   -e SERVER=<host-ip>:3000`). Assert (WS spectator client): a player `nama=Ariff`,
   `colour≈cyan` appears in the roster. Screenshot `/` shows the tinted avatar.
3. **Movement + score:** drive `move` via the avatar's `:8080` WS; assert `x/y`
   change and `score` increments in the broadcast roster.
4. **Volume proof:** `docker rm -f profile` → re-run `profile` from volume `me` →
   `redis-cli GET nama` returns `"Ariff"`; re-run avatar → `score` is the prior
   value, not `0`.
5. **Network proof (loud fail):** run `avatar` **without** `--network arena`;
   assert it exits non-zero with the §7.1 message and the server stays up and
   unaffected.
6. **Graceful degrade:** run `avatar` with a bogus/unreachable `SERVER`; assert
   `:8080` still serves and movement still persists to redis.
7. **Two players:** run a second avatar (second volume/name); assert both appear in
   the roster and on the spectator canvas — the "shared room" payoff.

All assertions must pass before the design is considered proven and before slides
depend on the contract.

---

## 11. Risks & notes
- **Host IP for `SERVER` in local proof:** avatar container reaches the server via
  the host's IP + published `:3000` (not the arena network — the room is single-host
  across-machine over published port). Use the host LAN IP / `host.docker.internal`
  as available; document what worked.
- **`SAVE` timing:** the startup `SAVE` is what makes a *seeded-but-not-yet-moved*
  profile durable; keep it unconditional on connect.
- **Colour parsing** must never throw on bad `COLOR` — fall back to default.
- **Contract stability:** any rename here (image/env/port/volume/network) is a
  breaking change that must be mirrored into the slides repo per `CLAUDE.md`.
