/**
 * Tiny webhook receiver: the only job of this whole container. Never
 * reachable from the internet — it's not published to the host (see
 * docker-compose.yml), only from `skybox`'s own container over the
 * internal Compose network, and only in response to an admin explicitly
 * clicking "Apply update" (apps/web/src/app/api/settings/update/apply/route.ts),
 * which is itself behind Skybox's own admin-only auth. This process is the
 * only thing in the whole deployment with Docker socket access — isolating
 * that privilege here, out of the internet-facing app, is the entire point
 * of this being a separate service instead of a route inside Skybox itself.
 *
 * One real HTTP server (not shell/netcat) specifically so method/path are
 * checked properly rather than reacting to any connection at all.
 */
const http = require("node:http");
const { execFile } = require("node:child_process");

const PORT = process.env.PORT || 9999;
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

let updating = false;

function runUpdate() {
  if (updating) return;
  updating = true;
  execFile("/update.sh", { timeout: UPDATE_TIMEOUT_MS }, (err, stdout, stderr) => {
    updating = false;
    // This container's own restart takes skybox down with it for a few
    // seconds, so nothing can "respond" to the original request by the
    // time this finishes anyway — `docker logs updater` is the real record.
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (err) console.error("[updater] update.sh failed:", err.message);
    else console.log("[updater] update applied.");
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, updating }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/apply-update") {
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (updating) {
    res.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "already-updating" }));
    return;
  }
  res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "started" }));
  runUpdate();
});

server.listen(PORT, () => console.log(`[updater] listening on :${PORT}`));
