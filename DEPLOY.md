# Running Brick's & Joy on your own server

Everything used to be split across two companies: Vercel served the website,
Supabase held the database, the accounts, the uploaded pictures, the four
background functions and the "who's online" channel. Now one VPS runs the lot,
and Cloudflare R2 holds the pictures.

**What you need**

| | |
|---|---|
| A VPS (KVM 2 or better) | Ubuntu 22.04 or 24.04, root access |
| The `bricksandjoy.com` domain | with its DNS pointed at the VPS |
| A Cloudflare account | free tier is fine — R2 needs a card on file, but the free allowance covers a shop this size |
| Your Supabase project | still running, until the move is finished |

Allow about an hour. Nothing here has to be done in one sitting except step 7,
the switch-over.

---

## What runs where now

```
                        the internet
                             │
                   ┌─────────┴──────────┐
                   │  Cloudflare DNS    │
                   └─────────┬──────────┘
                             │
  ┌──────────────────────────┴───────────┐      ┌──────────────────────┐
  │  your KVM2                           │      │  Cloudflare R2       │
  │                                      │      │                      │
  │  Caddy :443   TLS, one job           │      │  product photos      │
  │     │                                │      │  payment slips       │
  │     └── Node :4000                   │◄─────┤  event pictures      │
  │           ├── the built React site   │      │                      │
  │           ├── /api/db      queries   │      │  read straight by    │
  │           ├── /api/auth    accounts  │      │  the browser, free   │
  │           ├── /api/storage → R2      │      └──────────────────────┘
  │           ├── /api/functions  SMS,   │
  │           │      email, AI, reports  │
  │           ├── /realtime   who's online
  │           └── cron: reminders, report│
  │                    │                 │
  │            PostgreSQL 16 (localhost) │
  └──────────────────────────────────────┘
```

Two things are worth knowing before you start.

**The app was not rewritten.** All ~380 database calls still read
`supabase.from('orders').select(...)`. `src/lib/supabase.js` is now a stand-in
that speaks to `/api` instead. Nothing else in `src/` changed except three small
things noted at the end.

**Passwords do not come across.** Supabase never lets anyone read its password
hashes, not even you. Everyone signs in once more: staff get a password from you
(step 6), shoppers use "forgot password" on the shop.

---

## 1. The server

SSH in as root.

