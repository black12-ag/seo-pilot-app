#!/bin/sh
# One-command setup for your own SEO Pilot, with Docker.
#
#   curl -fsSL https://raw.githubusercontent.com/black12-ag/seo-pilot-app/main/scripts/install.sh | sh
#
# or, from a checkout:  sh scripts/install.sh [options]
#
# Options:
#   --url URL     Public address, e.g. https://seo.example.com (default http://localhost:PORT)
#   --port PORT   Local port (default 3001)
#   --with-ai     Also run the AI engine on your own logged-in agy, claude or codex
#   --build       Build the image here instead of downloading the published one
#   --update      Get the latest version and restart
#   --dir DIR     Where to download SEO Pilot when not run from a checkout (default ./seo-pilot-app)
#   --dry-run     Write settings, print the Docker commands, start nothing
#
# It never overwrites a setting you already filled in.
set -eu

REPO_URL=https://github.com/black12-ag/seo-pilot-app.git
IMAGE=ghcr.io/black12-ag/seo-pilot-app:latest
URL="" PORT="" WITH_AI=0 BUILD=0 UPDATE=0 DIR=./seo-pilot-app DRY=0

say() { printf '%s\n' "$*"; }
die() { printf 'SEO Pilot setup: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required. $2"; }
run() { if [ "$DRY" = 1 ]; then say "+ $*"; else "$@"; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL=${2:?--url needs a value}; shift 2 ;;
    --port) PORT=${2:?--port needs a value}; shift 2 ;;
    --with-ai) WITH_AI=1; shift ;;
    --build) BUILD=1; shift ;;
    --update) UPDATE=1; shift ;;
    --dir) DIR=${2:?--dir needs a value}; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

case "$PORT" in ''|*[!0-9]*) [ -z "$PORT" ] || die "--port must be a number" ;; esac

# Find the checkout: the folder this script is in, or download one.
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)
if [ -n "$here" ] && [ -f "$here/../deploy/standalone/compose.yaml" ]; then
  ROOT=$(cd "$here/.." && pwd)
elif [ -f deploy/standalone/compose.yaml ]; then
  ROOT=$(pwd)
else
  need git "Install Git, then run this again."
  if [ ! -d "$DIR/.git" ]; then run git clone --depth 1 "$REPO_URL" "$DIR"; fi
  ROOT=$(cd "$DIR" 2>/dev/null && pwd || echo "$DIR")
fi
cd "$ROOT"

if [ "$DRY" = 0 ]; then
  need docker "Install Docker (https://docs.docker.com/get-docker/), then run this again."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (the 'docker compose' command)."
fi

ENV=deploy/standalone/.env
[ -f "$ENV" ] || cp deploy/standalone/.env.example "$ENV"
chmod 600 "$ENV"

# get KEY -> current value ('' when missing)
get() { sed -n "s/^$1=//p" "$ENV" | tail -n 1; }
# put KEY VALUE -> replace the line, or add it
put() {
  if grep -q "^$1=" "$ENV"; then
    tmp=$ENV.tmp
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' "$ENV" >"$tmp"
    cat "$tmp" >"$ENV" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$1" "$2" >>"$ENV"
  fi
}
# fill KEY VALUE -> only when empty or still the example placeholder
fill() { case "$(get "$1")" in ''|replace-with-*) put "$1" "$2" ;; esac; }
secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; fi
}

fill STORAGE_SECRET_KEY "$(secret)"
if [ "$BUILD" = 1 ]; then put SEO_PILOT_IMAGE seo-pilot-platform:local; else fill SEO_PILOT_IMAGE "$IMAGE"; fi
[ -z "$PORT" ] || put PORT "$PORT"
PORT=$(get PORT); PORT=${PORT:-3001}
if [ -n "$URL" ]; then put BETTER_AUTH_URL "${URL%/}"
else
  case "$(get BETTER_AUTH_URL)" in
    ''|http://localhost:*) put BETTER_AUTH_URL "http://localhost:$PORT" ;;
  esac
