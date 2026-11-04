# Architecture and technology

## Monorepo
- `apps/dashboard`: Nuxt 4 + Vue 3 + Nitro, Nuxt UI, Tailwind, TypeScript, Prisma/PostgreSQL, Zod.
- `agents/linux`: Go executable, dependency-light, Linux amd64/arm64, systemd unit; no Node runtime necessary.
- `packages/protocol`: OpenAPI/JSON Schema for enrollment/heartbeat/telemetry; version numbers and fixtures for compatibility tests.
- `deploy`: Docker Compose for central platform and systemd sample configs for agent.

## Execution model
Use a separate bounded polling / background worker process in the same application codebase, not long-running timers within Nuxt HTTP handlers. Distributed scheduling requires safe leases/advisory locks, bounded concurrency, retry/backoff, rate-limit handling, timeouts, and idempotent upserts. Database migrations must be versioned and reversible where feasible.

## DigitalOcean integration
One connection per team token or supported account authorization. API tokens kept encrypted at rest with authenticated encryption and a separately provided encryption key; expose only masked metadata. Use least-privilege read scopes, do not require write scopes. Validate on connection, support revocation and rotation; handle failures/expired scopes. Discover paginated resources and project membership, honoring team boundaries and API rate limits. Show unsupported metrics as unavailable, not made up. Source of truth for cloud metadata is DigitalOcean; source for internal applications is the agent or external checks.

## Agent architecture
Agent makes outbound-only HTTPS requests to central API. Enrollment uses short-lived, single-use token, bound to workspace/host registration; on exchange issue a per-agent revocable credential stored in root-protected file or service credential store. Define secure credential rotation. No inbound port or remote-command endpoint. Agent signs/authenticates requests using issued credential over TLS. Central side enforces request sizes, batch limits, freshness and replay resistance (nonce/timestamp or monotonic sequence), rate limits, revocation and per-agent authorization; all agent-submitted data treated as untrusted. Scope collectors to approved information, no environment variables, command lines, auth tokens, secrets, sensitive Nginx config or arbitrary filesystem scans.

## Identity / authorization
Local internal users and workspace-level Owner/Admin/Viewer roles. Authenticated membership governs access to connections, agent details, incidents, integrations and audit logs. All API handlers enforce authorization server-side; read-only viewers cannot manage tokens/enrollment/notification settings. API request validation with Zod and cross-workspace negative tests.

## Data storage
PostgreSQL for identities, resources, agent registry, configuration, summary telemetry, incidents, alerts, audits. Downsample and expire high-volume time series; bounded retention and backpressure. Store provider IDs plus connection ID to avoid collisions between different accounts. Resource reconciliation handles deleted/unavailable resources without abrupt history loss.

## Deployment
Containerized dashboard/API and separate worker; Postgres; TLS terminated by controlled reverse proxy. Prefer non-root containers, health/readiness endpoints, migration strategy, secret injection, tested backups and restoration. Agent installed separately via versioned, checksum-verified release binary and least-privilege systemd service. No `curl | bash` requirement.
