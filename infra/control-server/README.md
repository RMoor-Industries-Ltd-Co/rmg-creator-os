# Control Server — Provisioning Runbook

The control Linode runs the RMG Creator OS stack behind Caddy and serves
`rmg-creator-os.rmasters.group`. The former Story Director Linode becomes the
**render node**, joined privately over Tailscale.

## 0. Prerequisites on the control Linode
- Docker + Docker Compose plugin
- A deploy directory, e.g. `/opt/rmg-creator-os`

## 1. DNS (you do this)
Create an **A record**: `rmg-creator-os.rmasters.group` → control Linode public IP.
(Caddy will obtain a Let's Encrypt cert automatically once the record resolves.)

## 2. Tailscale (both nodes)
Install and join the same tailnet on the control Linode and the render node:

    curl -fsSL https://tailscale.com/install.sh | sh
    sudo tailscale up

Note each node's tailnet IP (`tailscale ip -4`, a `100.x.y.z` address).
Postgres and Redis bind to the **control node's** tailnet IP so the render node can
reach them, but the public internet cannot.

## 3. Configure secrets
On the control server, in the deploy dir:

    cp infra/control-server/.env.example .env
    # set POSTGRES_PASSWORD, REDIS_PASSWORD (openssl rand -base64 32)
    # set TAILSCALE_IP to the control node's `tailscale ip -4`

## 4. Bring up the backbone
Start the shared infra (proxy + DB + queue) before app services exist:

    docker compose -f infra/control-server/docker-compose.yml up -d caddy db redis
    docker compose -f infra/control-server/docker-compose.yml ps

> Caddy will fail TLS until the DNS A record resolves — that's expected; it retries.

## 5. Render node → control queue
On the render node, point the render worker at the control node's Redis over Tailscale:

    REDIS_URL=redis://:<REDIS_PASSWORD>@<CONTROL_TAILSCALE_IP>:6379

## 6. App services
Added to `docker-compose.yml` as each service is built (gateway, dashboard,
story-director, social-manager, allen, allie, my-poster). Each gets
`DATABASE_URL` + `REDIS_URL` and `depends_on` db+redis.

## 7. Backups — pg_dump → Google Drive (rclone)
Daily `pg_dump`, gzipped, uploaded to Google Drive with 30-day retention via
`backup-db.sh` (in this directory).

One-time setup on the server:

    # 1. Install rclone
    curl -fsSL https://rclone.org/install.sh | bash
    # 2. Authorize Drive. On a machine WITH a browser (e.g. your Mac):
    #      rclone authorize "drive" <CLIENT_ID> <CLIENT_SECRET>
    #    Complete the Google consent, then build /root/.config/rclone/rclone.conf:
    #      [gdrive]
    #      type = drive
    #      client_id = <CLIENT_ID>
    #      client_secret = <CLIENT_SECRET>
    #      scope = drive
    #      token = <TOKEN_JSON>
    #    chmod 600 /root/.config/rclone/rclone.conf   # token is secret; never commit
    # 3. Folder + script + cron:
    rclone mkdir gdrive:rmg-backups
    install -m755 backup-db.sh /opt/rmg-creator-os/backup-db.sh
    echo '30 3 * * * /opt/rmg-creator-os/backup-db.sh >> /var/log/rmg-db-backup.log 2>&1' | crontab -

Restore a dump:

    rclone copy gdrive:rmg-backups/<file>.sql.gz /tmp/
    gunzip -c /tmp/<file>.sql.gz | docker compose exec -T db psql -U rmgcreator rmgcreator

> The OAuth token in `rclone.conf` is a live credential — it stays on the server
> only and is never committed. `backup-db.sh` itself is version-controlled here.

## 8. CI/CD (GitHub Actions)
Push to `main` → **CI** (typecheck + build) → **Publish Images** (build & push
`gateway` + `dashboard` to GHCR) → **Deploy** (scp compose/Caddyfile/deploy.sh to
the control server, `docker login`, pull, `compose up -d`). The gateway applies
DB migrations on startup, so each deploy self-migrates.

Required repo secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `CONTROL_HOST` | `45.33.96.135` (control server public IP) |
| `CONTROL_USER` | `root` |
| `CONTROL_SSH_KEY` | private key whose public half is in the server's `authorized_keys` |
| `GHCR_USERNAME` | GitHub username/org (e.g. `PIAAR`) |
| `GHCR_TOKEN` | a PAT with `read:packages` (server pulls private images) |

`deploy.yml` uses a `control` Environment — optionally add protection rules there.
Manual deploy: run the **Deploy** workflow via *workflow_dispatch* with an image tag.

## Security checklist
- [x] Postgres/Redis bound to the Tailscale IP only (never `0.0.0.0`)
- [x] Strong, unique POSTGRES_PASSWORD and REDIS_PASSWORD
- [x] Host firewall: allow 80/443 public; 5432/6379 only on the tailnet
- [x] `.env` is gitignored and present only on the server
- [x] Daily `pg_dump` → Google Drive backups (30-day retention)
