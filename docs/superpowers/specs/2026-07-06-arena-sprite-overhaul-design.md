# Arena avatar sprite overhaul — design

**Date:** 2026-07-06
**Status:** approved for planning
**Branch:** `feat/avatar-sprite-overhaul`
**Related:** `docs/superpowers/specs/2026-07-06-arena-design.md` (original build), `CLAUDE.md` (pinned contract)

## 1. Goal

Replace the procedurally-drawn avatars (a tinted `roundRect` body + two dots) with
real pixel-art chibi sprites that **walk into the room facing where they're going**,
give avatars **smooth 8-direction movement + facing**, and give the flat grid room a
light procedural polish.

It is **almost** presentation-only: the one behavioural addition is diagonal
(8-way) movement, which touches the avatar image's own movement code and its unit
tests. It still changes **no student-facing contract** — image names, env vars, ports,
volume, network, the WebSocket roster protocol, and the internal `{t:'move',dir}`
message shape are all unchanged, so `scripts/e2e.sh` and the Docker 3 slides need no
update.

The white sprites carry no colour, so each player's `COLOR` is shown with an
added indicator rather than by tinting the character.

## 2. Non-goals (YAGNI)

- No run / jump / attack / interact / rotate animations — **idle + walk only**.
- No environment tilesets (the recovered assets are characters only).
- No server-side facing/animation state, no protocol/roster fields — everything is derived on the client.
- No change to the internal `{t:'move',dir}` message shape or one-step-per-message server logic (keeps `e2e.sh` valid); diagonal support is added by extending the *set* of directions, not the message.
- No 16×16 sprite set — the 16×32 set is the one we ship.
- No new gameplay. The prop's job is unchanged: make `-v`, `--network`, and the registry pull produce a visible, social payoff.

## 3. Verified asset facts (source of truth for slicing)

Source: `github.com/ErisEsra/Character-Templates`, extracted to the repo's (untracked)
`assets/` folder — `assets/16x32/` set. Sheets used: `16x32 Idle-Sheet.png`,
`16x32 Walk-Sheet.png`. **These facts were verified empirically (per-cell alpha bbox +
zoomed head reads) and confirmed live in a browser artifact before this spec.**

- **Frame size is 32×32** — *not* 16×32 despite the folder name. The character art
  (~16px wide) is centred on the 16px column boundary, so slicing at 16px splits every
  sprite in half. Idle and Walk sheets are each `128×160` = **4 animation frames × 5 facing rows**.
- **Rows = facings:** `0` = front (down), `1` = ¾-front, `2` = side, `3` = ¾-back, `4` = back (up).
- **Native turned rows (1, 2, 3) face RIGHT** (row 1 = ¾-front facing **down-right**,
  row 2 = side facing **right**, row 3 = ¾-back facing **up-right**). Therefore:
  - a rightward heading → native sprite (no flip),
  - a leftward heading → horizontally mirrored (`scale.x = -1`).
  - Getting this backwards makes left-movement face right (the bug we already hit and fixed in the artifact).
- **Columns = the 4-frame loop.** The walk cycle is a symmetric open/close scissor gait
  (feet together ↔ feet apart); it reads as walking in the correct direction because
  *facing* comes from the mirror/row, not from the frame order.
- **Anchor = centre-bottom (feet):** `anchor (0.5, 1.0)` so the position is the feet point.

**All five rows are used**, and mirroring the three turned rows yields **8 directions**:
S = row 0, SE = row 1, E = row 2, NE = row 3, N = row 4, then NW / W / SW = rows 3 / 2 / 1
mirrored. This is why diagonal movement is added (§4.5) — without it the ¾ rows (1, 3)
would never be reachable.

## 4. Architecture

Two separate Node images (`arena-server`, `arena-avatar`) each serve their own
browser client from their own `public/`, with `pixi.min.js` **vendored per-image**
(no shared build step, no CDN, offline-cacheable). The overhaul follows that same
vendored pattern for both the sprite sheets and the new shared render code.