fi

if [ "$WITH_AI" = 1 ]; then
  need node "The AI engine needs Node.js 22 or newer on this computer."
  cli=""
  for c in agy claude codex; do command -v "$c" >/dev/null 2>&1 && { cli=$c; break; }; done
  [ -n "$cli" ] || die "--with-ai needs agy, claude or codex installed and signed in on this computer."
  fill AI_ENGINE_TOKEN "$(secret)"
  fill AI_ENGINE_URL http://host.docker.internal:8719
  token=$(get AI_ENGINE_TOKEN)
  # Containers reach the host through the Docker bridge on Linux; Docker
  # Desktop and Colima forward host.docker.internal to the host's loopback.
  host=127.0.0.1
  if [ "$(uname -s)" = Linux ] && [ "$DRY" = 0 ]; then
    host=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo 172.17.0.1)
  fi
  conf=$HOME/.config/seo-pilot
  run mkdir -p "$conf"
  if [ "$DRY" = 0 ]; then
    umask 077
    printf 'AI_ENGINE_TOKEN=%s\nAI_ENGINE_HOST=%s\n' "$token" "$host" >"$conf/ai-engine.env"
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
    unit=$HOME/.config/systemd/user/seo-pilot-ai-engine.service
    if [ "$DRY" = 0 ]; then
      mkdir -p "$(dirname "$unit")"
      cat >"$unit" <<UNIT
[Unit]
Description=SEO Pilot AI engine ($cli)
After=network-online.target

[Service]
WorkingDirectory=$ROOT
EnvironmentFile=$conf/ai-engine.env
Environment=PATH=$PATH
ExecStart=$(command -v node) services/ai-engine/server.mjs
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
    fi
    run systemctl --user daemon-reload
    run systemctl --user enable --now seo-pilot-ai-engine.service
    say "AI engine runs as the systemd user service seo-pilot-ai-engine ($cli)."
    say "To keep it running after you log out: sudo loginctl enable-linger $(id -un)"
  else
    log=$conf/ai-engine.log
    if [ "$DRY" = 1 ]; then say "+ node services/ai-engine/server.mjs (in the background)"
    else
      # shellcheck disable=SC2046
      env $(cat "$conf/ai-engine.env") nohup node services/ai-engine/server.mjs >>"$log" 2>&1 &
    fi
    say "AI engine started in the background ($cli); its log is $log. Run this script again with --with-ai after a restart."
  fi
fi

files="-f deploy/standalone/compose.yaml"
[ "$BUILD" = 0 ] || files="$files -f deploy/standalone/compose.build.yaml"
# shellcheck disable=SC2086
compose() { run docker compose --project-name seo-pilot --env-file "$ENV" $files "$@"; }

if [ "$UPDATE" = 1 ] && [ -d .git ]; then
  if [ -z "$(git status --porcelain --untracked-files=no)" ]; then run git pull --ff-only
  else say "Local changes found, so the code wasn't updated. The image still updates."; fi
fi

if [ "$BUILD" = 1 ]; then compose up -d --build
else compose pull && compose up -d; fi

if [ "$DRY" = 0 ]; then
  say "Waiting for SEO Pilot to start (the first start can take a few minutes)..."
  i=0
  until curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/health" 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -lt 60 ] || die "it didn't answer on port $PORT after 5 minutes. Check: docker compose --project-name seo-pilot logs"
    sleep 5
  done
fi

say ""
say "SEO Pilot is running."
say "  Open $(get BETTER_AUTH_URL)/welcome and create your account. The first account is the administrator."
say "  Settings are in $ROOT/$ENV. Run this script again with --update to get new versions."
say "  Next: connect Google (docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md)."
[ "$WITH_AI" = 1 ] || say "  Add AI on your own agy, claude or codex login: run this again with --with-ai."
