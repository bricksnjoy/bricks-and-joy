# Brick's & Joy — the whole site in one image: the built React app and the API
# that serves it, exactly as deploy/deploy.sh produces them on a bare server.
#
# Built in stages so the shipped image carries neither the React toolchain nor
# a single build-time dependency — only Node, the server's runtime packages and
# the finished build/. That is roughly 200MB instead of roughly 1.5GB, and it
# is the difference between a deploy that pulls in seconds and one that does not.
#
#   docker compose -f deploy/docker/bricksandjoy/docker-compose.yml build

# ── 1. the front end ────────────────────────────────────────────────────────
FROM node:20-alpine AS web

WORKDIR /app

# Dependencies first, and only the two files that decide them. Change a
# component and this layer is still cached; change package.json and it is not.
# That is the whole reason the copy is split in two.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY .eslintrc.undef.js ./
COPY public ./public
COPY src ./src

# The same crash gate the bare-metal deploy runs, for the same reason: a name
# used but never defined builds cleanly and blanks the page at runtime. Failing
# here means a bad image is never built, let alone started.
RUN npm run --silent lint:undef

# GENERATE_SOURCEMAP=false leaves out the .map files — see deploy/deploy.sh for
# why we do not hand out a labelled floor plan of the back office.
ARG REACT_APP_API_URL=/api
ARG REACT_APP_R2_PUBLIC_BASE=
ENV REACT_APP_API_URL=$REACT_APP_API_URL \
    REACT_APP_R2_PUBLIC_BASE=$REACT_APP_R2_PUBLIC_BASE \
    GENERATE_SOURCEMAP=false \
    CI=1
RUN npx react-scripts build

# ── 2. the API's dependencies ───────────────────────────────────────────────
FROM node:20-alpine AS api-deps

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── 3. what actually runs ───────────────────────────────────────────────────
FROM node:20-alpine

# psql, so `npm run schema` works from inside the container and a schema change
# reaches the database the same way it does on a bare server.
RUN apk add --no-cache postgresql-client curl

WORKDIR /app

COPY --from=api-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY db ./db
COPY --from=web /app/build ./build

# Node's own unprivileged user, already in the base image. Nothing in here ever
# needs to write to the filesystem, so root would only be a liability.
USER node

# 127.0.0.1 is right on a bare server, where Caddy sits on the same machine. In
# a container it means "nobody can reach me, including the proxy".
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000

EXPOSE 4000

# Docker restarts an unhealthy container; the proxy stops sending it traffic in
# the meantime. /api/health is the same endpoint deploy.sh waits on.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

CMD ["node", "server/index.js"]
