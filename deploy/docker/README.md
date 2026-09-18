# Three sites, three containers, one box

`bricksandjoy.com`, `settleup.tech` and `urahacreativehub.com` each run as
their own Docker application on the KVM2, the way the Docker Manager in
hPanel lists them. A fourth application, `proxy`, is the only thing with a
port open to the internet.

```
                    the internet
                         │
                 :80 :443│
            ┌────────────▼────────────┐
            │  proxy   (edge-caddy)   │   certificates, HTTPS, headers
            └────────────┬────────────┘
                         │  docker network "edge" — no host ports
     ┌───────────────────┼───────────────────┐
     │                   │                   │
┌────▼─────────┐  ┌──────▼───────┐  ┌────────▼────────┐
│bricksandjoy- │  │ settleup-app │  │   uraha-app     │
│    app :4000 │  │        :4100 │  │            :80  │
└────┬─────────┘  └──────┬───────┘  └─────────────────┘
     │                   │
     └─────────┬─────────┘
               │  host.docker.internal
       ┌───────▼────────┐
       │ PostgreSQL 16  │  stays on the host, where its data already is
       └────────────────┘
```

## What this fixes

Today all three share one machine *and* one config file. `settleup.tech` lives
in `/etc/caddy/sites/` and is pulled into the shop's `/etc/caddy/Caddyfile`,
which the shop overwrites on every deploy — so a bad shop deploy can take
SettleUp off the internet, at a moment nobody would connect the two. The three
also share a Node version, a set of system packages and a user.

Separate containers end that. Each site has its own filesystem, its own Node,
its own dependencies and its own config file. The only thing they share is the
`edge` network and the machine's memory.

## What it does not fix

One box is still one box. This is isolation, not redundancy — if the KVM2
goes down, all three go down together. Separate *machines* is a different and
more expensive question; say the word and it is a small change from here
(the compose files barely move; the proxy config splits).

## First run

Nothing below touches the live site until the last step.

```bash
# 1. Docker, if hPanel has not already installed it
curl -fsSL https://get.docker.com | sh

# 2. the shared network — once, by hand, so no `compose down` can delete it
docker network create edge

# 3. let the containers reach the PostgreSQL on the host.
#
#    Three things have to line up, and leaving out the third is a connection
#    that hangs for thirty seconds and then dies with "Connection terminated
#    due to connection timeout" — which reads like the database is down and is
#    really the firewall dropping the packet without a word. (A refusal would
#    say "ECONNREFUSED" straight away. A *timeout* is nearly always ufw.)
#
#    a) the address the app dials. In server/.env, change:
#         DATABASE_URL=postgres://bricksnjoy:PASSWORD@127.0.0.1:5432/bricksnjoy
#       to:
#         DATABASE_URL=postgres://bricksnjoy:PASSWORD@host.docker.internal:5432/bricksnjoy
#
#       That name means the machine when you are inside a container. It means
#       nothing at all outside one — so the bricksnjoy-api systemd service,
#       which reads the same file, would fail to start on its next restart.
#       One line teaches the host the name too, and then both work:
#         echo "127.0.0.1  host.docker.internal" >> /etc/hosts
#
#    b) PostgreSQL listening where the container knocks. Docker resolves
#       host-gateway to the *default* bridge, 172.17.0.1, even for a container
#       on another network — so that is the address to add, not the edge
#       network's own gateway:
#         listen_addresses = 'localhost,172.17.0.1'      in postgresql.conf
#         host all all 172.16.0.0/12 scram-sha-256       in pg_hba.conf
#       then: systemctl restart postgresql
#
#    c) the firewall letting it through. ufw allows 22, 80 and 443 and drops
#       the rest, including traffic from the edge network to the bridge:
#         ufw allow from 172.18.0.0/16 to 172.17.0.1 port 5432 proto tcp \
#             comment 'docker edge -> postgres'
#
#       Check the subnet is really 172.18 before trusting that line —
#       `docker network inspect edge` prints it, and Docker picks a different
#       one if the network is ever deleted and recreated. A rule naming a
#       subnet that no longer exists is a database that times out for no
#       visible reason.
#
#    None of this opens 5432 to the internet: every rule names a private
#    address range that only exists on this machine, and PostgreSQL still
#    wants a password.

# 4. build and start the shop, still with nothing listening on 80/443
cd /srv/bricksandjoy/deploy/docker/bricksandjoy
docker compose build
docker compose up -d
docker compose logs -f app          # "[api] listening on http://0.0.0.0:4000"

# 5. the other two — see the comments in each compose file first
cd ../settleup          # read its compose file first: settleup-mv needs a
docker compose up -d      # HOST override and a Dockerfile before this works
cd ../urahacreativehub  && docker compose up -d

# 6. the cutover. The host's own Caddy owns 80 and 443, so it has to let go
#    before the container can take them. This is the only step with downtime,
#    and it is seconds.
systemctl stop caddy && systemctl disable caddy
cd ../proxy && docker compose up -d
docker compose logs -f caddy        # watch the certificates arrive
```