```bash
apt update && apt upgrade -y
apt install -y curl git ufw postgresql postgresql-contrib

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Caddy — HTTPS with nothing to configure and nothing to renew
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Only three ports should be open. PostgreSQL is deliberately not one of them —
nothing outside this machine ever talks to the database.

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

A user for the app, with no login shell of its own:

```bash
adduser --system --group --home /srv/bricksandjoy --shell /usr/sbin/nologin bricksnjoy
```

## 2. The database

```bash
sudo -u postgres psql
```

```sql
CREATE USER bricksnjoy WITH PASSWORD 'pick-a-long-random-one';
CREATE DATABASE bricksnjoy OWNER bricksnjoy;
\q
```

PostgreSQL's default settings already refuse connections from outside the
machine. Confirm it, because this is the one thing worth being sure about:

```bash
grep "^listen_addresses" /etc/postgresql/*/main/postgresql.conf
# nothing, or 'localhost' — if it says '*', change it to 'localhost' and restart
```

## 3. The code

```bash
mkdir -p /srv/bricksandjoy
chown bricksnjoy:bricksnjoy /srv/bricksandjoy
sudo -u bricksnjoy git clone https://github.com/bricksnjoy/bricks-and-joy.git /srv/bricksandjoy
cd /srv/bricksandjoy

sudo -u bricksnjoy npm ci
sudo -u bricksnjoy bash -c "cd server && npm ci --omit=dev"
```

Create the tables:

```bash
sudo -u bricksnjoy psql "postgres://bricksnjoy:YOUR_PASSWORD@127.0.0.1:5432/bricksnjoy" -f db/schema.sql
```

`db/schema.sql` is the whole schema in one file — it replaces
`supabase_schema.sql` and all thirteen files in `integrations/`, which were
separate only because each had to be pasted into the Supabase SQL editor by
hand. Every statement is idempotent, so re-running it is how a new column
reaches a live database.

## 4. Cloudflare R2

In the Cloudflare dashboard:

1. **R2 → Create bucket**, name it `uploads`.
2. **R2 → Manage API tokens → Create token**, permission **Object Read & Write**.
   Copy the Access Key ID and Secret Access Key — the secret is shown once.
3. Note your **Account ID**, top right of the R2 page.
4. **Your bucket → Settings → Public access**. Either turn on the r2.dev
   address, or (better) **Connect a custom domain** —
   `files.bricksandjoy.com`. Cloudflare adds the DNS record itself.

The custom domain is worth doing. It is a nicer URL in the database, it can be
cached and purged from the dashboard, and r2.dev is rate-limited and not meant
for production traffic.

## 5. Configuration

```bash
sudo -u bricksnjoy cp server/.env.example server/.env
sudo -u bricksnjoy nano server/.env
chmod 600 server/.env
```

Fill in, at minimum:

```ini
DATABASE_URL=postgres://bricksnjoy:YOUR_PASSWORD@127.0.0.1:5432/bricksnjoy
JWT_SECRET=            # openssl rand -base64 48
PUBLIC_SITE_URL=https://bricksandjoy.com
PUBLIC_API_URL=https://bricksandjoy.com/api

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=uploads
R2_PUBLIC_BASE=https://files.bricksandjoy.com
```

Then everything you were already using — copy these across from
**Supabase → Edge Functions → Secrets**, they have not changed:
`RESEND_API_KEY`, `EMAIL_FROM`, `REPORT_FROM`, `MESSAGEOWL_*`,
`ANTHROPIC_API_KEY` or `GEMINI_API_KEY`.

And the front-end build settings:

```bash
sudo -u bricksnjoy cp .env.example .env
sudo -u bricksnjoy nano .env      # set REACT_APP_R2_PUBLIC_BASE to match above
```

> `JWT_SECRET` is what proves a session is genuine. Generate it once and leave
> it alone — changing it signs everybody out.

Build the site and start the API:

```bash
sudo -u bricksnjoy npm run build

cp deploy/bricksnjoy-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bricksnjoy-api
systemctl status bricksnjoy-api

cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

Check it:

```bash
curl -s https://bricksandjoy.com/api/health
# {"ok":true,"uptime":12,"tables":34}
```

## 6. Moving the data

Put your Supabase credentials in `server/.env` **temporarily** — the service
role key, from **Supabase → Project Settings → API**. It can read everything, so
delete these two lines again as soon as the move is done.

```ini
SUPABASE_URL=https://fhldnruakpqiydhjsjan.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Look before you leap:

```bash
cd /srv/bricksandjoy/server
sudo -u bricksnjoy node scripts/migrate-from-supabase.js --dry-run
```

It prints every table, how many rows it found, and any column that exists in one
database and not the other. Read that list. Then:

```bash
sudo -u bricksnjoy node scripts/migrate-from-supabase.js
```

It copies the tables in dependency order, turns `auth.users` into `app_users`
keeping the same ids (so every `created_by` and `customer_id` still points at
the right person), copies the whole `uploads` bucket into R2, and rewrites every
stored picture URL from the Supabase address to the new one.

It is safe to run again. Rows already there are left alone, files already in R2
are skipped — so if it stops halfway, just start it again.

Now make yourself a back-office account:

```bash
sudo -u bricksnjoy node scripts/create-staff.js you@example.com "Your Name"
```

The password is typed at the prompt and never appears in your shell history.

**This is the only way a staff account is made.** Signing up on the shop always
creates a customer. That is a change: on Supabase, anyone who created a shop
account got the role `authenticated`, and every back-office table was open to
that role — so any shopper could have read the customer list and every order.

## 7. Switching over

Test first, without touching the live site. On your own machine, add to
`/etc/hosts` (or `C:\Windows\System32\drivers\etc\hosts`):

```
YOUR.VPS.IP.ADDRESS  bricksandjoy.com
```

Now your browser goes to the VPS while everyone else still goes to Vercel. Sign
in, open Inventory, Orders, Supplier Catalog, Batch Orders. Check the pictures
load. Place a test order on the shop. Send yourself one SMS and one email.

When you are happy, remove the hosts line and change the real DNS:

* **A** record, `bricksandjoy.com` → your VPS IP
* **A** record, `www` → your VPS IP

Give it up to an hour. Then in Vercel, **Settings → General → Delete Project**,
and take `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` back out of
`server/.env`.

**Leave the Supabase project alone for a fortnight.** It costs nothing to keep
and it is the only copy of anything the migration might have missed. Delete it
once you are sure.

---

## Day to day

**Deploying a change**

```bash
cd /srv/bricksandjoy && ./deploy/deploy.sh
```

Pull, build, apply any schema change, restart, and confirm it came back. If the
build fails the old one keeps serving and nothing is restarted.

**Watching it**

```bash
sudo journalctl -u bricksnjoy-api -f
sudo systemctl status bricksnjoy-api
curl -s localhost:4000/api/health
```

**Backups.** Nobody else is keeping a copy of this any more, which is the real
cost of leaving Supabase. Set this up on day one:

```bash
sudo -u bricksnjoy mkdir -p /srv/bricksandjoy/backups
sudo -u bricksnjoy crontab -e
```

```cron
0 2 * * * pg_dump "$DATABASE_URL" | gzip > /srv/bricksandjoy/backups/db-$(date +\%F).sql.gz
0 3 * * * find /srv/bricksandjoy/backups -name 'db-*.sql.gz' -mtime +30 -delete
```

A backup on the same machine only survives a mistake, not a fire. Copy them off
weekly — `rclone` to the same R2 account is the easiest, and R2 charges nothing
to receive them.

**Restoring one**

```bash
gunzip -c backups/db-2026-08-20.sql.gz | psql "$DATABASE_URL"
```

---

## What changed in the app

Three things, beyond `src/lib/supabase.js`:

* **`src/lib/imageCompress.js`** — `storagePathFromUrl` now recognises R2 and
  API addresses as well as the old Supabase ones, so the catalog's "compress
  photos" tool still finds the object behind a picture. All three shapes are
  accepted, because pictures uploaded at different times are stored at
  different addresses and all of them are still in the database.

* **`src/lib/uploadImage.js`** — uses the object name storage actually filed the
  file under. The server renames uploads from anyone who is not signed-in staff,
  so a shopper's payment slip cannot land on top of a product photo.

* **`src/App.js` and `src/pages/Login.js`** — signing in to `/backoffice` with a
  shop account now says so, instead of showing the whole sidebar with an error
  behind every page.

Everything else — all forty-odd pages, every query — is untouched.

## If something goes wrong

**The site is down, `systemctl status` says the API is not running.**
`journalctl -u bricksnjoy-api -n 50`. Nearly always `server/.env`: a database
password with a character that needs escaping in the URL, or a missing
`JWT_SECRET`.

**Pages load but every list is empty.** The API cannot reach PostgreSQL.
`curl localhost:4000/api/health` will say so. Check `DATABASE_URL` and
`systemctl status postgresql`.

**Pictures are broken but the data is fine.** `R2_PUBLIC_BASE` and
`REACT_APP_R2_PUBLIC_BASE` disagree, or the bucket has no public access. Note
that the front-end one is baked in at build time — change it and rebuild.

**"Sign in to do that" on a page that used to work.** You are signed in as a
customer, not staff. `node scripts/create-staff.js` with your email address
fixes it — run against an existing address it changes the role and the password.

**Everyone was signed out at once.** `JWT_SECRET` changed. If you still have the
old value, put it back.
