# Cloud Run image for @oilio/web (Next.js standalone, pnpm monorepo).
#
# Built from the REPO ROOT as context (the pruned subtree needs the workspace):
#   docker build -f apps/oilio/web/Dockerfile -t <img> \
#     --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=... [other NEXT_PUBLIC_* args] .
#
# Strategy: `turbo prune --docker` carves the monorepo down to @oilio/web +
# its workspace deps, split into a deps-only layer (out/json) and full source
# (out/full) so dependency installs cache across source-only changes.
#
# NOTE: build-verified in the user's Docker env (Docker isn't installed on the
# authoring machine). See docs/ci-cd.md.

# syntax=docker/dockerfile:1
FROM node:22.22.3-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

# --- Prune to the @oilio/web subtree --------------------------------
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.9.14 prune @oilio/web --docker

# --- Install deps + build ------------------------------------------------
FROM base AS builder
WORKDIR /app
# Lockfile + package.jsons first → cached unless deps change.
COPY --from=pruner /app/out/json/ .
# turbo prune omits .husky/, but the root `prepare` script (node .husky/
# install.mjs) runs during install — copy it so node can load it, and CI=1 makes
# its guard exit 0 (husky is dev-only). CI scoped to install so next build is
# unaffected.
COPY --from=pruner /app/.husky ./.husky
RUN CI=1 pnpm install --frozen-lockfile
# Full pruned source.
COPY --from=pruner /app/out/full/ .

# NEXT_PUBLIC_* are baked into the client bundle at build time (public Firebase
# web config — not secrets). Passed as build args from CI/CD variables.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

RUN pnpm --filter @oilio/web run build

# --- Runtime -------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
USER nextjs

# Next standalone preserves the workspace path inside the bundle, so server.js
# and static land under apps/oilio/web/. Next does NOT fold public/ or
# .next/static into the standalone output — both are copied explicitly. public/
# carries the PWA icons (manifest references /icons/*.png); without this COPY the
# manifest points at 404s and the app is not installable.
COPY --from=builder --chown=nextjs:nodejs /app/apps/oilio/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/oilio/web/.next/static ./apps/oilio/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/oilio/web/public ./apps/oilio/web/public

# Cloud Run injects $PORT (defaults 8080); Next standalone reads PORT/HOSTNAME.
ENV HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["node", "apps/oilio/web/server.js"]

# --- Event-store migration runtime --------------------------------------
# A SEPARATE runtime from the app server: the event-store migration runs as a
# dedicated Cloud Run Job (brief 0057, ADR 0011 D2 — never at app boot, the
# advisory-lock races across N instances). It can NOT reuse the `runner` image:
# Next's standalone output bundles `drizzle-orm` INTO the compiled server chunks
# and prunes it from `node_modules`, so the standalone has no resolvable
# `drizzle-orm` for a plain `node scripts/migrate-event-store.mjs` entrypoint
# (it exits MODULE_NOT_FOUND). This stage instead keeps the FULL installed
# `node_modules` from `builder` (where `drizzle-orm/node-postgres/migrator` + `pg`
# resolve) plus the script and the versioned SQL it applies. App image stays lean;
# migration gets its own runtime — same multi-stage Dockerfile, zero duplication
# of the base/pruner/builder layers.
FROM base AS migrate
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
USER nextjs
# Full resolvable dependency tree (drizzle-orm migrator + pg live here), the
# migration entrypoint, and the SQL it reads from `../drizzle`.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/oilio/web/scripts ./apps/oilio/web/scripts
COPY --from=builder --chown=nextjs:nodejs /app/apps/oilio/web/drizzle ./apps/oilio/web/drizzle
COPY --from=builder --chown=nextjs:nodejs /app/apps/oilio/web/package.json ./apps/oilio/web/package.json
ENTRYPOINT ["node", "apps/oilio/web/scripts/migrate-event-store.mjs"]
