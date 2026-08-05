#!/usr/bin/env bash
# One command for a phone run (plan 097 chain 4): convert what is missing, prove the pak is what it claims,
# serve it, print the URL to open. Re-running it is the normal case — everything already done is skipped, so
# the second run is just "servers up, here is the link".
#
#   npm run phone                     # convert (once) with the collision bake, serve, print the URL
#   REBUILD=1 npm run phone           # re-convert even though a pak is already there
#   BAKE=0 OUT=./build/phone-plain npm run phone     # the OTHER side of the A/B: no --bake-collision
#   MODELS=0 npm run phone            # skip the model convert: fast, but dispatch-only (no physics)
#   RECT=8,-8,11,-5 SPAWN=2495,-1687,20 npm run phone
#
# Every knob is an env var so the command itself never changes. Ctrl+C stops the servers this run started
# (one it found already running is left alone); so does closing the Termux session, which sends HUP.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

GAME="${GAME:-./game-src/original}"
OUT="${OUT:-./build/phone}"
RECT="${RECT:-9,-7,10,-6}"
SPAWN="${SPAWN:-2400,-1700,20}"
BAKE="${BAKE:-1}"
MODELS="${MODELS:-1}"
REBUILD="${REBUILD:-0}"
APP_PORT="${APP_PORT:-5173}"
STATIC_PORT="${STATIC_PORT:-3001}"
LOGS="build/.phone"
STARTED=()

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# Node rather than curl/nc: node is the one tool this repo already requires, and Termux ships neither of the
# other two by default.
port_open() {
  node -e "
const s = require('net').connect($1, '127.0.0.1');
s.setTimeout(800);
s.on('connect', () => { s.end(); process.exit(0); });
s.on('error', () => process.exit(1));
s.on('timeout', () => process.exit(1));
" 2>/dev/null
}

wait_port() {
  for _ in $(seq 1 90); do
    port_open "$1" && return 0
    sleep 1
  done

  return 1
}

lan_ip() {
  node -e "
const nets = require('os').networkInterfaces();
for (const list of Object.values(nets)) {
  for (const net of list ?? []) {
    if (net.family === 'IPv4' && !net.internal) { console.log(net.address); process.exit(0); }
  }
}
"
}

# 1 — the install. Without it nothing below can mean anything, so it fails here rather than three minutes in.
if [ ! -f "$GAME/data/gta.dat" ]; then
  echo "no $GAME/data/gta.dat — put the PC game's data/ and models/ there first (docs/development/mobile-pak.md)" >&2
  exit 1
fi

# 2 — convert, but only when there is nothing to run on. A phone convert is minutes to hours; re-running this
# script must not silently repeat it.
if [ "$REBUILD" = 1 ] || [ ! -f "$OUT/pak/manifest.json" ]; then
  say "converting $GAME → $OUT (rect $RECT, bake=$BAKE, models=$MODELS)"
  args=(--game "$GAME" --out "$OUT" --rgba8 --max-texture 256 --rect "$RECT" --no-ao --platforms mobile)
  [ "$BAKE" = 1 ] && args+=(--bake-collision)
  [ "$MODELS" = 0 ] && args+=(--no-models)
  # --platforms mobile fails the pack when anything it wrote needs a GPU feature a phone lacks (BC), so a pak
  # that survives this line is one the device can actually open.
  if ! NODE_OPTIONS=--max-old-space-size=4096 npx tsx tools/opensa-pack/src/cli.ts "${args[@]}"; then
    echo "convert failed — nothing was served" >&2
    exit 1
  fi
else
  say "pak already at $OUT/pak (REBUILD=1 to redo it)"
fi

# 3 — what the pak actually carries. The first line is the collision GRID: a bake keyed on the render grid
# renders perfectly and drops the player through the world, and nothing else would ever say so.
say "pak check"
npx tsx scripts/debug/dump-cell-collision.ts "$OUT/pak"

# 4 — servers. Each is started only if its port is free, so re-running this reuses what is already up.
mkdir -p "$LOGS"
if port_open "$STATIC_PORT"; then
  say "static server already on :$STATIC_PORT"
else
  say "starting the static server on :$STATIC_PORT → $LOGS/static.log"
  # `node <entry>` rather than `npm run …`: an npm wrapper puts a shell and a node process between us and the
  # server, and killing the wrapper leaves the server holding the port — which is the difference between
  # Ctrl+C working and the next run finding :$STATIC_PORT busy.
  node node_modules/tsx/dist/cli.mjs scripts/serve-static.ts >"$LOGS/static.log" 2>&1 &
  STARTED+=($!)
fi
if port_open "$APP_PORT"; then
  say "app already on :$APP_PORT"
else
  say "starting the app on :$APP_PORT → $LOGS/app.log"
  node node_modules/vite/bin/vite.js --host --port "$APP_PORT" >"$LOGS/app.log" 2>&1 &
  STARTED+=($!)
fi

# Children first, then the process itself: esbuild (tsx) and vite both keep a helper process, and killing the
# parent alone can leave one holding the port.
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$1" 2>/dev/null
}

cleanup() {
  local pid
  for pid in ${STARTED[@]+"${STARTED[@]}"}; do
    kill_tree "$pid"
  done
}
trap cleanup HUP INT TERM EXIT

for port in "$STATIC_PORT" "$APP_PORT"; do
  if ! wait_port "$port"; then
    echo "port $port never opened — see $LOGS/*.log" >&2
    exit 1
  fi
done

# 5 — the link. `localhost` is a SECURE CONTEXT, so on the phone itself Cache Storage works and the download
# is kept; the LAN address is plain http, where it is not (the shell says so under the preloader).
PAK_URL="http://localhost:$STATIC_PORT/${OUT#./}"
IP="$(lan_ip)"
say "open on this phone"
if [ "$MODELS" = 0 ]; then
  echo "  MODELS=0 → no vehicles/peds were converted, so only the map surface is usable (it runs no physics,"
  echo "  which means it does not exercise the collision bake at all):"
  echo "  http://localhost:$APP_PORT/dispatch.html?src=$PAK_URL&at=${SPAWN%,*}"
else
  echo "  the game (this is the one that streams collision):"
  echo "  http://localhost:$APP_PORT/?loader=http-dir&src=$PAK_URL&spawn=$SPAWN"
  echo
  echo "  the map surface, no physics:"
  echo "  http://localhost:$APP_PORT/dispatch.html?src=$PAK_URL&at=${SPAWN%,*}"
fi
if [ -n "$IP" ]; then
  echo
  echo "  from another device on this network (plain http → no Cache Storage, the shell will say so):"
  echo "  http://$IP:$APP_PORT/?loader=http-dir&src=http://$IP:$STATIC_PORT/${OUT#./}&spawn=$SPAWN"
fi
say "running — Ctrl+C stops the servers this run started"
echo "logs: tail -f $LOGS/app.log $LOGS/static.log"
wait
