# Skybox (working codename)

One app for everything you watch: live TV & sports (via your own IPTV subscription), plus movies & TV shows (via Stremio-compatible addons + your own debrid service). A sports-first home screen that matches today's games in your followed leagues to the channel actually airing them.

**Skybox includes no content, sources, addons, or credentials of its own.** You bring your own debrid account (Real-Debrid, AllDebrid, Premiumize, or TorBox), your own Stremio-compatible addon URLs, and your own IPTV subscription. The app is the viewing experience layered on top of services you already pay for.

**This guide assumes no prior experience.** If you've never used a terminal or set up a server before, you can still follow this end to end — every command is spelled out, and nothing here requires knowing how to code.

## Contents

- [Self-hosted, by design](#self-hosted-by-design)
- [Which setup is right for you?](#which-setup-is-right-for-you)
- [Option 1: Try it on your own computer](#option-1-try-it-on-your-own-computer)
- [Option 2: Set it up on a server (the "hub")](#option-2-set-it-up-on-a-server-the-hub)
  - [Step 1 — Get a server](#step-1--get-a-server)
  - [Step 2 — Connect to your server](#step-2--connect-to-your-server)
  - [Step 3 — Install Docker](#step-3--install-docker)
  - [Step 4 — Get Skybox onto your server](#step-4--get-skybox-onto-your-server)
  - [Step 5 — Start it up](#step-5--start-it-up)
  - [Step 6 — Get a domain name (recommended)](#step-6--get-a-domain-name-recommended)
  - [Step 7 — Turn on HTTPS](#step-7--turn-on-https)
  - [Deploying with Coolify instead](#deploying-with-coolify-instead)
- [First launch: create your admin account](#first-launch-create-your-admin-account)
- [Connect your services](#connect-your-services)
- [Add people in your household](#add-people-in-your-household)
- [Keeping Skybox updated](#keeping-skybox-updated)
- [Troubleshooting](#troubleshooting)

## Self-hosted, by design

There is no hosted version of Skybox, and there never will be one run by anyone on your behalf. Every instance is independent: your credentials, your watch history, your server. Hosting a shared instance for other people means holding their debrid/IPTV credentials and streaming through them at scale — a materially different, more exposed thing than a personal self-hosted tool, so it isn't something this project does or supports. This isn't a limitation to work around — it's the point. See [LICENSE](LICENSE) for the terms you're free to run, modify, and redeploy your own copy under.

## Which setup is right for you?

| | Option 1: Your own computer | Option 2: A server (VPS) |
|---|---|---|
| **Good for** | Trying it out, or watching on just one device | Your whole household, on every device, all the time |
| **Stays on when your computer is off?** | No | Yes — it's a small remote computer that runs 24/7 |
| **Everyone shares the same Continue Watching?** | N/A — just you | Yes, per account you sign in as (Settings → Users) |
| **Setup time** | ~5 minutes | ~20–30 minutes, mostly waiting |
| **Cost** | Free | A few dollars a month for the server, optionally a domain name |

You can always start with Option 1 to try it out, then move to Option 2 later — nothing is wasted.

## Option 1: Try it on your own computer

You'll need [Node.js](https://nodejs.org) (version 20 or newer) and [pnpm](https://pnpm.io/installation) installed. If you don't have them:

- **Mac**: open **Terminal** (search for it with Spotlight, ⌘+Space) and run:
  ```bash
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  brew install node
  corepack enable
  ```
- **Windows**: install Node.js from [nodejs.org](https://nodejs.org) (download the installer, run it, click through the defaults), then open **PowerShell** and run:
  ```powershell
  corepack enable
  ```
- **Linux**: use your distro's package manager (e.g. `sudo apt install nodejs npm`) or [nodejs.org](https://nodejs.org), then `corepack enable`.

Then, in the same terminal:

```bash
git clone https://github.com/Standardan/skybox.git
cd skybox
pnpm install
pnpm --filter @skybox/web dev
```

Open the address it prints — normally [http://localhost:3000](http://localhost:3000) — in your browser. Skip to [First launch](#first-launch-create-your-admin-account).

To keep it running permanently on your own machine (so other devices on your home network/Wi-Fi can reach it too), stop that with Ctrl+C and instead run:

```bash
pnpm --filter @skybox/web build
pnpm --filter @skybox/web start
```

Other devices on the same network can then reach it at `http://<your-computer's-local-IP>:3000` (found under Wi-Fi/network settings, usually starts with `192.168.` or `10.`).

## Option 2: Set it up on a server (the "hub")

This is the recommended path if more than one person or device will use Skybox. It uses **Docker**, which packages Skybox with everything it needs so you don't have to install Node.js, pnpm, or anything else on the server by hand.

There are two ways to actually run it once you have a server: the manual Docker Compose steps below (Steps 2–7), or **[Coolify](#deploying-with-coolify-instead)**, a free self-hosted dashboard that does most of this for you with clicks instead of commands — including HTTPS — and is genuinely the easier path if you're not comfortable in a terminal. Either way, Step 1 (getting the server itself) is the same.

### Step 1 — Get a server

You need a **VPS** (Virtual Private Server) — a small computer, rented by the month, that lives in a data center and stays on all the time. Any of these work well and are beginner-friendly:

- [Hetzner](https://www.hetzner.com/cloud) — inexpensive, straightforward dashboard
- [DigitalOcean](https://www.digitalocean.com) — very beginner-friendly, lots of written guides
- [Linode/Akamai](https://www.linode.com) — similar to DigitalOcean

When creating the server:
- Choose **Ubuntu** as the operating system (22.04 or newer — pick whatever's the default/newest option).
- The cheapest/smallest plan is enough to start.
- The provider will show you the server's **IP address** (four numbers separated by dots, like `203.0.113.42`) — write it down, you'll need it.
- The provider will also give you a way to log in — usually either a **root password** emailed/shown to you, or an **SSH key** you upload when creating the server. Either works with the next step.

### Step 2 — Connect to your server

You "connect" using SSH — think of it as remote-controlling the server's own terminal from yours.

- **Mac or Linux**: open **Terminal**, then run (replacing the IP address with your own):
  ```bash
  ssh root@203.0.113.42
  ```
- **Windows**: open **PowerShell** or **Windows Terminal** (both have SSH built in on modern Windows) and run the same command.

The first time, it'll ask if you trust this server — type `yes` and press Enter. If you were given a password, paste or type it now (the cursor won't move while you type a password — that's normal).

You're now "inside" the server — every command from here on runs there, not on your own computer.

### Step 3 — Install Docker

Copy and run this single command — it's Docker's own official installer:

```bash
curl -fsSL https://get.docker.com | sh
```

This takes a minute or two and installs everything needed, including Docker Compose (which you'll use next).

### Step 4 — Get Skybox onto your server

```bash
apt update && apt install -y git
git clone https://github.com/Standardan/skybox.git
cd skybox
```

### Step 5 — Start it up

If you just want to try it right away using the server's IP address (no domain name yet):

```bash
docker compose up -d --build
```

This takes a few minutes the first time (building the app). When it finishes, open `http://203.0.113.42:3000` (your server's real IP) in a browser from any device — you should see Skybox's setup screen. You can stop here, or continue to Step 6 for a real domain name and automatic HTTPS (recommended, especially if you'll use this outside your home network).

> **Important:** most VPS providers block incoming connections by default and require you to explicitly allow them, usually called a **Firewall** or **Security Group** in your provider's dashboard. If the page above doesn't load, that's the first thing to check — make sure port **3000** (or **80** and **443**, if you're using a domain) is allowed in.

### Step 6 — Get a domain name (recommended)

A domain name (like `skybox.yourlastname.com`) gives you a real, memorable, private address instead of an IP number — and it's what makes automatic, real HTTPS (the padlock icon) possible.

1. Buy one from a registrar — [Porkbun](https://porkbun.com) and [Namecheap](https://www.namecheap.com) are simple and cheap (often a few dollars a year for less common endings).
2. In that registrar's dashboard, find **DNS** or **DNS records** for your domain, and add a new record:
   - **Type**: `A`
   - **Host/Name**: `@` (means the bare domain) — or a subdomain like `skybox` if you want `skybox.yourdomain.com`
   - **Value/Points to**: your server's IP address (from Step 1)
   - **TTL**: leave it at the default
3. Save it. This can take anywhere from a couple of minutes to a few hours to take effect (called "DNS propagation") — if it doesn't work immediately, wait a bit and try again.

### Step 7 — Turn on HTTPS

Back in your server's terminal (still inside the `skybox` folder from Step 4):

```bash
nano Caddyfile
```

This opens a simple text editor. Replace `your-domain.com` on the first line with your real domain from Step 6, then save and exit: press **Ctrl+O**, then **Enter**, then **Ctrl+X**.

Now start everything, including automatic HTTPS:

```bash
docker compose --profile https up -d --build
```

Wait about 30 seconds (Caddy is fetching a free, real certificate for your domain automatically — nothing for you to do), then open `https://yourdomain.com` from any device. That's it — every device that opens that address gets the real, secure Skybox site, and the certificate renews itself forever.

### Deploying with Coolify instead

[Coolify](https://coolify.io) is a free, self-hosted dashboard that manages Docker deployments for you — no manual `docker compose` commands, and it handles HTTPS itself. This replaces Steps 2–7 above entirely; you still need a server from Step 1 first.

1. **Install Coolify** on your server (skip this if you already have it running): SSH in (Step 2 above) and run
   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
   ```
   This also installs Docker for you. When it finishes, it prints an address like `http://your-server-ip:8000` — open that and create your Coolify admin account immediately (the first person to reach that page becomes the admin, so don't leave it open to the world for long).

2. **Create a new Project** in Coolify, then add a new **Resource** inside it. Choose **Public Repository**, and paste your Skybox repository's URL (e.g. `https://github.com/Standardan/skybox.git` if you're using this repo directly, or your own fork's URL).

3. When Coolify asks how to build it, choose **Dockerfile** — Skybox already has one at the root of the repo, so there's nothing to configure here.

4. **Add persistent storage before your first deploy.** This step matters — skipping it means every redeploy destroys the container and starts a brand new empty one, wiping your admin account, everyone else's accounts, watch history, and all your debrid/IPTV/sports settings. Skybox keeps all of that in one folder inside the container, `/data`, and by default Docker containers don't keep anything outside of what's baked into the image — so without a mount, `/data` resets to empty on every redeploy.

   Open the resource's **Storage** (or **Persistent Storage**) panel and click **+ Add**. Coolify will ask what kind of mount you want — here's what each option actually does, and which one you want:

   - **Volume Mount** — *use this one.* Coolify creates and manages a Docker volume for you; you never have to think about where it physically lives on the server. Fill in a **Name** (anything, e.g. `skybox-data`) and set **Destination Path** to `/data`. Leave everything else blank/default. This is the simplest option and the one used throughout the rest of this guide.
   - **Directory Mount** — an alternative if you specifically want the data files sitting in a folder you can browse or back up yourself on the server's own disk. Set **Source Path** to an absolute folder on the host, e.g. `/data/skybox` (Coolify creates it if it doesn't exist), and **Destination Path** to `/data`. Functionally equivalent to Volume Mount — pick this only if "I want to `ls` the files myself over SSH" matters to you.
   - **File Mount** and **Host File Mount** — *don't use these here.* Both map a single individual file into the container, not a folder. Skybox writes several files into `/data` (accounts, config, watch history, the learned sports channel matches), so a single-file mount can't hold them — pick Volume Mount or Directory Mount instead.

   Either way, the **Destination Path must be exactly `/data`** — that's the path Skybox is already configured to read and write from inside the container, so nothing else needs to change to match it.

5. **Set up your domain.** In the resource's **Domains** (or **FQDN**) field, either paste your own domain (same DNS A-record step as Step 6 above — point it at your server's IP), or use the free auto-generated address Coolify offers if you don't have one yet. Coolify issues the HTTPS certificate for this automatically.

6. Click **Deploy**. Once it finishes, open your domain — you should land on **Create admin account**, same as any other install.

A few things that work differently here than the manual path:
- **Don't enable Skybox's own `--profile https` (Caddy)** — Coolify's own reverse proxy (Traefik) is already doing that job. Running both fights over the same ports.
- **Skybox's port isn't reachable directly** (`http://your-server-ip:3000` won't work) — Coolify routes everything through the domain you set in step 5 instead. That's expected, not a bug.
- **To update, use Coolify's own Redeploy button** (or turn on its auto-deploy-on-push option) instead of Settings → Updates' "Apply update" — that button relies on a piece (the `updater` service) that a plain Dockerfile deployment doesn't include.

## First launch: create your admin account

Whichever path you took, the very first time you open Skybox it shows **Create admin account** instead of anything else — this is expected, and it's the only account that can manage other accounts later. Pick a username and password (at least 8 characters) and submit. You're now signed in.

## Connect your services

Go to **Settings** and add whichever of these you have:

- **Debrid** — connect Real-Debrid, AllDebrid, Premiumize, or TorBox (sign-in only, no passwords typed into Skybox).
- **Addons** — paste the manifest URL(s) of any Stremio-compatible addon you already use for movies/shows.
- **Live TV providers** — your Xtream Codes login, or an M3U playlist URL (+ optional EPG URL).
- **Sports** — pick the leagues/teams you follow.

Any of these can be skipped and added later — screens show an honest "nothing connected yet" state rather than a fake demo.

## Add people in your household

As the admin, go to **Settings → Users** to add more accounts — set a username and a temporary password for each person, which they can change after signing in. Everyone shares the same connected services (debrid/addons/IPTV/sports), but each person's Continue Watching and favorites are their own.

## Keeping Skybox updated

As an admin, **Settings → Updates** always tells you whether a newer version exists — it checks against GitHub, nothing applies automatically, and nobody but an admin can even see it. From there:

- **One-click, if you started the optional updater** (`docker compose --profile updates up -d` — see below): click **Apply update** and it's done in about a minute.
- **Manual, always works regardless:** from inside the `skybox` folder on your server —
  ```bash
  git pull
  docker compose --profile https up -d --build
  ```
  (Drop `--profile https` if you're not using a domain.)

Either way, your accounts, credentials, and watch history are untouched — they live in the `data` folder next to the code, not inside the container.

To enable the one-click path, start the updater alongside everything else:

```bash
docker compose --profile https --profile updates up -d --build
```

This adds one more small container whose only job is applying updates when you click the button — it's the only part of the whole setup with any access to Docker itself, kept deliberately separate from the internet-facing app, and it isn't reachable from outside your server. Skipping it is completely fine; the manual two commands above always work.

## Troubleshooting

- **The page won't load at all (plain Docker Compose, not Coolify).** Check your VPS provider's Firewall/Security Group settings and make sure the ports you're using are allowed in (3000 for IP-only access, or 80 and 443 if you set up a domain). Also check the server's own firewall with `sudo ufw status` — if it says `inactive`, the server itself isn't blocking anything, so look at the provider's firewall instead.
- **`http://your-server-ip:3000` doesn't load, and you're using Coolify.** This is expected, not a bug — Coolify doesn't publish container ports straight to the server's IP the way plain `docker compose up` does. You can confirm this by running `sudo ss -tlnp | grep LISTEN` on the server: if `3000` isn't in that list, nothing is listening there at all, no firewall change will fix it, and you need the **Domains**/**FQDN** field instead (see [Deploying with Coolify](#deploying-with-coolify-instead)).
- **Something else on the server already uses port 3000 (plain Docker Compose).** Create a file named `.env` next to `docker-compose.yml` (copy `.env.example` as a starting point) containing `SKYBOX_PORT=8088` (or any free port), then `docker compose up -d`. Skybox will be reachable at that port instead — nothing else changes. (On Coolify, set this in the resource's own environment-variables UI instead of a `.env` file — though once you're accessing Skybox via a Coolify domain, this setting isn't actually in the request path anymore, so it's rarely what you need.)
- **HTTPS/certificate errors right after Step 7.** Give DNS a bit longer to propagate (see Step 6), then re-run `docker compose --profile https up -d`. Caddy retries automatically.
- **Forgot the admin password.** On the server, run `nano data/users.json`, find the account's entry, and delete its whole `{ ... }` block from the list (careful to keep the surrounding `[` and `]` and commas valid), save (Ctrl+O, Enter, Ctrl+X), then `docker compose restart skybox`. If that was the only account, Skybox will show the first-run setup screen again on next visit.
- **A live channel won't play, or feels slow to load a channel list.** Some IPTV providers are simply unreliable moment to moment — try a different channel, or wait and retry. This isn't unique to Skybox.

## Design decisions

- **Custom app**, not a fork or a glue-together of existing tools.
- **Web-first** (React + Next.js), native **tvOS app is a future goal**.
- **Stremio addon protocol** for movie/TV sources — existing addons (Torrentio etc.) work day one.
- **Cinemeta** (Stremio ecosystem) for catalogs/metadata.
- **Debrid-agnostic**: Real-Debrid, AllDebrid, Premiumize, and TorBox all work — pick whichever you already have.
- **IPTV via Xtream Codes API** (with M3U+XMLTV fallback).
- **No central server of any kind** — every instance is independently self-hosted; accounts exist only on your own instance, gating who can use it, not a third-party sign-up.
- **Two first-class deployment shapes** — local single-device, or Docker on a VPS as an always-on multi-device hub, with an optional bundled Caddy service for one-line automatic HTTPS.
- **Update checks, never silent auto-updates** — Settings tells an admin when something's new; applying it is always an explicit click or command, never automatic.
- **Sports-first, but configurable** — sports rail is a feature users enable and tune, not hardcoded.
- **Open source, MIT-licensed** — anyone can run their own instance.
