import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lean runtime image for Docker (Dockerfile copies just .next/standalone +
  // .next/static + public/) — see docs/06-ROADMAP.md / README "Deploy with Docker".
  // Docker-only: `next start` explicitly doesn't support standalone output
  // ("does not work with output: standalone" warning) — a local
  // `pnpm build && pnpm start` needs the regular build, which it already
  // has full node_modules for anyway (unlike the Docker image, which is
  // standalone specifically to avoid shipping those). The Dockerfile sets
  // SKYBOX_DOCKER_BUILD=1 before building; nothing else should.
  output: process.env.SKYBOX_DOCKER_BUILD ? "standalone" : undefined,
  // Pinned explicitly: Next otherwise infers the workspace root by walking
  // up for the nearest lockfile, which on a dev machine with an unrelated
  // lockfile somewhere above this repo picks the WRONG root and changes
  // where `.next/standalone`'s mirrored path (and therefore server.js)
  // ends up — fragile and host-dependent. Pinning it here makes the
  // standalone output path deterministic (`.next/standalone/apps/web/server.js`)
  // regardless of what else exists on the machine building the image.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  images: {
    // Cinemeta's public poster CDN — used for representative demo artwork only
    // (well-known titles), per DESIGN-BRIEF.md §3 Asset Readiness Gate.
    remotePatterns: [{ protocol: "https", hostname: "images.metahub.space" }],
  },
  // @skybox/core ships TypeScript source (no build step) with explicit
  // `.js`-suffixed relative imports (NodeNext/Bundler-style — resolves fine
  // for tsc's `moduleResolution: "Bundler"`, but webpack's default resolver
  // looks for a literal `errors.js` next to `errors.ts` and 500s at runtime
  // even though typecheck is clean). transpilePackages routes the package
  // through Next's own transform; extensionAlias teaches webpack to try
  // `.ts`/`.tsx` when a `.js` import doesn't exist as a literal file.
  transpilePackages: ["@skybox/core"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
