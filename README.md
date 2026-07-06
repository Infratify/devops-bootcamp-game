# devops-bootcamp-game — arena

A tiny **live multiplayer 2D avatar arena**. Run two containers on your laptop,
wire them together, and your character walks into a shared room everyone can see.

It exists for one reason: to make three Docker ideas **visible and fun** in the
**Docker 3** bootcamp session —

- **pull an image** from a registry,
- **keep your character** with a named **volume** (kill the container, it's still there),
- **connect two containers by name** on a user-defined **network**.

> Not a real game — a teaching prop. Design + build spec lives in [`CLAUDE.md`](./CLAUDE.md).
> Status: **spec only, not built yet.**

## How it works

- **`arena-server`** — the shared room. The instructor runs one (on EC2, port `3000` open). A projector shows everyone's avatars.
- **`redis`** — your *remember-box*. Runs on your laptop with a volume, keeps your character (name, colour, score).
- **`arena-avatar`** — you. Reads your remember-box **by name**, joins the room, and gives you a view at `http://localhost:8080`.

## Run (once the images are published)

```bash
# 1) your own little network
docker network create arena

# 2) your remember-box, with a volume that survives restarts
docker run -d --name profile --network arena -v me:/data redis
docker exec profile redis-cli SET nama "Ariff"   # your persistent name

# 3) your avatar — reads "profile" by name, joins the instructor's room
docker run -d --name avatar --network arena -p 8080:8080 \
  -e COLOR="cyan" -e SERVER="<instructor-ip>:3000" \
  infratify/arena-avatar

# open http://localhost:8080 → you're in the room as "Ariff"
```

**Prove the volume:** `docker rm -f avatar profile`, run them again from the same
volume `me` → your character is exactly as you left it.

**Prove the network:** run the avatar *without* `--network arena` → it can't find
`profile` → add the network → it works.

## Fixed names (shared contract with the slides — keep stable)

`arena` (network) · `profile` (redis container) · `avatar` (container) · `me`
(volume) · `8080` (your view) · `3000` (the room). Owner namespace: `infratify`.

## Build + host

See [`CLAUDE.md`](./CLAUDE.md) — tech stack, build milestones, the single-host
networking rationale, and how to host the shared room on EC2.
