# @skybox/cli — manual test harness

Not the app. This is a set of scripts for proving `packages/core` works against **real** services (Real-Debrid, a real Stremio addon, your real IPTV provider) instead of the mocked fetches the unit tests use. Everything it touches is local — no UI, no server, just the command line.

All state (tokens, cached channel lists) lives in `.local/` at the repo root, which is gitignored. Nothing here is ever written to the docs.

## Commands

```bash
# 1. Zero-credential sanity check — proves addon-client works over the real network
pnpm -F @skybox/cli run check:cinemeta

# 2. Real-Debrid auth — either device flow (opens a browser code, no password):
pnpm -F @skybox/cli run auth:rd -- start    # prints a URL + code
pnpm -F @skybox/cli run auth:rd -- poll     # waits until you confirm it, then saves the token
# ...or a private API token from real-debrid.com/apitoken (simpler, doesn't expire):
npx tsx src/auth-rd.ts token <YOUR_TOKEN>
pnpm -F @skybox/cli run auth:rd -- status   # checks the saved token/account

# 3. IPTV — create .local/iptv-credentials.json first (see below), then:
pnpm -F @skybox/cli run check:iptv

# 4. Resolve a real on-demand stream end-to-end (needs RD auth if the stream is a magnet)
pnpm -F @skybox/cli run resolve:stream -- <addonManifestUrl> <type> <id> [streamIndex]
# e.g.: pnpm -F @skybox/cli run resolve:stream -- https://torrentio.strem.fun/manifest.json movie tt0111161
# Note: some public addon instances (Torrentio, Comet) block unconfigured/datacenter
# requests at the network level — that's their anti-abuse gate, not a bug here. Use
# one of your own configured addon URLs (with your debrid key baked in) for a real test.

# 4b. Prove the Real-Debrid resolveMagnet pipeline directly, no addon needed
# (defaults to a well-known legal torrent — Ubuntu's official ISO — if no infoHash given)
pnpm -F @skybox/cli run resolve:rd [infoHash]

# One-shot summary of everything configured so far
pnpm -F @skybox/cli run smoke
```

## IPTV credentials file

Create `.local/iptv-credentials.json` yourself (this repo never writes your password to disk on your behalf). `baseUrls` accepts a list — useful if your provider rotates through multiple mirror domains, which `check:iptv` will automatically fail over between (see "Mirror failover" in `docs/04-INTEGRATIONS.md` §3):

```json
{ "baseUrls": ["http://mirror1:port", "http://mirror2:port"], "username": "...", "password": "..." }
```

A single `"baseUrl"` string also works if you only have one.
