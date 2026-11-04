# Threat model and security controls

Scope: the dashboard/API, worker, PostgreSQL, and the Linux agent. Assets: DigitalOcean tokens, agent identities, user sessions, inventory and telemetry, incident/notification configuration, audit trail.

| Threat | Controls | Verification |
|---|---|---|
| **Stolen DO token (DB leak)** | AES-256-GCM, key outside the DB (env), AAD binds row; read-only scopes recommended; masked suffix only in UI/API; tokens never logged (error messages use DO error ids only) | `crypto.test.ts`, `connections.test.ts` (ciphertext ≠ token, API/audit responses contain no token) |
| **Stolen DO token (in transit / pagination)** | Token sent only to the configured API origin; redirects disabled; next-page links on other hosts abort | `digitalocean.test.ts` |
| **Encryption key compromise / rotation** | Key ring with key ids; `cli.ts rotate-encryption-key` re-encrypts with compare-and-swap; old key removable afterwards | `crypto.test.ts` rotation case; runbook |
| **SSRF via uptime checks** | Per-hop DNS validation of all addresses, IPv4+IPv6 block lists incl. mapped/NAT64/6to4/Teredo, `.internal/.local/localhost` refused, connect to the validated IP (anti-rebinding), manual redirects (max 5), no URL credentials, 64 KiB body cap, timeouts | `probe.test.ts` (redirect to 169.254.169.254 refused) |
| **Forged / replayed agent telemetry** | Ed25519 signature over method+path+agent+timestamp+seq+body hash; ±300 s window; atomic monotonic sequence; generic 401s | `agents.test.ts` (forged key, replay, reorder, stale) |
| **Enrollment token abuse** | 256-bit random, hashed, ≤24 h expiry, atomic single use (concurrent replays tested), per-IP rate limit, admin-only creation, audit | `agents.test.ts`, Go E2E |
| **Agent revocation** | Status checked on every request; immediate 401 | `agents.test.ts`, Go E2E |
| **Cross-workspace access** | Every handler resolves `ws` → membership (404 for non-members, uniform for malformed ids); all queries filter by `workspaceId`; link targets checked in-workspace | `auth.test.ts`, `agents.test.ts` |
| **Privilege escalation by viewers/admins** | Role checks server-side; admins cannot manage owners; ≥1 owner invariant in a transaction; cannot change own membership | `auth.test.ts`, `journeys.spec.ts` |
| **Secret leakage via collectors** | PM2: decode allow-listed fields only, child env stripped; Docker: list API only; Nginx: 3 directives, certs parsed for public data only; server schemas strip unknown fields | Go `collect_test.go` (LEAK_ markers), `agents.test.ts`, `protocol.test.ts` |
| **Overprivileged Docker socket** | Docker collector off by default, explicit config + drop-in group, documented root-equivalence | `config.example.json`, systemd README |
| **XSS** | Vue escaping, no `v-html`; agent strings bounded and regex-validated (hostnames, unit names, container ids); `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` | `protocol` invalid fixtures (hostname injection) |
| **CSRF** | Origin/Sec-Fetch-Site check on all cookie-authenticated mutations; SameSite=Strict | `auth.test.ts` |
| **Auth brute force / credential stuffing** | Per-IP and per-account fixed windows in Postgres; constant-time comparison; dummy hash for unknown users; generic error | `auth.test.ts` |
| **Session theft** | HttpOnly, Secure (production), SameSite=Strict; hashed at rest; server-side logout; password change revokes all sessions | `auth.test.ts`; Compose smoke test showed `Secure; HttpOnly; SameSite=Strict` |
| **High-cardinality ingestion / memory & disk exhaustion** | 512 KiB body cap (Content-Length required), ≤20 snapshots, bounded lists/strings, 20 req/min/agent, snapshots >24 h old dropped, retention + hourly rollups; agent queue bounded in memory with drop accounting; systemd `MemoryMax`, `CPUQuota` | `agents.test.ts` (413/400), Go queue test, retention test |
| **Malformed provider data** | Zod-free but defensive normalizers (type checks, length caps, URN regex), malformed lists abort sync without writes | `digitalocean.test.ts` |
| **Worker double-processing** | SKIP LOCKED leases, xact advisory locks, partial unique index on open incidents | scheduler tests |
| **Remote execution** | Not implemented anywhere: agent has no listener and no command channel; dashboard has no SSH or DO write calls | code review; `fake-do` rejects non-GET |
| **Audit tampering / missing audit** | Privileged changes write audit rows in the same transaction where applicable; audit readable by admins only | `connections.test.ts`, `agents.test.ts` |

## Known gaps / accepted risks
- `pnpm audit --prod` reports 1 high (`deepmerge-ts` via Prisma 6's CLI config loader, used only at build/migrate time) plus low/moderate transitive findings in build tooling. Re-check on each dependency update.
- `govulncheck` could not be executed in the build sandbox (vuln.go.dev blocked); it runs in CI (`agent.yml`).
- No MFA/SSO in v1. Mitigation: strong password policy (≥12 chars), rate limits, short invitation lifetime.
- Release signing is described (`release.sh` produces SHA256SUMS) but no signing key is configured in this repository.
