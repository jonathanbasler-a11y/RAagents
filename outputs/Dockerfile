# Container image of the chat app (05_demo/app) for a copy hosted on a server, behind HTTPS.
#
# Build from this outputs/ folder: the app reads the agent specs from 04_agents, which sits
# outside the app folder.
#   docker build -t hybrid-team .
#
# Plain Dockerfile syntax only (no BuildKit features), so builders without BuildKit work too.
# NODE_IMAGE can point at a registry mirror of the same Debian-based image; the lockfile carries
# glibc builds of its native packages, so an Alpine image will not do. Litestream below is the
# x86_64 build: build and run on amd64.
#
# Sign-in is required in this image (RAAGENTS_REQUIRE_SIGN_IN=1): without an admin password the
# app starts locked, never open. Settings at run time:
# - LLM_BASE_URL, LLM_API_KEY, LLM_API_KEY_HEADER, LLM_MODEL: the model gateway (see env.example).
# - RAAGENTS_ADMIN_PASSWORD (16+ characters, random) and optionally RAAGENTS_ADMIN_USERNAME
#   (default "admin"): the admin, who creates everyone else's account on the People page
#   (src/server/access-gate.ts). Sessions need HTTPS: the cookie is Secure.
# - RAAGENTS_TRUSTED_PROXY_HOPS: 1 here, for one load balancer in front that appends
#   X-Forwarded-For; set 0 if nothing in front adds that header.
# - RAAGENTS_HOSTED_NOTICE: banner text for the hosted copy; also switches the agents' rule about
#   where chats are kept (src/server/prompts/rules.ts).
# - LITESTREAM_REPLICA_URL (e.g. s3://bucket/path/chat.db?region=eu-central-1): keeps the
#   database, accounts included, across restarts (scripts/hosted/start.sh). Credentials come from
#   the platform's role or AWS_* variables. LITESTREAM_ALLOW_EMPTY_START=1 for the first start only.
#
# Exactly one container may write a backup at a time. If the platform starts the new container
# before it stops the old one, stop the old one first (scale to 0, wait, deploy, scale to 1): the
# start script refuses to start while another copy is still writing. Schema migrations are
# forward-only: an older image refuses a newer database, so going back needs a restored backup.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY 05_demo/app/package.json 05_demo/app/package-lock.json 05_demo/app/.npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY 05_demo/app/ ./
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund && rm -rf .next/cache

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOST=0.0.0.0 \
    PORT=8501 \
    CHAT_DB_PATH=/data/chat.db \
    AGENT_SPECS_DIR=/app/agents \
    RAAGENTS_REQUIRE_SIGN_IN=1 \
    RAAGENTS_TRUSTED_PROXY_HOPS=1

# Litestream, pinned by version and checksum (published release asset digest).
ADD https://github.com/benbjohnson/litestream/releases/download/v0.5.17/litestream-0.5.17-linux-x86_64.tar.gz /tmp/litestream.tgz
RUN echo "cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d  /tmp/litestream.tgz" | sha256sum -c - \
 && mkdir /tmp/litestream \
 && tar -xzf /tmp/litestream.tgz -C /tmp/litestream \
 && find /tmp/litestream -type f -name litestream -exec install -m 0755 {} /usr/local/bin/litestream \; \
 && rm -rf /tmp/litestream /tmp/litestream.tgz \
 && litestream version

COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/evals/packs/practice-01 ./evals/packs/practice-01
COPY --from=build /app/scripts/hosted/start.sh /app/scripts/hosted/server.sh /app/scripts/hosted/backup-age.mjs ./scripts/hosted/
COPY 04_agents/ ./agents/

RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8501
CMD ["/bin/sh", "scripts/hosted/start.sh"]
