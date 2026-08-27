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
# Static, dependency-free ffmpeg/ffprobe binaries — no apt-get/apk install
# needed, just a straight binary copy from an image built for exactly this
# (github.com/wader/static-ffmpeg). Used by stream-proxy.ts to remux audio
# (DTS/AC3/TrueHD -> AAC, video stream-copied untouched — cheap, real-time
# even without hardware acceleration) for releases whose audio a browser
# can't decode natively. Deliberately NOT full video transcoding: this VPS
# has no GPU, and real-time 4K HEVC re-encoding on CPU alone isn't
# realistic (Jellyfin's own hardware guidance all but requires GPU
# acceleration for that) — audio-only remux is the part that's actually
# achievable here.
COPY --from=mwader/static-ffmpeg:9.0.1 /ffmpeg /usr/local/bin/ffmpeg
# ffprobe (same image, same static-binary deal) — stream-proxy.ts uses it
# to read a multi-audio-track release's real per-track language metadata
# before remuxing, so it can select the viewer's actual preferred-
# language track explicitly instead of blindly taking whichever audio
# stream happens to be first in the file (confirmed real bug: a release
# with both English and Russian audio played in Russian despite an
# English preference — HDRezka-style Russian releases commonly put the
# Russian dub first, with English as a secondary/alternate track).
COPY --from=mwader/static-ffmpeg:9.0.1 /ffprobe /usr/local/bin/ffprobe
# Real production error this fixes: ffmpeg's own TLS library failed to
# verify the debrid CDN's certificate ("SSL routines::certificate verify
# failed") on every single source, while Node's own fetch() — used by
# stream-proxy's plain (non-remux) passthrough — succeeded against the
# exact same URLs seconds later.
#
# Turned out to be two layered problems, confirmed one at a time against
# the actual running container rather than guessed: pointing OpenSSL at
# the standard Debian cert path via SSL_CERT_FILE/DIR (below) wasn't
# enough on its own, because `ls /etc/ssl/certs/ca-certificates.crt`
# in the real container came back "No such file or directory" — the
# ca-certificates *package* was never actually installed in node:22-slim
# to begin with. Node doesn't need it (it bundles its own root CA list
# compiled into the binary, independent of the OS cert store), so
# node:22-slim's own upstream Dockerfile never installs it for the
# runtime image — only Node needed HTTPS during THAT image's own build
# (downloading the Node tarball), and that step uses curl, not ffmpeg.
# ffmpeg's OpenSSL has no bundled roots of its own; it always needs a
# real system cert store to verify anything, so it's installed here
# explicitly rather than assumed to already exist.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV SSL_CERT_DIR=/etc/ssl/certs
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
