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
# Captures exactly which commit this image was built from, so the running
# app can tell it apart from whatever's newest on GitHub (in-app update
# check, apps/web/src/lib/update-check.ts). `.git` never reaches the final
# image — multi-stage builds only carry over what `runner` below explicitly
# COPYs, and this stage isn't one of its sources.
RUN git rev-parse HEAD > /VERSION.txt || echo "unknown" > /VERSION.txt

# ---- runner: just the standalone output, nothing else ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV SKYBOX_DATA_DIR=/data
ENV SKYBOX_VERSION_FILE=/app/VERSION.txt
RUN groupadd --system --gid 1001 skybox && useradd --system --uid 1001 --gid skybox skybox
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /VERSION.txt ./VERSION.txt
RUN mkdir -p /data && chown -R skybox:skybox /data
USER skybox
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
