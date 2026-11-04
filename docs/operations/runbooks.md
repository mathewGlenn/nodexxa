# Operations runbooks

## Deploy (Docker Compose)
1. Build or pull the image: `docker build -f deploy/docker/Dockerfile -t nodexxa:<version> .`
2. Create the env file **outside the repository**: `install -m 600 deploy/docker/nodexxa.env.example /etc/nodexxa/nodexxa.env`, then set `POSTGRES_PASSWORD`, `DATABASE_URL`, `NODEXXA_ENCRYPTION_KEY` (`openssl rand -base64 32`), `NODEXXA_PUBLIC_URL`.
3. `NODEXXA_IMAGE=nodexxa:<version> NODEXXA_ENV_FILE=/etc/nodexxa/nodexxa.env docker compose -f deploy/docker/compose.yml up -d`
   - `migrate` runs `prisma migrate deploy` once; `dashboard` and `worker` start only after it succeeds.
   - Only the dashboard is published, on `127.0.0.1:${NODEXXA_PORT:-3000}`. Postgres is on an internal network.
   - Containers run as uid 1000 with read-only root FS, `cap_drop: ALL`, `no-new-privileges`, memory/CPU limits.
4. Create the first owner (no default credentials exist):
   `docker compose -f deploy/docker/compose.yml run --rm -T -e NODEXXA_ADMIN_PASSWORD dashboard apps/dashboard/node_modules/.bin/tsx apps/dashboard/scripts/cli.ts create-admin --email you@example.com --name "You" --workspace "Operations"`
5. Health: `GET /api/health` (liveness), `GET /api/health?ready` (DB reachable). The Overview page flags a worker that has not reported for 5 minutes.

### Reverse proxy (TLS termination)
```nginx
server {
  listen 443 ssl http2;
  server_name nodexxa.example.internal;
  ssl_certificate     /etc/ssl/nodexxa/fullchain.pem;
  ssl_certificate_key /etc/ssl/nodexxa/privkey.pem;
  add_header Strict-Transport-Security "max-age=31536000" always;
  client_max_body_size 1m;                       # agent payloads are capped at 512 KiB
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;     # overwrite, never append client values
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```
Set `NODEXXA_TRUST_PROXY=true` only when the proxy overwrites these headers as above.

## Upgrade / rollback
1. Back up the database (below). 2. Pull/build the new image. 3. `docker compose up -d` (migrations run first). 4. Check `/api/health?ready` and the Overview worker panel.
Rollback: redeploy the previous image tag. Migrations are additive; if a release notes a non-backward-compatible migration, restore the pre-upgrade backup instead.

## Backup and restore
- Backup: `docker compose exec -T db sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc' > nodexxa-$(date +%F).dump`
- **Back up `NODEXXA_ENCRYPTION_KEY` separately** (secret manager). Without it, restored DO tokens are unusable (re-enter them); stored together, a backup exposes every token.
- Restore drill: `createdb nodexxa_restore` → `pg_restore -d nodexxa_restore --no-owner < dump` → start a dashboard container with `DATABASE_URL` pointing at it → log in.
- **Drill executed 2026-11-04** in the build sandbox against the Compose stack: dump 56 KB; restored row counts matched (users, workspaces, alert rules, migrations; audit +1 from the verification login); the app booted on the restored DB and login returned 200. Repeat on staging with production-sized data before go-live.

## Failed DigitalOcean token / connection error
Symptoms: connection status `AUTH_ERROR` (401) or capabilities showing "scope missing"; incident "DigitalOcean connection failing". Inventory stays visible and is marked stale.
1. Check the token in the DO control panel (revoked/expired/scopes). 2. Create a new read-only token for the **same team**. 3. Connection page → *Rotate token*. The new token is verified immediately; a token from a different team is refused. 4. *Sync now*.
`RATE_LIMITED`: no action; the next sync is scheduled at the reset time shown.

## Agent offline / stale
1. Agent page shows last report time, agent self-health (queue length, dropped snapshots, last error). 2. On the host: `systemctl status nodexxa-agent`, `journalctl -u nodexxa-agent -n 100`.
- `rejected agent credentials`: agent was revoked or its key lost → re-enroll (new token), then revoke the old agent entry.
- `dashboard unreachable`: network/TLS issue; the agent buffers up to `queueMax` snapshots (default 120 ≈ 2 h) and drops the oldest beyond that.
- `server rejected request sequence`: the state directory was restored from an old backup; restart the agent (it moves the sequence forward).

## Worker unavailable
Overview shows "Background worker is not reporting". `docker compose logs worker`. The worker is stateless; restart it. Several replicas may run safely (leases + advisory locks). While it is down, discovery, checks, alert evaluation, notifications and retention pause; agent ingestion continues (it is served by the dashboard).

## Alerts not delivered
Incidents page → *Notifications* column shows per-channel delivery status. `skipped` = connector not configured (`SMTP_URL`/`SMTP_FROM`, `TELEGRAM_BOT_TOKEN`). `failed` after 5 attempts = check credentials/network; deliveries retry with exponential backoff before that. Incidents are always recorded regardless of delivery.

## Rotate the token-encryption key
1. Generate a new key. 2. Set `NODEXXA_ENCRYPTION_KEY_ID=k2`, `NODEXXA_ENCRYPTION_KEY=<new>`, `NODEXXA_ENCRYPTION_KEYS_PREVIOUS=k1:<old>`; restart dashboard + worker. 3. Run `cli.ts rotate-encryption-key` (re-encrypts every token with k2, audit-logged). 4. Remove `k1` from `_KEYS_PREVIOUS`; restart.

## Rotate an agent key
On the host: `sudo -u nodexxa-agent nodexxa-agent rotate-key --config /etc/nodexxa-agent/config.json`. Audit log records `agent.key_rotated`.

## Release checklist (production)
- [ ] CI green (dashboard + agent workflows) on the release commit
- [ ] Staging connected to a test/authorized DO account; inventory, metrics and a failing+recovering check verified
- [ ] Agent installed on a non-production host via the checksum-verified archive; enroll, report, rotate, revoke verified
- [ ] Backup + restore drill on staging data
- [ ] Threat model reviewed (`docs/engineering/threat-model.md`), dependency audit reviewed
- [ ] Production rollout by an operator (no automated production deployment)