### 4.1 Asset pipeline

Copy the two used sheets into **both** clients (byte-identical, like vendored pixi):

```
avatar/public/sprites/char-idle.png     server/public/sprites/char-idle.png
avatar/public/sprites/char-walk.png     server/public/sprites/char-walk.png
```

(~3–4 KB each.) Source: `assets/16x32/16x32 {Idle,Walk}-Sheet.png`. The raw `assets/`
folder and `assets.zip` are development sources; add `assets.zip` and `st.mp3` to
`.gitignore`. Commit the two processed PNGs (they're required inside the images).

Loaded via `PIXI.Assets.load`; the texture source `scaleMode` is set to `'nearest'`
so pixels stay crisp when scaled up (~3× → 96px tall on-screen).

### 4.2 Shared render modules (vendored into both publics)

Two new files, **identical copies** in `avatar/public/` and `server/public/`
(the vendored-duplication tradeoff is deliberate — the build contexts are separate
subdirectories, mirroring how `pixi.min.js` is already duplicated):

- **`arena-anim.js`** — *pure, no PIXI, no DOM.* Exports the movement→animation logic:
  - `facingFromVelocity(dx, dy, prev)` → `{ row, flip }` — **8-way**:
    - `dx === 0 && dy === 0` → return `prev` (keep last facing when idle)
    - both axes significant (`min(|dx|,|dy|) > max(|dx|,|dy|) * DIAG_RATIO`) → ¾ facing:
      `{ row: dy > 0 ? 1 : 3, flip: dx < 0 }` (down-diag = ¾-front row 1, up-diag = ¾-back row 3; mirror leftward)
    - else if `|dx| >= |dy|` → `{ row: 2, flip: dx < 0 }` (side; mirror leftward)
    - else → `{ row: dy < 0 ? 4 : 0, flip: false }` (up = back row, down = front row)
  - `isMoving(dx, dy, eps = 0.6)` → boolean (below `eps` px of pending movement = idle)
  - `frameAt(elapsedMs, fps, nFrames = 4)` → integer frame index
  This module is the **unit-tested** heart of the feature (see §7).

- **`arena-avatar.js`** — the `createAvatar(p, opts)` factory (uses global `PIXI` + the loaded sheet textures + `arena-anim.js`). Builds one `PIXI.Container`:
  - **feet ring** — `PIXI.Graphics` ellipse at the feet, filled with `COLOR` (low alpha) and stroked with `COLOR`; doubles as the drop shadow.
  - **sprite** — a `PIXI.Sprite` whose texture is swapped each tick to `(sheet[state], row, frame)`; `anchor (0.5, 1)`, `scale.x = ±SPRITE_SCALE` for mirroring. **Untinted** (stays white).
  - **nameplate** — rounded-rect `Graphics` filled with `COLOR` + a `PIXI.Text` name (readable ink chosen by luminance), above the head.
  - **score** — small `PIXI.Text` under the nameplate.
  - **"you" marker** — a soft dashed ring, shown only when `setYou(true)` (avatar view).
  - Returns `{ c, target, setColour, setName, setScore, setYou, update(dt) }`.
  - `update(dt)` centralises per-tick work: compute `dx,dy = target − c.position`, derive `{row,flip}` + moving via `arena-anim.js`, pick idle/walk sheet, advance the frame, swap the sprite texture, then tween the container toward `target` (the tween currently living in each view's ticker moves here).

### 4.3 View integration

Both view scripts drop their duplicated procedural `makeAvatar`/`tintOf` and call the shared factory. They become ES modules so they can `import` the shared code; `pixi.min.js` stays a classic script tag loaded first (global `PIXI`).

- **`avatar/public/avatar.js`** — student's `localhost:8080` view. Uses `createAvatar(p, { you: true-capable })`, keeps keyboard input + the "waiting for room" banner. Calls `av.update(dt)` per tick; sets `av.setYou(p.id === myId)`.
- **`server/public/spectator.js`** — projector view. Same factory, no input, keeps the "N in the room" count.
- **`*/public/index.html`** — change the client `<script>` to `type="module"`; keep `pixi.min.js` as the preceding classic script. **Keep `<title>Arena…` and DOM ids `#stage / #count / #banner / #hint`** unchanged (logic + `e2e.sh` grep depend on them). Light CSS polish to the HUD/banner only.

### 4.4 Room polish (procedural, no tiles)

In the shared `drawBackground` (duplicated per view): centre radial light + edge
vignette over the existing `WORLD_W×WORLD_H` field, lower-contrast grid, and a
rounded play-area border to frame the arena. Add **depth sorting**: each tick, sort
the avatar layer's children by feet `y` so nearer avatars overlap correctly (a cheap
win that reads well on the projector). No world-size or coordinate changes.

### 4.5 Diagonal (8-way) movement

To make the ¾ facings reachable, the avatar moves in 8 directions. This is done
**without** changing the `{t:'move',dir}` message shape or the one-step-per-message
server logic (so `e2e.sh` and scoring are untouched):

- **`avatar/src/movement.js`** (Node): extend `DIRS` with the four diagonals
  (`upleft`, `upright`, `downleft`, `downright`). **Normalize diagonal speed** so a
  diagonal step isn't √2 faster — each diagonal component ≈ `STEP * 0.7071` (rounded),
  keeping per-tick distance ≈ `STEP`. `isDir` / `move` then accept them automatically;
  `app.js` and `messages.js` need no change (they defer to `isDir`).
- **`avatar/public/avatar.js`** (browser input): replace "one send per keydown" with a
  **held-key model** — `keydown`/`keyup` maintain a `Set` of pressed keys; a throttled
  sender (~`SEND_MS`, e.g. every 60 ms) composes the resultant 8-way `dir` from the held
  set and emits `{t:'move',dir}` while any movement key is down. Holding ↑+→ sends
  `upright`; releasing stops sends → the avatar settles to idle.
- **Scoring** stays "+1 per `move` message" server-side; the browser throttle keeps the
  rate sane (it becomes a smooth activity counter). `e2e.sh` still sends 5 discrete
  messages → score 5, unchanged.
- **Facing** for every viewer still comes from the interpolation delta via
  `facingFromVelocity` (§4.2), which now resolves all 8 directions.

## 5. Data flow (unchanged)

Roster stays `{ id, nama, colour, x, y, score }`. The server still relays position
updates and broadcasts the roster; the avatar still sends `{ t: 'move', dir }`. Facing
and idle-vs-walk are computed **only** on each client from the interpolation delta
(`target − current`). No new message types, no new fields → **the pinned contract and
the slides are untouched.**

## 6. Colour cue → pedagogy mapping

- **Feet ring = `-e COLOR`** — per-run config, ephemeral; change it every launch.
- **Nameplate = `nama`** — read from the profile store (volume `me`); survives `docker rm -f`.

One avatar shows both Docker 3 ideas at once: the ring is the throwaway env knob,
the name is the thing the volume remembers. Reinforcement only — always paired with
the literal mechanism, per the slides' literal-pedagogy rule.

## 7. Testing & verification

- **New unit tests** (`node:test`), against the pure `arena-anim.js`:
  - `facingFromVelocity` — all 8 directions: E → `{row:2, flip:false}`, W → `{row:2, flip:true}`,
    N → `{row:4}`, S → `{row:0}`, SE → `{row:1, flip:false}`, SW → `{row:1, flip:true}`,
    NE → `{row:3, flip:false}`, NW → `{row:3, flip:true}`; the diagonal-vs-axis ratio boundary;
    zero delta → returns `prev`.
  - `isMoving`: above/below the epsilon threshold.
  - `frameAt`: wraps 0..3, advances with elapsed time at a given fps.
  - Location: `avatar/test/anim.test.js` (the file is byte-identical in both publics; testing the avatar copy covers both).
- **Extended `avatar/test/movement.test.js`**: the four diagonal dirs move on both axes,
  stay clamped to bounds, and a diagonal step's distance ≈ a cardinal step's (speed normalized).
- **Existing behaviour stays green:** the pre-existing `node:test` cases keep passing
  (cardinal movement is unchanged; `movement.test.js` only *gains* diagonal cases) and
  `scripts/e2e.sh` runs untouched (volume survival, loud-fail without `--network`,
  graceful degrade, two-player room). No protocol/port/env/title/id changes.
- **Manual visual verification:** already done for slicing + facing in the browser
  artifact; before merge, drive the real Docker flow and screenshot avatars walking
  in with rings + nameplates on both the projector and student views (the "prove
  before slides" guardrail).
- **Canvas rendering** itself is not unit-tested (WebGL canvas); the pure logic is
  extracted so the risky part *is* tested, and the visible part is proven by eye + e2e.

## 8. Error handling / edge cases

- **Sheet fails to load** (shouldn't — vendored locally): fall back to a `COLOR`-tinted
  rounded-rect body so an avatar still appears; log once. The room never crashes over art.
- **Unknown/missing facing row:** default to front (`row 0`).
- **Invalid `colour` string:** existing `tintOf` fallback (`aqua`) is reused for ring/plate.
- **Long names:** server already clamps `nama` to 24 chars; the nameplate sizes to the
  text width, so it never overflows the layout.
- **A misbehaving avatar** still cannot break the shared room (server behaviour unchanged).

## 9. File-by-file change list

**New**
- `avatar/public/sprites/char-idle.png`, `char-walk.png`
- `server/public/sprites/char-idle.png`, `char-walk.png`
- `avatar/public/arena-anim.js`, `server/public/arena-anim.js` (identical)
- `avatar/public/arena-avatar.js`, `server/public/arena-avatar.js` (identical)
- `avatar/test/anim.test.js`

**Modified**
- `avatar/public/avatar.js` — use factory, `import` shared modules, move tween into `update`, **held-key 8-way input sender** (§4.5).
- `server/public/spectator.js` — use factory, `import` shared modules, move tween into `update`.
- `avatar/src/movement.js` — add the four diagonal dirs with normalized speed (§4.5).
- `avatar/test/movement.test.js` — extend for diagonals.
- `avatar/public/index.html`, `server/public/index.html` — `type="module"` client script; HUD/banner CSS polish; ids/title unchanged.
- shared `drawBackground` (in both view scripts) — room polish + depth sort.
- `.gitignore` — add `assets.zip`, `st.mp3` (and optionally the raw `assets/` tree).

**Unchanged (do not touch)**
- `avatar/src/app.js`, `messages.js`, `store.js`, `character.js`, all `server/src/**`,
  the roster protocol, the `{t:'move',dir}` message shape, `constants.js`
  (`WORLD_W/H`, `STEP`, `AVATAR_R`), Dockerfiles' build contract, `scripts/e2e.sh`.

## 10. Tuning parameters (defaults, adjust during implementation)

- `SPRITE_SCALE = 3` (32px frame → 96px on-screen).
- `WALK_FPS = 8`, `IDLE_FPS = 4`.
- `MOVE_EPS = 0.6` px pending-delta threshold for idle vs walk.
- `DIAG_RATIO = 0.4` — how "diagonal" a heading must be to pick a ¾ facing vs a cardinal one.
- `SEND_MS ≈ 60` — browser held-key send cadence; diagonal speed factor `≈ 0.7071`.
- Ring radii, nameplate padding/font — matched to `SPRITE_SCALE`.

## 11. Contract-stability statement

No change to: image namespaces (`infratify/arena-*`), env (`COLOR`, `SERVER`,
`REDIS_HOST`, `PORT`), ports (`8080`, `3000`), volume (`me`), network (`arena`),
container names, the WebSocket roster shape, or the internal `{t:'move',dir}` message.
The only behavioural change is client-side (diagonal movement + richer facing); every
student-facing interface is identical, so the Docker 3 slides remain correct without edits.
