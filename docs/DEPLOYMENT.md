# Deployment

The live application is deployed at **https://linlabs.dev**.

## Where it runs

A single Ubuntu server (DigitalOcean Droplet) runs everything:

- **Caddy**. Reverse proxy and TLS termination, with automatic Let's
  Encrypt certificate issuance and renewal for the domain.
- **Django backend** (Uvicorn, ASGI). Handles the simulation, the ingest
  API, and the real-time SSE stream, as a single worker process. The
  simulation state is held in memory by design (see `Design Analysis.md`).
- **Telemetry generator**. A standalone Python process that simulates the
  aircraft fleet and posts telemetry to the backend. Runs locally on the
  same machine.
- **SQLite**. Backs the persistent data (restricted zones, patrol path).
- **React frontend**. Built as a static bundle and served directly by
  Caddy.

## How it was deployed, from local to live

1. Built the frontend for production. Ran `npm run build` locally,
   producing a static asset bundle. No Node.js runtime is required on the
   server.
2. Switched the database backend from Postgres to SQLite for this
   single-machine deployment. This required no schema changes. The data
   model was already free of any Postgres-specific features.
3. Provisioned a Droplet and pointed the domain's DNS A record at its IP
   address.
4. Installed the runtime on the server: Python for the backend and
   generator, and Caddy for the reverse proxy.
5. Configured environment variables directly on the server (secret key,
   ingest API key, allowed hosts). These are not committed to source
   control.
6. Ran database migrations against the SQLite database.
7. Set up process supervision with systemd, one unit for the backend and
   one for the generator, so both start automatically on boot and restart
   automatically if either process ever crashes.
8. Configured Caddy to reverse proxy `/api/*` to the backend and serve the
   built frontend for everything else, all under the one domain. Caddy
   automatically requested and installed a Let's Encrypt TLS certificate
   for the domain the first time it started.
9. Locked down network access with a cloud firewall. Only HTTP, HTTPS, and
   SSH (from a single administrative source) are reachable. The database
   is not exposed externally at all.
10. Verified the deployment end to end over HTTPS: live aircraft telemetry
    rendering and updating, restricted zone creation and breach detection,
    autonomous drone dispatch, and multi-client real-time sync across two
    separate browser sessions.
