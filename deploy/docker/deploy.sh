#!/usr/bin/env bash
# Put the current code live, the container way.
#
#   ssh you@your-kvm2
#   /srv/bricksandjoy/deploy/docker/deploy.sh
#
# This is what deploy/deploy.sh was before the sites moved into containers, and
# it keeps the property that mattered most about it: if the build fails, the
# running container is never touched and the shop keeps serving. Nothing is
# swapped until there is something working to swap in.
#
# ── the forced command has to be changed too ────────────────────────────────
#
# The GitHub deploy sends no command. The key on the server is registered with
# a forced one, so changing what a deploy does means editing that line — and
# until it is edited, the button still runs the bare-metal script: it would
# rebuild build/, restart bricksnjoy-api, pass its own health check and report
# "live" while the container carried on serving the previous code. A deploy
# that reports success and changes nothing is the worst kind.
#
# In /root/.ssh/authorized_keys, change
#   command="/srv/bricksandjoy/deploy/deploy.sh"
# to
#   command="/srv/bricksandjoy/deploy/docker/deploy.sh"

set -euo pipefail

APP_DIR="${APP_DIR:-/srv/bricksandjoy}"
APP_USER="${APP_USER:-bricksnjoy}"
BRANCH="${BRANCH:-main}"
SITE="${SITE:-bricksandjoy}"
IMAGE="${IMAGE:-bricksandjoy-app}"
HEALTH_PORT="${HEALTH_PORT:-4000}"

COMPOSE_DIR="$APP_DIR/deploy/docker/$SITE"
PROXY_DIR="$APP_DIR/deploy/docker/proxy"

# The checkout is owned by the app user, and git refuses to run in a tree owned
# by somebody else ("detected dubious ownership"). Only docker needs root.
as_app() {
	if [ "$(id -un)" = "$APP_USER" ]; then "$@"; else sudo -u "$APP_USER" "$@"; fi
}

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

cd "$APP_DIR"

step "Fetching $BRANCH"
as_app git fetch --quiet origin "$BRANCH"
as_app git checkout --quiet "$BRANCH"
as_app git reset --hard --quiet "origin/$BRANCH"
echo "  now at $(as_app git rev-parse --short HEAD) — $(as_app git log -1 --pretty=%s)"

# What is running now, kept under a name of its own so there is something to go
# back to. Docker keeps the image alive as long as a tag points at it, so this
# survives the build that replaces :latest.
step "Marking the running image"
if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
	docker tag "$IMAGE:latest" "$IMAGE:previous"
	echo "  kept as $IMAGE:previous"
else
	echo "  nothing running yet — no rollback point"
fi

step "Building"
# Before anything is stopped. A failed build leaves the running container
# exactly where it is, which is the whole reason this comes first. The lint
# gate and the React build are inside the Dockerfile, so a name that does not
# resolve fails here rather than blanking a page for whoever opens it.
cd "$COMPOSE_DIR"
docker compose build
echo "  built"

step "Database schema"
# Every statement in db/schema.sql is idempotent, so this runs on every deploy
# and is how a new column reaches the live database. It runs in a throwaway
# container off the NEW image, before the new code is serving — the same order
# the bare-metal script used, for the same reason: the schema a release needs
# should be there before the release is.
docker compose run --rm --workdir /app/server app npm run --silent schema
echo "  up to date"

step "Swapping in the new container"
docker compose up -d

step "Waiting for it to answer"
healthy=""
for i in $(seq 1 30); do
	if docker compose exec -T app curl -fsS --max-time 2 \
		"http://127.0.0.1:$HEALTH_PORT/api/health" >/dev/null 2>&1; then
		healthy="yes"
		echo "  healthy after ${i}s"
		break
	fi
	sleep 1
done

if [ -z "$healthy" ]; then
	printf '\n\033[31m✗ the new container did not come back\033[0m\n'
	docker compose logs --tail 30 app || true

	if docker image inspect "$IMAGE:previous" >/dev/null 2>&1; then
		echo
		echo "  putting the previous image back"
		docker tag "$IMAGE:previous" "$IMAGE:latest"
		docker compose up -d --force-recreate
		echo "  rolled back — the shop is on the previous build"
	else
		echo "  no previous image to roll back to"
	fi
	exit 1
fi

step "Web server config"
# The proxy reads its Caddyfile and sites/*.caddy straight out of this checkout,
# so a change to either arrived with the git reset above and is sitting there
# unread. Validate before reloading: a Caddyfile with a mistake in it takes
# every site on this box off the internet, and validating costs nothing.
if [ -d "$PROXY_DIR" ] && docker ps --format '{{.Names}}' | grep -qx edge-caddy; then
	cd "$PROXY_DIR"
	if ! docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
		echo "  the Caddyfile is NOT valid — not reloading:"
		docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile 2>&1 | sed 's/^/    /' || true
		echo "  the shop is live on the new build; the proxy is still on its previous config"
		exit 1
	fi
	docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
	echo "  reloaded"
else
	echo "  the proxy is not running here — skipping"
fi

printf '\n\033[32m✓ live\033[0m\n\n'
