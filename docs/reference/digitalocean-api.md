# DigitalOcean API usage (Layer 1)

Nodexxa issues **GET requests only** to `https://api.digitalocean.com` (the base URL can be overridden only outside production, for the fake API used in CI). Pagination follows `links.pages.next` with `per_page=200`, but only on the API origin (a link to another host aborts the sync so the token is never sent elsewhere). Rate-limit headers `ratelimit-remaining` / `ratelimit-reset` are recorded; HTTP 429 schedules the next sync at the reset time; 5xx/network errors are retried twice with backoff, then the connection backs off exponentially (max 6 h).

## Recommended token
A **custom-scoped token with read scopes only**. Nodexxa never needs write scopes.

| Scope | Used for | If missing |
|---|---|---|
| `account:read` | Token validation and team identity (`team.uuid`, `team.name`) | Connection cannot be created |
| `droplet:read` | Droplet inventory | Droplets shown as "scope missing" |
| `project:read` | Projects and project membership | Projects not shown |
| `app:read` | App Platform apps and deployments | Apps not shown |
| `database:read` | Managed database metadata | Databases not shown |
| `monitoring:read` | Droplet metrics | Metrics shown as unavailable |

## Endpoints

| Endpoint | Fields kept (allow-list) | Never stored |
|---|---|---|
| `GET /v2/account` | `team.uuid`, `team.name`, `status` | email |
| `GET /v2/droplets` | id, name, status, region.slug, size_slug, tags, public/private IPv4, vcpus, memory, disk, image distro/name, vpc_uuid, features, created_at | user data, kernel, backups |
| `GET /v2/apps` | id, spec.name, component names/kinds (services/workers/static_sites/jobs/functions), active_deployment id+phase, live_url, region, tier, created_at | **spec env vars**, run commands, source repos |
| `GET /v2/apps/{id}/deployments?per_page=20` | id, phase, cause, progress steps, created/updated | logs, spec |
| `GET /v2/databases` | id, name, engine, version, status, region, size, num_nodes, tags, created_at | **connection, private_connection, users (credentials)** |
| `GET /v2/projects` | id, name, description, purpose, environment, is_default | — |
| `GET /v2/projects/{id}/resources` | URNs `do:droplet:*`, `do:app:*`, `do:dbaas:*` (others ignored) | — |
| `GET /v2/monitoring/metrics/droplet/{cpu,memory_total,memory_available,filesystem_free,filesystem_size,load_1}?host_id&start&end` | derived `cpu_pct`, `mem_pct`, `disk_pct` (mount `/`), `load1`, last 30 min per sync, max 50 droplets/sync | raw label sets |

Resource identity is `(connectionId, type, providerId)`: two teams with the same Droplet ID never collide (tested with deliberately colliding fixtures). Projects are many-to-many via `ProjectResource`.

## Not implemented (by design or not available read-only)
Write operations of any kind, Droplet actions, App deployments/rollbacks, console access, database connection details, load balancers/volumes/Kubernetes inventory (URNs are ignored), App Platform metrics/logs.
