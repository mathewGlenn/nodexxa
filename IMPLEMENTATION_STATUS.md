# Nodexxa — Implementation status

Status values: Not started / In progress / Implemented (unverified) / Verified / Blocked.
"Verified" means verified **in the build sandbox** by the evidence listed — not production-certified. Production release still requires the staging rehearsal in `docs/operations/runbooks.md`.

| Workstream | Status | Evidence / notes |
|---|---|---|
| Monorepo, tooling and CI | Verified (local) / CI unverified | pnpm workspace + Go module; lint, typecheck, build pass locally. `.github/workflows/{dashboard,agent}.yml` written with path filters; **not yet run on GitHub Actions**. |
| Authentication, roles and internal organizations | Verified | scrypt, hashed server-side sessions, CSRF origin check, Postgres rate limits, Owner/Admin/Viewer, invitations, CLI bootstrap. `auth.test.ts` (11), `journeys.spec.ts`. |
| DigitalOcean connections and encrypted tokens | Verified (fake DO API) | AES-256-GCM key ring + AAD, masked suffix, same-team rotation, key-rotation CLI. `crypto.test.ts`, `connections.test.ts`. **No real DO account was used.** |
| DO discovery and project membership | Verified (fake DO API) | Droplets/apps/DBs/projects, pagination, colliding IDs across teams, many-to-many projects, scope-aware capabilities, missing≠deleted, secret allow-listing. Real worker process synced in live demo. |
| DO metrics and App Platform deployments | Verified (fake DO API) | Monitoring API CPU/mem/disk/load with unavailable states; last 20 deployments. Real DO response shapes confirmed only against documentation, not live API. |
| External HTTP / TLS checks | Verified | SSRF policy (IPv4/IPv6/mapped, rebinding pinning, per-hop redirects), timeouts, TLS expiry. `probe.test.ts`, `alerts.test.ts`. TLS-expiry read path not exercised against a real HTTPS target in tests. |
| Go agent telemetry collectors | Verified (unit + container) | system/PM2/Docker/Nginx/systemd with leak tests; `go test -race`. In the sandbox PM2/Nginx were absent (reported `unavailable`) and systemd not PID 1 (reported `error`); **not run on a real host with PM2/Docker/Nginx**. |
| Secure enrollment, rotation and ingestion | Verified | Ed25519 signatures, one-time tokens (concurrent replay), sequence replay protection, size/batch/rate limits, revocation, key rotation. `agents.test.ts` + real Go binary E2E (`go-agent.test.ts`). |
| Resource reconciliation and staleness | Verified | `missingSince`, stale connections, unknown vs healthy semantics, operator-confirmed droplet linking. |
| Dashboard + theme switching | Verified | 14 pages; Light/Dark/System persisted per user + cookie; no-flash test with app JS blocked; zero console/hydration errors on every page in both modes; mobile no-overflow. `theme.spec.ts`, `responsive.spec.ts`. No formal accessibility audit (axe) run. |
| Alerts, deduplication, notifications | Verified (Telegram fake) | 11 rule types, duration/hysteresis, cooldown reopen, partial unique index, outbox with retries; Telegram via fake API, SMTP shown disabled when unconfigured. Real SMTP/Telegram delivery **unverified**. |
| Data retention and operational observability | Verified | Hourly rollups + expiry (`alerts.test.ts`), worker heartbeats on Overview, `/api/health?ready`, JSON worker logs. |
| Unit, integration, E2E and protocol tests | Verified | See test log below. |
| Docker, agent systemd, install/update docs | Verified with caveats | Image built and Compose stack run (migrate→dashboard+worker, non-root, read-only FS, Secure cookies, DB unpublished). Built on `node:22-bookworm` because Debian apt mirrors are blocked here; the default slim+apt path is **unbuilt**. systemd unit verified with `systemd-analyze verify/security` (exposure 1.8) but **not run under real systemd**. Release script builds checksummed amd64/arm64 archives; **no signing key configured**. |
| Security review, recovery drills and release criteria | In progress | Threat model + decisions documented; backup/restore drill executed (see runbooks). `pnpm audit --prod`: 1 high (deepmerge-ts via Prisma CLI, build-time) + 4 low/moderate; govulncheck blocked in sandbox. Staging rehearsal, real-host agent install and independent security review **not done**. |

## Test log (2026-11-04, branch `claude/nodexxa-implementation-2wfw9g`)
Environment: cloud sandbox, Node 22.23, Go 1.24.7, PostgreSQL 16.15, Docker 29.9, Chromium (Playwright 1.63).

| Command (in `apps/dashboard` unless noted) | Result |
|---|---|
| `npx eslint .` | 0 problems |
| `npx nuxt typecheck` | 0 errors |
| `npx vitest run --project unit` | 76 / 76 passed |
| `npx nuxt build` | success |
| `npx vitest run --project integration` (built server, fresh DB, fake DO) | 38 / 38 passed (5 files, incl. real Go binary E2E) |
| `npx playwright test` | 12 / 12 passed (desktop + Pixel 7) |
| `agents/linux`: `gofmt -l`, `go vet`, `go test -race -count=1 ./...` | clean, all packages pass |
| `agents/linux/scripts/release.sh 0.1.0` | 2 static archives, `sha256sum -c` OK |
| `docker build` + `docker compose up` smoke test | migrate OK, dashboard healthy, worker running, admin login 200 |
| Backup/restore drill (`pg_dump -Fc` → `pg_restore` → boot + login) | counts match, login 200 |
| Live demo: real worker + real Go agent + fake DO | 2 teams synced, agent online & linked, failing check → 1 critical incident |
| `pnpm audit --prod` | 5 findings (1 high, build-time) after nodemailer 10 upgrade (was 25 / 5 high) |
| `govulncheck` | **not run** — vuln.go.dev blocked (403) |

Bugs found and fixed by the tests: IPv4 addresses blocked via an IPv4-mapped IPv6 rule in Node's `BlockList`; empty table headers causing SSR hydration mismatches; a token-shaped literal in a test (caught by GitHub push protection, replaced).

## Commits
`f54352c` foundation · `a02fd60` UI + tests · `be1eef8` Go agent · `f790df7` E2E · (this commit) packaging, CI, docs.

## Remaining before production
1. Run CI on GitHub and fix any runner differences. 2. Staging against an authorized read-only DO token. 3. Install the agent on a non-production host with PM2/Nginx (Docker opt-in) under real systemd. 4. Real SMTP/Telegram delivery test. 5. Build the slim image with normal apt access. 6. Configure release signing. 7. Accessibility audit and independent security review.
