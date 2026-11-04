# Alerts, incidents and UI

Dashboard: overview across workspaces and DO connections; filter by client, project, region, status, agent enrollment; resource detail showing raw source and last updated. Distinguish unknown/stale/unsupported from healthy. Charts for sampled CPU, memory, disk, process restarts and external check latency where actual data exists; no fake production metrics.

Alert policies: heartbeat stale, host offline, PM2 process down/restart threshold, Docker unhealthy, disk/CPU threshold for sustained duration, HTTP check failing, TLS expiring, DO API auth failure. Implement hysteresis/duration, deduplication, cooldown, acknowledgment/resolution and on-call notification settings. Never automatically run repair commands. Optional email and Telegram connectors use credentials explicitly supplied; if missing, show disabled integration, still log incidents. Audit alert changes.

UX pages: Overview, Connections, Projects, Servers, Applications, Monitoring & Checks, Incidents, Agents, Team, Settings, Audit. Permission-sensitive settings. Useful empty/error/loading states and accessible charts/tables. Include source timestamps and absence-of-data warnings.
