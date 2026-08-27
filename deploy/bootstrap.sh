#!/usr/bin/env bash
# First-time setup on a fresh Ubuntu VPS.
#
# Does the mechanical parts of the move in one go — packages, firewall, the
# app's own user, PostgreSQL, the code, and a server/.env with the two secrets
# already generated. It stops before anything that needs a decision from you.
#
#   apt update && apt install -y git
#   git clone -b claude/supplier-favorites-sync-fni8t1 \
#     https://github.com/bricksnjoy/bricks-and-joy.git /srv/bricksandjoy
#   bash /srv/bricksandjoy/deploy/bootstrap.sh
#
# Safe to run again. Every phase checks whether it has already been done, so a
# run that stops halfway can simply be started again.

set -euo pipefail

APP_DIR="${APP_DIR:-/srv/bricksandjoy}"
APP_USER="${APP_USER:-bricksnjoy}"
DB_NAME="${DB_NAME:-bricksnjoy}"
DB_USER="${DB_USER:-bricksnjoy}"
SITE="${SITE:-bricksandjoy.com}"

bold=$(tput bold 2>/dev/null || true); dim=$(tput dim 2>/dev/null || true)
green=$(tput setaf 2 2>/dev/null || true); red=$(tput setaf 1 2>/dev/null || true)
off=$(tput sgr0 2>/dev/null || true)

