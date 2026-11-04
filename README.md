# Nodexxa

A unified self-hosted infrastructure monitoring control center for multiple DigitalOcean teams/accounts, projects, servers, and applications. Adds optional outbound-only Go agents for deep visibility into Linux hosts, PM2, Docker, Nginx, and background jobs.

**Scope:** read-only monitoring, alerts, historical telemetry, inventory and asset grouping. Remote execution and write-capable operations are explicitly out of scope for v1.

## Planned monorepo
- `apps/dashboard` — Nuxt 4 UI, Nitro APIs and polling workers
- `agents/linux` — standalone compiled Go agent running via systemd
- `packages/protocol` — versioned JSON schema and generated/tested contracts
- `deploy/docker` — central services deployment
- `deploy/systemd` — secure agent unit and enrollment guides
- `docs` — product, architecture, modules, engineering, design, acceptance

Begin with `CLAUDE.md`, then `START_CLAUDE_SESSION.md`. The repository currently contains specifications, not a built product.
