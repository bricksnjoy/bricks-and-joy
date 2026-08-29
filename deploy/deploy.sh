#!/usr/bin/env bash
# Put the current code live.
#
#   ssh you@your-kvm2
#   cd /srv/bricksandjoy && ./deploy/deploy.sh
#
# Pulls, installs, builds the site, applies any schema changes, restarts the
# API, and checks it actually came back. If the build fails, the old build stays
# where it is and nothing is restarted — the site keeps serving.

set -euo pipefail

APP_DIR="${APP_DIR:-/srv/bricksandjoy}"
SERVICE="${SERVICE:-bricksnjoy-api}"

cd "$APP_DIR"

# Deploy whichever branch the server is already tracking, rather than assuming
# main. Hardcoding main meant a deploy would silently move the shop onto a
# different branch — which matters right now, while the work lives on
# claude/supplier-favorites-sync-fni8t1 and main is still the old Vercel code.
# Set BRANCH explicitly to move it on purpose.
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
if [ "$BRANCH" = "HEAD" ]; then
	echo "The checkout is not on a branch. Set BRANCH=... to say what to deploy."
	exit 1
fi

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "Fetching $BRANCH"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"
echo "  now at $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

step "Front-end dependencies"
npm ci --no-audit --no-fund --silent

step "Building the site"
# Into a scratch directory first. A failed build must not leave a half-written
# build/ behind, because that is what visitors are being served.
#
# Run it at the lowest priority we can give it. This box has two cores and the
# build will happily use both for a couple of minutes; nice and ionice mean the
# API keeps getting the processor and the disk whenever it wants them, so the
# shop stays responsive to anyone using it while a deploy is going out. It
# costs the build a little time and nobody is watching it.
rm -rf build.new
nice -n 19 ionice -c 3 env BUILD_PATH=build.new CI=1 npx react-scripts build
rm -rf build.old
[ -d build ] && mv build build.old
mv build.new build
echo "  built"

step "API dependencies"
(cd server && npm ci --omit=dev --no-audit --no-fund --silent)

step "Database schema"
# Every statement in schema.sql is idempotent, so this is safe on every deploy
# and is how a new column reaches the live database.
#
# Read the one line we need rather than sourcing the file. server/.env holds
# values like  EMAIL_FROM=Brick's & Joy <orders@…>  — perfectly fine for
# systemd and for dotenv, but sourcing it in a shell would treat the quote and
# the angle brackets as syntax.
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' ./server/.env | head -1 | sed 's/^["'"'"']//; s/["'"'"']$//')"
if [ -z "$DATABASE_URL" ]; then
	echo "  DATABASE_URL not found in server/.env — stopping before anything is restarted"
	exit 1
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f db/schema.sql
echo "  up to date"

step "Restarting the API"
sudo systemctl restart "$SERVICE"

# Give it a moment, then make sure it is actually answering — a service that is
# "active" but throwing on every request is not a successful deploy.
for i in $(seq 1 15); do
	if curl -fsS --max-time 2 http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
		echo "  healthy after ${i}s"
		rm -rf build.old
		printf '\n\033[32m✓ live\033[0m\n\n'
		exit 0
	fi
	sleep 1
done

printf '\n\033[31m✗ the API did not come back\033[0m\n'
echo "  sudo journalctl -u $SERVICE -n 50 --no-pager"
echo "  the previous build is in build.old if you need to put it back"
exit 1
