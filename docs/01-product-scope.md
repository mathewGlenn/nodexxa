# Product scope

## Users
GoFurther operators managing infrastructure across multiple company-owned and client-owned DigitalOcean teams/accounts with explicit authorization. Provide internal organization/workspace membership and per-connection permissions; no multi-tenant SaaS billing.

## Outcomes
- One dashboard for DO teams, projects, droplets, App Platform apps and managed DB resources when permitted by token scopes.
- Multiple independent DigitalOcean team connections, each labeled and isolated. A DO **project** is a grouping within a team; do not assume one token per project.
- Unified inventory per connection, project, environment/client tag, resource and application.
- DO resource metrics where supported/available and read-only App Platform deployment history; show data source and timestamps.
- Optional agent integration to monitor host CPU, RAM, disk, load, PM2 process states/restarts, Docker container states, Nginx basic service/site information, systemd services allowlisted by operator.
- External HTTP uptime and certificate-expiry monitoring, incidents, notification channels, data retention, historical charts and alert acknowledgment.
- Light / Dark / System theme.

## Explicit out-of-scope v1
- Remote SSH/shell, arbitrary command execution, restarting processes, write-scoped DigitalOcean operations, deployments/rollbacks, server configuration editing.
- Building a general full-text log analytics engine, long-term high-cardinality APM/tracing, public multi-tenant SaaS billing, unsupported cloud-provider integrations.
- Credentials or privileged enrollment inserted into GitHub repository or application source.

## Reliability semantics
Differentiate healthy, degraded, unreachable, stale/unknown and not-supported. Never infer a host is healthy from absence of errors. A server can be healthy while one of its PM2 apps is unhealthy. Missing telemetry is unknown, not zero.

## UX
Connections, inventory, server detail, app/process detail, incidents, checks, teams/permissions, integrations, settings, enrollment wizard, retention and monitoring source labels.
