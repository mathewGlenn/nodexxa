# Autonomous execution plan (single Claude session)

Work in vertical slices and commit/push after verified milestones. Maintain `IMPLEMENTATION_STATUS.md` continuously.

1. **Foundation:** scaffold monorepo, Prisma schema/migrations, secure auth, workspace membership, theme tokens and reusable layout, basic CI.
2. **DO Layer 1:** encrypted scoped connections, discovery of teams/projects/droplets/apps/db metadata where authorized, pagination, provider errors, sync worker and inventory pages.
3. **Monitoring baseline:** external HTTP/TLS checks, historical health, staleness, resource details and metrics if supported; rate-limited scheduler, charts.
4. **Agent Layer 2:** versioned protocol, Go collectors, secure registration, agent ingest/heartbeat, correlation of agent with discovered droplet, agent status UI.
5. **Alerting:** condition evaluation, incident lifecycle, cooldowns, deduplication, email/Telegram optional credential-driven connectors, audit trail.
6. **Production:** hardened permissions, retention, backups/recovery docs, packaging and systemd, integration/protocol tests, E2E user journeys, concurrency/security tests, builds, accessibility/theme verification.

Favor completion of core vertical slices rather than broad unfinished placeholders. Do not silently skip security controls or invent test results. Never operate against real resources without explicit supplied credentials and approval. DO read-only queries are allowed only with connected authorized credentials; do not enable mutations.
