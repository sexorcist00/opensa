#!/usr/bin/env bash
# One command for a phone run (plan 097 chain 4): convert what is missing, prove the pak is what it claims,
# serve it, print the URL to open. Re-running it is the normal case — everything already done is skipped, so
# the second run is just "servers up, here is the link".
#
#   npm run phone                     # convert (once) with the collision bake, serve, print the URL
#   REBUILD=1 npm run phone           # re-convert even though a pak is already there
#   BAKE=0 OUT=./build/phone-plain npm run phone     # the OTHER side of the A/B: no --bake-collision
#   MODELS=0 npm run phone            # skip the model convert entirely: fast, but dispatch-only (no physics)
#   VEHICLES=admiral,infernus PEDS=bmycg npm run phone     # convert a different subset
#   VEHICLES=all PEDS=all npm run phone                    # the whole roster (hours on a phone)
#   RECT=8,-8,11,-5 SPAWN=2495,-1687,20 npm run phone
#
# A PREBUILT app in `build/webapp` (or `WEBAPP=<dir>`) is used INSTEAD of the dev server, and then vite is
# never started at all. That is not a convenience: vite's rolldown binding dies with SIGILL on some arm64
# Android CPUs (loading the native binding kills the process before the wasm fallback is even consulted), so
# on those devices a dev server cannot run and a built copy served as static files is the only way in.
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
# The default is a SUBSET, because converting the roster costs hours on a phone and a field run needs a
# handful of models. `all` restores the full convert. The player's model is added below whatever is asked
# for: without it the game boots with nobody to move (`GAME_CONFIG.mainCharacter`).
PLAYER_PED="${PLAYER_PED:-bmycg}"
VEHICLES="${VEHICLES:-admiral,infernus,comet}"
PEDS="${PEDS:-bmycg,wmycr}"
REBUILD="${REBUILD:-0}"
APP_PORT="${APP_PORT:-5173}"
WEBAPP="${WEBAPP:-build/webapp}"
STATIC_PORT="${STATIC_PORT:-3001}"
LOGS="build/.phone"
STARTED=()

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# The LOCAL tsx, never `npx tsx`. On a phone npx is the slower path and, when the package cannot be resolved,
# it reaches for the network — which on a field run means a convert that hangs on a captive portal instead of
# saying what is missing. This says it instead, and names the command that installs it.
TSX=node_modules/tsx/dist/cli.mjs
if [ ! -f "$TSX" ]; then
  echo "no $TSX — run: npm run phone:setup" >&2
  exit 1
fi
tsx() { node "$TSX" "$@"; }

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
  if [ "$MODELS" != 0 ]; then
    [ "$VEHICLES" != all ] && args+=(--vehicles "$VEHICLES")
    if [ "$PEDS" != all ]; then
      case ",$PEDS," in
        *",$PLAYER_PED,"*) ;;
        *) PEDS="$PLAYER_PED,$PEDS" ;;
      esac
      args+=(--peds "$PEDS")
    fi
  fi
  # --platforms mobile fails the pack when anything it wrote needs a GPU feature a phone lacks (BC), so a pak
  # that survives this line is one the device can actually open.
  if ! NODE_OPTIONS=--max-old-space-size=4096 tsx tools/opensa-pack/src/cli.ts "${args[@]}"; then
    echo "convert failed — nothing was served" >&2
    exit 1
  fi
else
  # Reuse is the normal case — but only after the pak on disk is asked whether it is the one being requested.
  # Until this check existed, `RECT=8,-8,11,-5 npm run phone` over an existing pak served the OLD district and
  # said nothing: the knobs above are read only on the convert branch, so a mismatch was invisible on screen
  # and in the log. Same for the collision A/B, where the two sides differ by one flag and nothing else.
  say "pak already at $OUT/pak (REBUILD=1 to redo it)"
  expect=(--expect "rect=$RECT" --expect "bakeCollision=$([ "$BAKE" = 1 ] && echo true || echo false)"
          --expect "models=$([ "$MODELS" != 0 ] && echo true || echo false)")
  if [ "$MODELS" != 0 ]; then
    expect+=(--expect "vehicles=$VEHICLES")
    if [ "$PEDS" = all ]; then
      expect+=(--expect "peds=all")
    else
      case ",$PEDS," in
        *",$PLAYER_PED,"*) expect+=(--expect "peds=$PEDS") ;;
        *) expect+=(--expect "peds=$PLAYER_PED,$PEDS") ;;
      esac
    fi
  fi
  if ! tsx scripts/debug/pak-recipe.ts "$OUT/pak" "${expect[@]}"; then
    echo >&2
    echo "nothing was served. Either re-convert into this folder:" >&2
    echo "  REBUILD=1 npm run phone" >&2
    echo "or keep both and serve the other one from its own folder:" >&2
    echo "  OUT=./build/phone-$(date +%H%M) npm run phone" >&2
    exit 1
  fi
