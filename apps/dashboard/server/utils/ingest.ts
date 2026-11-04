import type { Agent, Prisma } from '@prisma/client'
import { prisma } from './db'
import { CLOCK_SKEW_SEC, type Snapshot, type TelemetryRequest } from './protocol'

const MAX_AGE_MS = 24 * 3600_000
const PSEUDO_FS = new Set(['tmpfs', 'devtmpfs', 'overlay', 'squashfs', 'proc', 'sysfs', 'cgroup', 'cgroup2', 'nsfs', 'ramfs', 'efivarfs'])

type Sample = Prisma.MetricSampleCreateManyInput

function snapshotMetrics(agent: Agent, snap: Snapshot, ts: Date): Sample[] {
  const out: Sample[] = []
  const add = (seriesKey: string, metric: string, value: number | null | undefined) => {
    if (typeof value === 'number' && Number.isFinite(value)) out.push({ workspaceId: agent.workspaceId, seriesKey, metric, ts, value: Math.round(value * 100) / 100, source: 'agent' })
  }
  const key = `agent:${agent.id}`
  const sys = snap.system
  if (sys) {
    add(key, 'cpu_pct', sys.cpuPercent)
    add(key, 'load1', sys.load1)
    if (sys.memTotalBytes > 0) add(key, 'mem_pct', 100 * (1 - Math.min(sys.memAvailableBytes, sys.memTotalBytes) / sys.memTotalBytes))
    const disks = sys.filesystems.filter(f => !PSEUDO_FS.has(f.fsType) && f.totalBytes > 0)
    if (disks.length) add(key, 'disk_pct', Math.max(...disks.map(f => 100 * Math.min(f.usedBytes, f.totalBytes) / f.totalBytes)))
  }
  if (snap.pm2?.status === 'ok') for (const p of snap.pm2.items) add(`${key}:pm2:${p.name}#${p.pmId}`, 'restarts', p.restarts)
  return out
}

/**
 * Stores a telemetry batch. Idempotent: metric samples are keyed by (series, metric, ts) and the
 * "current state" is only replaced by a snapshot newer than the stored one.
 */
export async function ingestTelemetry(agent: Agent, payload: TelemetryRequest) {
  const now = Date.now()
  const snaps = payload.snapshots
    .map(s => ({ s, ts: new Date(s.collectedAt) }))
    .filter(x => x.ts.getTime() <= now + CLOCK_SKEW_SEC * 1000 && x.ts.getTime() >= now - MAX_AGE_MS)
    .sort((a, b) => a.ts.getTime() - b.ts.getTime())

  const samples = snaps.flatMap(x => snapshotMetrics(agent, x.s, x.ts))
  const latest = snaps.at(-1)
  const isNewer = latest && (!agent.lastSnapshotAt || latest.ts > agent.lastSnapshotAt)

  await prisma.$transaction(async (tx) => {
    if (samples.length) await tx.metricSample.createMany({ data: samples, skipDuplicates: true })
    const data: Prisma.AgentUpdateInput = {
      agentVersion: payload.agentVersion,
      capabilities: payload.capabilities,
      agentHealth: payload.health as Prisma.InputJsonValue,
    }
    if (isNewer) {
      const snap = latest.s
      data.lastSnapshotAt = latest.ts
      if (snap.system) data.system = snap.system as Prisma.InputJsonValue
      data.collectors = {
        pm2: snap.pm2 ? { status: snap.pm2.status, error: snap.pm2.error ?? null } : null,
        docker: snap.docker ? { status: snap.docker.status, error: snap.docker.error ?? null } : null,
        systemd: snap.systemd ? { status: snap.systemd.status, error: snap.systemd.error ?? null } : null,
        nginx: snap.nginx ?? null,
      } as Prisma.InputJsonValue
      const groups: [string, { name: string, status: string, health?: string | null, restarts?: number | null, details?: object }[] | null][] = [
        ['pm2', snap.pm2?.status === 'ok' ? snap.pm2.items.map(p => ({ name: `${p.name}#${p.pmId}`, status: p.status, restarts: p.restarts, details: { cpuPercent: p.cpuPercent, memoryBytes: p.memoryBytes, uptimeSec: p.uptimeSec } })) : null],
        ['docker', snap.docker?.status === 'ok' ? snap.docker.items.map(c => ({ name: c.name, status: c.state, health: c.health, details: { id: c.id, image: c.image, status: c.status } })) : null],
        ['systemd', snap.systemd?.status === 'ok' ? snap.systemd.items.map(u => ({ name: u.name, status: u.activeState, details: { subState: u.subState } })) : null],
      ]
      for (const [kind, items] of groups) {
        if (!items) continue // collector failed: keep last known rows; UI marks them stale
        for (const it of items) {
          const row = { status: it.status, health: it.health ?? null, restarts: it.restarts ?? null, details: (it.details ?? {}) as Prisma.InputJsonValue, lastSeenAt: latest.ts }
          await tx.agentProcess.upsert({
            where: { agentId_kind_name: { agentId: agent.id, kind, name: it.name } },
            create: { agentId: agent.id, kind, name: it.name, ...row },
            update: row,
          })
        }
        await tx.agentProcess.deleteMany({ where: { agentId: agent.id, kind, name: { notIn: items.map(i => i.name) } } })
      }
    }
    await tx.agent.update({ where: { id: agent.id }, data })
  })
  return { accepted: snaps.length, dropped: payload.snapshots.length - snaps.length }
}