If anything is wrong, `docker compose down` in `proxy` and
`systemctl enable --now caddy` puts the old arrangement back exactly as it was
— the host's `/etc/caddy/Caddyfile`, the `bricksnjoy-api` service and the
build in `/srv/bricksandjoy/build` are all untouched by any of this.

Keep `bricksnjoy-api` stopped but installed for a week or so before removing
it, rather than deleting it the same day. It costs nothing and it is the way
back.

## One database each

The containers are separate; the database must be too, or the isolation is
half a job. A single PostgreSQL role that both the shop and SettleUp connect
with would mean a flaw in either one reaches the other's tables — customers,
orders and takings on one side, people's shared expenses on the other.

So: one database and one role per application, each able to see only its own.
They share the PostgreSQL *server* — that is fine, it is what a server is for
— and nothing else.

```sql
-- as postgres:  sudo -u postgres psql

-- The shop already has these; this is what SettleUp gets.
CREATE ROLE settleup LOGIN PASSWORD 'something-long-and-random';
CREATE DATABASE settleup OWNER settleup;

-- Neither role may look inside the other's database. PostgreSQL lets any
-- role connect to any database by default, so this has to be said out loud.
REVOKE CONNECT ON DATABASE settleup   FROM PUBLIC;
REVOKE CONNECT ON DATABASE bricksnjoy FROM PUBLIC;
GRANT  CONNECT ON DATABASE settleup   TO settleup;
GRANT  CONNECT ON DATABASE bricksnjoy TO bricksnjoy;
```

Check it took — this must fail:

```bash
PGPASSWORD='settleups-password' psql -h 127.0.0.1 -U settleup -d bricksnjoy -c 'select 1'
#   FATAL:  permission denied for database "bricksnjoy"
```

SettleUp's own `DATABASE_URL` then names its own database and its own role, and
goes in `deploy/docker/settleup/settleup.env` — never in the shop's
`server/.env`.

If the two databases should not share a *server* either, give SettleUp its own
PostgreSQL container: a `postgres:16-alpine` service in its compose file with a
named volume, reachable only from that project. Stronger, and it costs a
migration of whatever data SettleUp already has plus a second database to back
up. The split above is the one worth doing first; this is the one to do if
SettleUp ever holds something the shop should not be one bug away from.

## Day to day

```bash
docker ps                                   # what is running
docker compose logs -f app                  # one site's log, from its directory
docker compose up -d --build                # deploy: rebuild and swap
docker compose exec --workdir /app/server app npm run schema   # apply db/schema.sql
docker stats                                # what is using the memory
```

A deploy is `git pull && docker compose up -d --build` in the site's
directory. The build happens before anything is stopped, so a build that fails
leaves the running container exactly where it was — the same property
`deploy/deploy.sh` has today, for the same reason.

## Adding a fourth site

1. A directory here with a `docker-compose.yml`, on the `edge` network,
   `container_name` set, no `ports:`.
2. A file in `proxy/sites/` naming the domain and `reverse_proxy <name>:<port>`.
3. `docker compose up -d` in the new directory, then
   `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile` in
   `proxy/`.

No existing site's files are edited, which is the whole point of the
arrangement.

## The bare-metal path is still here

`deploy/deploy.sh`, `deploy/Caddyfile` and `deploy/bricksnjoy-api.service`
still describe the arrangement running today and still work. Nothing in this
directory is used until the steps above are run on the server. Once the
cutover is done and settled, that path can be deleted — until then, two ways
back is better than one.