step() { printf '\n%s▸ %s%s\n' "$bold" "$1" "$off"; }
ok()   { printf '  %s✓%s %s\n' "$green" "$off" "$1"; }
skip() { printf '  %s· %s (already done)%s\n' "$dim" "$1" "$off"; }
die()  { printf '\n%s✗ %s%s\n\n' "$red" "$1" "$off" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this as root."
command -v apt-get >/dev/null || die "This expects Ubuntu or Debian."

printf '\n%s Brick'"'"'s & Joy — first-time server setup %s\n' "$bold" "$off"
printf '%s  %s → %s%s\n' "$dim" "$(hostname)" "$APP_DIR" "$off"

# ── 1. packages ─────────────────────────────────────────────────────────────
step "Installing packages"

export DEBIAN_FRONTEND=noninteractive

# Ubuntu runs its own updater on first boot and holds the package lock. Rather
# than failing with a confusing error, wait for it.
for i in $(seq 1 30); do
  if fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; then
    [ "$i" -eq 1 ] && printf '  %swaiting for the system updater to finish…%s\n' "$dim" "$off"
    sleep 10
  else
    break
  fi
done

apt-get update -qq
apt-get install -y -qq curl git ufw postgresql postgresql-contrib ca-certificates >/dev/null
ok "base packages, PostgreSQL $(psql --version | awk '{print $3}')"

if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
  ok "Node $(node -v)"
else
  skip "Node $(node -v)"
fi

if ! command -v caddy >/dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
  ok "Caddy $(caddy version | head -1 | awk '{print $1}')"
else
  skip "Caddy $(caddy version | head -1 | awk '{print $1}')"
fi

# ── 2. firewall ─────────────────────────────────────────────────────────────
step "Firewall"

# SSH is allowed before the firewall comes up, so this cannot lock you out.
ufw allow OpenSSH >/dev/null 2>&1
ufw allow 80/tcp  >/dev/null 2>&1
ufw allow 443/tcp >/dev/null 2>&1
if ufw status | grep -q "^Status: active"; then
  skip "already active"
else
  ufw --force enable >/dev/null
fi
ok "SSH, 80 and 443 open — everything else closed (PostgreSQL included)"

# ── 3. the app's user ───────────────────────────────────────────────────────
step "Account for the app"

if id "$APP_USER" >/dev/null 2>&1; then
  skip "user $APP_USER"
else
  adduser --system --group --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER" >/dev/null
  ok "user $APP_USER (no login shell of its own)"
fi

# ── 4. database ─────────────────────────────────────────────────────────────
step "Database"

db_exists() { sudo -u postgres psql -tAc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1; }
role_exists() { sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='$DB_USER'" | grep -q 1; }

# Hex, so the password can go straight into a connection URL without anything
# needing to be escaped.
DB_PASS="$(openssl rand -hex 24)"

if role_exists; then
  skip "role $DB_USER"
  # A re-run cannot know the old password, so it sets a new one and the .env
  # below is rewritten to match.
  sudo -u postgres psql -qc "alter role $DB_USER with password '$DB_PASS'" >/dev/null
  ok "password reset (server/.env updated to match)"
  ROTATED=yes
else
  sudo -u postgres psql -qc "create role $DB_USER login password '$DB_PASS'" >/dev/null
  ok "role $DB_USER"
fi

if db_exists; then
  skip "database $DB_NAME"
else
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
  ok "database $DB_NAME"
fi

DATABASE_URL="postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME"

# ── 5. the code ─────────────────────────────────────────────────────────────
step "Dependencies"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
cd "$APP_DIR"

sudo -u "$APP_USER" npm ci --no-audit --no-fund --silent
ok "front-end packages"

sudo -u "$APP_USER" bash -c "cd server && npm ci --omit=dev --no-audit --no-fund --silent"
ok "server packages"

step "Tables"
sudo -u "$APP_USER" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f db/schema.sql
TABLES=$(sudo -u "$APP_USER" psql "$DATABASE_URL" -tAc "select count(*) from information_schema.tables where table_schema='public'")
ok "$TABLES tables and views"

# ── 6. configuration ────────────────────────────────────────────────────────
step "Configuration"

ENV_FILE="$APP_DIR/server/.env"

if [ -f "$ENV_FILE" ] && [ "${ROTATED:-no}" = "no" ]; then
  skip "server/.env exists — left alone"
else
  if [ -f "$ENV_FILE" ]; then
    # Keep whatever keys have already been filled in; only the database line
    # needs to change.
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" "$ENV_FILE"
    ok "server/.env — database line updated, your keys kept"
  else
    JWT_SECRET="$(openssl rand -base64 48)"
    sudo -u "$APP_USER" cp server/.env.example "$ENV_FILE"
    sed -i \
      -e "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=\"$JWT_SECRET\"|" \
      -e "s|^PUBLIC_SITE_URL=.*|PUBLIC_SITE_URL=https://$SITE|" \
      -e "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=https://$SITE/api|" \
      -e "s|^GOOGLE_REDIRECT_URI=.*|GOOGLE_REDIRECT_URI=https://$SITE/api/auth/google/callback|" \
      "$ENV_FILE"
    ok "server/.env — database password and sign-in secret generated"
  fi
fi

chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

if [ ! -f "$APP_DIR/.env" ]; then
  sudo -u "$APP_USER" cp .env.example .env
  ok ".env — front-end build settings"
else
  skip ".env"
fi

# ── 7. service files ────────────────────────────────────────────────────────
step "Service files"

cp deploy/bricksnjoy-api.service /etc/systemd/system/
systemctl daemon-reload
ok "systemd unit installed (not started — server/.env is not finished yet)"

if [ -f /etc/caddy/Caddyfile ] && ! grep -q "$SITE" /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-bricksandjoy
  printf '  %ssaved the old one as /etc/caddy/Caddyfile.before-bricksandjoy%s\n' "$dim" "$off"
fi
cp deploy/Caddyfile /etc/caddy/Caddyfile
ok "Caddy config installed (reloaded in step 5, once the domain is ready)"

# ── done ────────────────────────────────────────────────────────────────────
cat <<DONE

$bold── done ──$off

  Steps 1 to 3 are complete, and half of step 5.

$bold  What is left for you$off

  1. Open the settings file and fill in the blanks:

       nano $ENV_FILE

     Everything under R2_ (from Cloudflare, step 4 of the runbook), then the
     keys you copied out of Supabase — RESEND_API_KEY, the MESSAGEOWL_ ones,
     and ANTHROPIC_API_KEY or GEMINI_API_KEY.

     The database password and the sign-in secret are already filled in.
     Do not change them.

  2. Set the picture address in the front-end file to match R2_PUBLIC_BASE:

       nano $APP_DIR/.env

  3. Then build and start:

       cd $APP_DIR
       sudo -u $APP_USER npm run build
       systemctl enable --now bricksnjoy-api
       systemctl reload caddy
       curl -s localhost:4000/api/health

     A reply of {"ok":true,...} means the server side is finished, and you can
     go on to step 6 — moving the data across.

$dim  Nothing is live to customers yet. bricksandjoy.com still points at Vercel
  until you change DNS in step 8.$off

DONE
