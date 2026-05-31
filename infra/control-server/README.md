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

## Security checklist
- [ ] Postgres/Redis bound to the Tailscale IP only (never `0.0.0.0`)
- [ ] Strong, unique POSTGRES_PASSWORD and REDIS_PASSWORD
- [ ] Host firewall: allow 80/443 public; 5432/6379 only on the tailnet
- [ ] `.env` is gitignored and present only on the server
- [ ] Regular `pg_dump` backups of the `pgdata` volume
