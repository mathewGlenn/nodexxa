# Testing and security verification

Automated checks: TypeScript strict type checking, lint, Nuxt production build, Vitest units, DB-backed integration tests in isolated PostgreSQL, Playwright auth/connection/agent/alert/theme flows; Go tests and race detector; schema compatibility fixture tests; dependency audits. CI should use fake DO fixtures and mocked HTTPS server so no cloud tokens are needed. No production contact in CI.

Security threat model covers: stolen DO token, SSRF via uptime checks, forged/replayed agent telemetry, cross-workspace access, secret leakage through PM2/Docker/Nginx collectors, token rollover, overly privileged Docker socket, XSS, CSRF, auth brute force, high-cardinality ingestion abuse, memory/disk exhaustion, data retention and user/admin audit.

Negative tests: cross-workspace access, invalid or revoked credential, replay or duplicate sequence, oversized batch, spoofed agent-to-droplet mapping, unauthenticated connection read, denied Viewer mutation, malformed discovery results, rate-limit handling and old client compatibility. Validate encryption key rotation policy and no credentials in logs. Prevent SSRF via DNS/redirect validation, deny loopback/private/link-local/metadata endpoints, consider split-horizon and IPv6.

Operational runbooks: upgrades, failed DO token, agent offline, broker/worker unavailability, DB backup and restoration, alerts failing, key rotation. Do not claim production-ready without staging rehearsal.
