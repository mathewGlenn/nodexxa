# Nodexxa Linux agent — install, update, rotate, uninstall

The agent is optional. It makes **outbound HTTPS requests only**, opens no port, and has no way to receive or run commands.

## Requirements and permissions
- Linux amd64 or arm64, systemd. Runs as the unprivileged `nodexxa-agent` user; **no sudo or capabilities** required.
- System metrics: world-readable `/proc` — no extra permissions.
- **PM2** is per-user: the agent sees the PM2 daemon of the user it runs as. To monitor an application user's PM2, run an additional instance as that user (own state dir and config with `"pm2Home": "/home/app/.pm2"`); a root/global PM2 list is not a reliable cross-user source.
- **Nginx**: read access to `/etc/nginx/sites-enabled` and `conf.d` (usually world-readable). Certificate expiry needs read access to the referenced certificate files (Let's Encrypt `live/` is root-only by default — grant group read to the `archive/*/fullchain*.pem` files if wanted). Only server names, listen directives and certificate subject/expiry are reported.
- **Docker (opt-in)**: requires access to `/var/run/docker.sock`, which is **root-equivalent**. Enable only if acceptable: set `"docker": true` and add a drop-in `systemctl edit nodexxa-agent` → `[Service]` `SupplementaryGroups=docker`. Only `GET /containers/json` is used.
- **systemd units**: list the allowed unit names in `systemdUnits`; nothing else is queried.

## Install (no `curl | bash`)
```bash
VERSION=0.1.0 ARCH=amd64   # or arm64
# Download nodexxa-agent_${VERSION}_linux_${ARCH}.tar.gz and SHA256SUMS (+ signature) from your release source, then:
sha256sum --ignore-missing -c SHA256SUMS            # must print OK
tar -xzf nodexxa-agent_${VERSION}_linux_${ARCH}.tar.gz
sudo install -m 0755 nodexxa-agent /usr/local/bin/nodexxa-agent
sudo useradd --system --home /var/lib/nodexxa-agent --shell /usr/sbin/nologin nodexxa-agent
sudo install -d -m 0700 -o nodexxa-agent -g nodexxa-agent /var/lib/nodexxa-agent
sudo install -d -m 0750 -o root -g nodexxa-agent /etc/nodexxa-agent
sudo install -m 0640 -o root -g nodexxa-agent config.example.json /etc/nodexxa-agent/config.json   # edit collectors
```
Enroll with the one-time token from **Agents → Enroll agent** (token via env or stdin, never argv):
```bash
sudo -u nodexxa-agent NODEXXA_ENROLLMENT_TOKEN='<token>' /usr/local/bin/nodexxa-agent enroll \
  --server https://nodexxa.example.internal --config /etc/nodexxa-agent/config.json
sudo install -m 0644 nodexxa-agent.service /etc/systemd/system/nodexxa-agent.service
sudo systemctl daemon-reload && sudo systemctl enable --now nodexxa-agent
```
The agent generates an Ed25519 key locally (`/var/lib/nodexxa-agent/agent.key`, mode 0600); only the public key is sent. A private CA can be configured with `"caFile"`.

Then, in the dashboard, optionally **link the agent to its Droplet** (explicit admin action).

## Update / rollback
Verify the new archive's checksum, replace `/usr/local/bin/nodexxa-agent`, `sudo systemctl restart nodexxa-agent`. Rollback = reinstall the previous binary. State and identity are preserved.

## Rotate the agent credential
`sudo -u nodexxa-agent nodexxa-agent rotate-key --config /etc/nodexxa-agent/config.json` (new key proven to the server before it replaces the old one), then `sudo systemctl restart nodexxa-agent`.

## Revoke / uninstall
Revoke in the dashboard (takes effect immediately), then on the host:
```bash
sudo systemctl disable --now nodexxa-agent
sudo rm -f /etc/systemd/system/nodexxa-agent.service /usr/local/bin/nodexxa-agent
sudo rm -rf /var/lib/nodexxa-agent /etc/nodexxa-agent
sudo userdel nodexxa-agent
```

## Resource bounds and hardening
The unit sets `CPUQuota=10%`, `MemoryMax=96M`, `TasksMax=32`, `ProtectSystem=strict`, `NoNewPrivileges`, empty capability set, restricted address families and syscall filter (`systemd-analyze security` exposure 1.8 "OK"). The in-memory queue is bounded (`queueMax`, default 120 snapshots) with drop accounting; nothing grows on disk besides two tiny state files.
