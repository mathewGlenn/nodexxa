# Acceptance and production release criteria

## User journeys
1. Admin creates a workspace and connects two independent DO teams with least-privilege tokens; sees separately labeled resources and project grouping; duplicate provider resource IDs never collide.
2. Viewer can browse inventory but cannot read tokens, enroll agents, modify alert rules or access another workspace.
3. Invalid/revoked DO token shows connection error without disclosing token. Failed sync does not erase inventory and marks data stale.
4. Agent enrollment is one-time and expiring; duplicate/replay requests rejected; revocation stops ingestion. A host can safely be linked to a droplet by explicit operator approval, not solely inferred private IP.
5. Agent reports process status without exposing environment, command-line arguments, service credentials or Nginx private configuration.
6. External check fails and recovers; deduplicated alert and resolution generated; no false healthy when data absent.
7. UI theme Light/Dark/System works throughout reload, SSR navigation, tables, dialogs, charts and forms; preference persists without flash.
8. Schedulers avoid overlapping double-processing and have backoff/rate-limit handling.
9. Smoke test successful with demo fixtures, real Postgres migrations, validated Docker deployment and systemd agent install/restart (where supported).

## Required quality gates
- Typecheck, lint, unit tests, DB-backed integration tests, Go unit/race tests, ingestion security tests, Playwright main paths, production build, documented backup+restore drill and security review.
- CI runs relevant checks per changed paths, uses disposable DB and no production secrets.
- Vulnerability/dependency checks, threat model, data-retention and incident recovery documented.
- A passing CI pipeline is necessary but not sufficient for production: manual deployment staging smoke test and review of host permissions are required.
