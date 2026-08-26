# Minimal, single-purpose image: Docker CLI (to rebuild/restart the skybox
# service) + git (to pull) + Node (to run a real HTTP server instead of
# ad-hoc shell/netcat request parsing). Nothing else. See server.js's doc
# comment for why this is its own isolated container rather than a route
# inside the main app.
FROM docker:27-cli
RUN apk add --no-cache git nodejs
WORKDIR /app
COPY server.js ./server.js
COPY update.sh /update.sh
RUN chmod +x /update.sh
EXPOSE 9999
CMD ["node", "server.js"]
