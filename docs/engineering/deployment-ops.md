# Deployment, operations and release

Central: Docker Compose for dashboard, worker and PostgreSQL (or external Postgres); TLS reverse proxy guidance and headers; secure secret injection; non-root containers; health and readiness; safe migrations; backup retention, restore drill; time-series retention jobs and resource quotas. No exposure of DB or workers publicly. No plaintext credentials in Compose.

Agent: build signed/checksummed Linux amd64/arm64 releases; versioned install procedure, explicit binary integrity verification, least-privilege user, root-protected credentials, systemd hardening and resource bounds; service restart on failure; upgrade/rollback and uninstall path. Collector flags must be explicit, Docker access opt-in with root-equivalent warning. Agents only make outgoing HTTPS connections. Central control panel cannot SSH into droplets or invoke arbitrary commands.

Release: CI must pass, staging connected to test/authorized DO account, agent installed on non-production host and verified, security checklist completed, backup restore verified, production rollout procedure documented. No automated production deployment without user permission.
