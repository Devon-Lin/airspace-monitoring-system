# Deploy configs

Templates referenced by `DEPLOYMENT.md`. Replace `yourdomain.com` in
`Caddyfile` with the real domain, and adjust paths if you don't deploy to
`/opt/mapviz`.

- `Caddyfile` → `/etc/caddy/Caddyfile` on the server
- `mapviz-backend.service`, `mapviz-generator.service` → `/etc/systemd/system/`