fi

# 3 — what the pak actually carries. The first line is the collision GRID: a bake keyed on the render grid
# renders perfectly and drops the player through the world, and nothing else would ever say so.
say "pak check"
tsx scripts/debug/dump-cell-collision.ts "$OUT/pak"

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
PREBUILT=0
if [ -f "$WEBAPP/index.html" ]; then
  PREBUILT=1
  say "prebuilt app at $WEBAPP — serving it as static files (no dev server)"
elif port_open "$APP_PORT"; then
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

ports=("$STATIC_PORT")
[ "$PREBUILT" = 0 ] && ports+=("$APP_PORT")
for port in "${ports[@]}"; do
  if ! wait_port "$port"; then
    echo "port $port never opened — see $LOGS/*.log" >&2
    exit 1
  fi
done

# 5 — the link. `localhost` is a SECURE CONTEXT, so on the phone itself Cache Storage works and the download
# is kept; the LAN address is plain http, where it is not (the shell says so under the preloader).
#
# With a SUBSET converted, the traffic spawners are turned off in the URL. This is not tidiness: a car outside
# `--vehicles` kept its original BC textures, and on a device without BC the first parked car or generator to
# reach for one ends the run. `?parked=0&cargen=0` is the pair that stills the world (`parked=0` alone does
# not — the generators are the larger half, ~962 placements against ~212).
GATE=""
if [ "$MODELS" != 0 ] && { [ "$VEHICLES" != all ] || [ "$PEDS" != all ]; }; then
  GATE="&parked=0&cargen=0"
fi
PAK_URL="http://localhost:$STATIC_PORT/${OUT#./}"
IP="$(lan_ip)"
# One origin when the app is prebuilt (it is served by the same static server as the pak): no CORS, no second
# port, and — the reason it matters on a phone — no vite.
if [ "$PREBUILT" = 1 ]; then
  APP_URL="http://localhost:$STATIC_PORT/${WEBAPP#./}/index.html"
  MAP_URL="http://localhost:$STATIC_PORT/${WEBAPP#./}/dispatch.html"
  LAN_APP="http://$IP:$STATIC_PORT/${WEBAPP#./}/index.html"
  LAN_PAK="http://$IP:$STATIC_PORT/${OUT#./}"
else
  APP_URL="http://localhost:$APP_PORT/"
  MAP_URL="http://localhost:$APP_PORT/dispatch.html"
  LAN_APP="http://$IP:$APP_PORT/"
  LAN_PAK="http://$IP:$STATIC_PORT/${OUT#./}"
fi
say "open on this phone"
if [ "$MODELS" = 0 ]; then
  echo "  MODELS=0 → no vehicles/peds were converted, so only the map surface is usable (it runs no physics,"
  echo "  which means it does not exercise the collision bake at all):"
  echo "  $MAP_URL?src=$PAK_URL&at=${SPAWN%,*}"
else
  echo "  the game (this is the one that streams collision):"
  echo "  $APP_URL?loader=http-dir&src=$PAK_URL&spawn=$SPAWN$GATE"
  echo
  echo "  the map surface, no physics:"
  echo "  $MAP_URL?src=$PAK_URL&at=${SPAWN%,*}"
fi
if [ -n "$IP" ]; then
  echo
  echo "  from another device on this network (plain http → no Cache Storage, the shell will say so):"
  echo "  $LAN_APP?loader=http-dir&src=$LAN_PAK&spawn=$SPAWN$GATE"
fi
if [ -n "$GATE" ]; then
  echo
  echo "  converted: vehicles [$VEHICLES] · peds [$PEDS] — so the URL carries parked=0&cargen=0."
  echo "  Everything else kept its original (BC) textures and would fail to spawn on this GPU."
  echo "  VEHICLES=all PEDS=all npm run phone converts the roster and drops the gate (hours on a phone)."
fi
say "running — Ctrl+C stops the servers this run started"
echo "logs: tail -f $LOGS/app.log $LOGS/static.log"
wait
