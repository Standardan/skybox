# Skybox — self-hosted, multi-stage build for a lean runtime image.
# Needs the full pnpm workspace as build context (packages/core is consumed
# as TypeScript source via apps/web's transpilePackages, not a prebuilt
# dist), but the final image only carries Next's standalone production
# output — see apps/web/next.config.mjs's `output: "standalone"`.

FROM node:22-slim AS base
RUN corepack enable

# ---- deps: install once, cached across builds as long as manifests don't change ----
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile

# ---- builder: full source, build only @skybox/web (pulls packages/core in via transpilePackages) ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/cli/node_modules ./apps/cli/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY . .
ENV SKYBOX_DOCKER_BUILD=1
RUN pnpm --filter @skybox/web build

# ---- runner: just the standalone output, nothing else ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV SKYBOX_DATA_DIR=/data
ENV SKYBOX_VERSION_FILE=/app/VERSION.txt
RUN groupadd --system --gid 1001 skybox && useradd --system --uid 1001 --gid skybox skybox
# --chown so the unprivileged `skybox` user (below) can actually write into
# these at runtime — Next lazily creates apps/web/.next/cache the first
# time it caches an optimized image, and a root-owned tree it can't write
# into makes every single image request fail with EACCES.
COPY --from=builder --chown=skybox:skybox /app/apps/web/.next/standalone ./
COPY --from=builder --chown=skybox:skybox /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=skybox:skybox /app/apps/web/public ./apps/web/public
# Plain repo file, not derived from `git` — works no matter how the source
# got here (full clone, shallow clone, or a tarball snapshot with no .git
# at all, which is how some platforms fetch a "public repository" build).
# Powers the in-app update check (apps/web/src/lib/update-check.ts).
COPY --chown=skybox:skybox VERSION ./VERSION.txt
RUN mkdir -p /data && chown -R skybox:skybox /data
USER skybox
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
