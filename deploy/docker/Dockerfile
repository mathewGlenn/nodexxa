# syntax=docker/dockerfile:1.7
# Nodexxa dashboard + worker image (one image, two commands). Build from the repository root:
#   docker build -f deploy/docker/Dockerfile -t nodexxa:local .
# Optional: --secret id=extra_ca,src=/path/ca.pem  (only for build hosts behind a TLS-intercepting proxy)
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN --mount=type=secret,id=extra_ca,required=false \
    if command -v openssl >/dev/null && [ -f /etc/ssl/certs/ca-certificates.crt ]; then exit 0; fi; \
    if [ -f /run/secrets/extra_ca ]; then \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
      APT_OPTS='-o Acquire::https::CAInfo=/run/secrets/extra_ca'; fi; \
    apt-get $APT_OPTS update && apt-get $APT_OPTS install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/extra_ca ] && echo /run/secrets/extra_ca) \
    npm install -g pnpm@10.28.0 --no-fund --no-audit
WORKDIR /app

# ---- build: full deps, Nuxt production build ----
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/extra_ca ] && echo /run/secrets/extra_ca) \
    pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild @prisma/engines prisma esbuild @parcel/watcher @tailwindcss/oxide
COPY apps/dashboard apps/dashboard
COPY packages packages
RUN cd apps/dashboard && pnpm exec prisma generate && pnpm exec nuxt build

# ---- prod-deps: runtime dependencies only (worker, migrations, CLI) ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/extra_ca ] && echo /run/secrets/extra_ca) \
    pnpm install --frozen-lockfile --prod --ignore-scripts && pnpm rebuild @prisma/engines prisma
COPY apps/dashboard/prisma apps/dashboard/prisma
RUN cd apps/dashboard && pnpm exec prisma generate

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
RUN --mount=type=secret,id=extra_ca,required=false \
    if command -v openssl >/dev/null && [ -f /etc/ssl/certs/ca-certificates.crt ]; then exit 0; fi; \
    if [ -f /run/secrets/extra_ca ]; then \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
      APT_OPTS='-o Acquire::https::CAInfo=/run/secrets/extra_ca'; fi; \
    apt-get $APT_OPTS update && apt-get $APT_OPTS install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 NUXT_TELEMETRY_DISABLED=1 PRISMA_HIDE_UPDATE_MESSAGE=1 CHECKPOINT_DISABLE=1
WORKDIR /app
# Code is owned by root and read-only for the runtime user.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/dashboard/node_modules ./apps/dashboard/node_modules
COPY --from=build /app/apps/dashboard/.output ./apps/dashboard/.output
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/dashboard/prisma ./apps/dashboard/prisma
COPY apps/dashboard/server/utils ./apps/dashboard/server/utils
COPY apps/dashboard/shared ./apps/dashboard/shared
COPY apps/dashboard/worker ./apps/dashboard/worker
COPY apps/dashboard/scripts ./apps/dashboard/scripts
COPY packages ./packages
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health?ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run with an init process (compose `init: true` / `docker run --init`) for signal handling and reaping.
# Dashboard by default. Worker:  apps/dashboard/node_modules/.bin/tsx apps/dashboard/worker/index.ts
# Migrations: apps/dashboard/node_modules/.bin/prisma migrate deploy --schema apps/dashboard/prisma/schema.prisma
CMD ["node", "apps/dashboard/.output/server/index.mjs"]
