# Nodexxa

Self-hosted, read-only infrastructure monitoring for multiple DigitalOcean teams, with an optional outbound-only Go agent for Linux hosts (system metrics, PM2, Docker, Nginx, systemd).

- **Layer 1 — DigitalOcean**: one encrypted, read-only token per team; discovery of Droplets, App Platform apps/deployments, managed databases and projects (many-to-many); Droplet metrics; staleness and scope-aware capability reporting.
- **Layer 2 — Linux agent**: single static Go binary, Ed25519-signed protocol, one-time enrollment, rotation and revocation, bounded offline queue.
- **Monitoring**: SSRF-safe HTTP(S) uptime and TLS-expiry checks, alert rules with duration/hysteresis/dedup/cooldown, incidents with acknowledgment, email/Telegram notifications, retention with hourly rollups.
- **UI**: Nuxt 4 + Nuxt UI admin with Light / Dark / System themes (persisted, no flash), workspace roles (Owner/Admin/Viewer), audit log.

Out of scope by design: remote shell/commands, restarts, deployments, any DigitalOcean write operation.

## Repository
| Path | Contents |
|---|---|
| `apps/dashboard` | Nuxt 4 UI, Nitro API (`server/api`), shared logic (`server/utils`), worker (`worker/`), CLI (`scripts/cli.ts`), Prisma schema + migrations, tests |
| `agents/linux` | Go agent (`cmd/nodexxa-agent`, `internal/{agent,collect,protocol}`), release script |
| `packages/protocol` | Generated JSON Schema + versioned fixtures shared by Node and Go tests |
| `deploy/docker` | Dockerfile (dashboard + worker image), Compose, env example |
| `deploy/systemd` | Hardened agent unit, example config, install/rotate/uninstall guide |
| `docs` | Specs, [decisions](docs/decisions.md), [threat model](docs/engineering/threat-model.md), [runbooks](docs/operations/runbooks.md), [DO API usage](docs/reference/digitalocean-api.md) |

## Local development
Requirements: Node 22, pnpm 10, Go 1.24, PostgreSQL 16.
```bash
pnpm install
cp apps/dashboard/.env.example apps/dashboard/.env   # set DATABASE_URL and NODEXXA_ENCRYPTION_KEY (openssl rand -base64 32)
cd apps/dashboard
pnpm exec prisma migrate deploy
pnpm cli create-admin --email you@example.test --name You --workspace Dev   # prompts for a password
pnpm dev                     # dashboard on http://localhost:3000
pnpm worker                  # separate terminal: discovery, checks, alerts, notifications, retention
```
For a demo without a real DigitalOcean account: `pnpm fake-do` (listens on :4010), set `DO_API_BASE_URL=http://127.0.0.1:4010` and `NODEXXA_INSECURE_COOKIES=true` in `.env` (both refused when `NODE_ENV=production`), then add a connection using a token from `tests/fixtures/fake-do.ts`.

## Tests
```bash
pnpm lint && pnpm typecheck
pnpm test                    # unit (Vitest)
pnpm build
pnpm test:integration        # API/DB tests against the production build on a fresh, per-run database
pnpm test:e2e                # Playwright journeys (same harness)
pnpm test:agent              # Go vet + tests with -race
```
Integration/E2E need a Postgres role that may create databases: `TEST_DATABASE_SERVER_URL` (default `postgresql://nodexxa:nodexxa@localhost:5432/postgres`). Each run creates `nodexxa_it_<timestamp>_<pid>` and drops only that database.

## Deployment
See [runbooks](docs/operations/runbooks.md) (Compose, reverse proxy, backups, upgrades) and [agent install](deploy/systemd/README.md). Implementation evidence and remaining gaps: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). **Not production-certified**: a staging rehearsal against an authorized DigitalOcean account and a real host is still required.
