import type { AlertRule, Prisma } from '@prisma/client'
import { prisma } from './db'
import { AGENT_STALE_MS, isProcessHealthy } from './views'

export interface Finding { key: string, subjectType: string, subjectId: string, title: string, details?: string, failing: boolean }

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const DEFAULT_THRESHOLDS: Record<string, number> = {
  agent_offline: 180, pm2_restarts: 5, cpu_high: 90, memory_high: 90, disk_high: 85, check_failing: 2, tls_expiring: 14,
}
export const ruleThreshold = (rule: Pick<AlertRule, 'type' | 'params'>) => num((rule.params as any)?.threshold, DEFAULT_THRESHOLDS[rule.type] ?? 0)

export const defaultAlertRules = (workspaceId: string): Prisma.AlertRuleCreateManyInput[] => [
  { workspaceId, name: 'Agent heartbeat stale', type: 'agent_offline', params: { threshold: 180 }, severity: 'critical' },
  { workspaceId, name: 'Uptime check failing', type: 'check_failing', params: { threshold: 2 }, severity: 'critical' },
  { workspaceId, name: 'TLS certificate expiring', type: 'tls_expiring', params: { threshold: 14 }, severity: 'warning', cooldownSec: 86400 },
  { workspaceId, name: 'Disk usage high', type: 'disk_high', params: { threshold: 85 }, durationSec: 600, severity: 'warning' },
  { workspaceId, name: 'PM2 process down', type: 'pm2_down', params: {}, durationSec: 60, severity: 'critical' },
  { workspaceId, name: 'DigitalOcean connection failing', type: 'do_connection_error', params: {}, severity: 'warning' },
]

async function latestValues(workspaceId: string, metric: string, prefix: 'agent' | 'resource', since: Date) {
  // Latest sample per series for the metric within the freshness window.
  const rows = await prisma.$queryRaw<{ seriesKey: string, value: number }[]>`
    SELECT DISTINCT ON ("seriesKey") "seriesKey", "value" FROM "MetricSample"
    WHERE "workspaceId" = ${workspaceId} AND "metric" = ${metric} AND "ts" >= ${since}
      AND "seriesKey" LIKE ${`${prefix}:%`} AND "seriesKey" NOT LIKE ${`${prefix}:%:%`}
    ORDER BY "seriesKey", "ts" DESC`
  return rows
}

/** Computes the current condition for every subject a rule applies to. */
export async function evaluateRule(rule: AlertRule, now = new Date()): Promise<Finding[]> {
  const ws = rule.workspaceId
  const threshold = ruleThreshold(rule)
  const activeAgents = { workspaceId: ws, status: 'ACTIVE' as const }
  const fresh = (d: Date | null) => !!d && now.getTime() - d.getTime() <= AGENT_STALE_MS

  switch (rule.type) {
    case 'agent_offline': {
      const agents = await prisma.agent.findMany({ where: activeAgents, select: { id: true, hostname: true, lastSeenAt: true, enrolledAt: true } })
      return agents.map((a) => {
        const seen = a.lastSeenAt ?? a.enrolledAt
        const failing = now.getTime() - seen.getTime() > threshold * 1000
        return { key: `agent:${a.id}`, subjectType: 'agent', subjectId: a.id, failing, title: `Agent ${a.hostname} has not reported for over ${threshold}s`, details: a.lastSeenAt ? `Last seen ${a.lastSeenAt.toISOString()}` : 'Never reported since enrollment' }
      })
    }
    case 'droplet_inactive': {
      const droplets = await prisma.resource.findMany({ where: { workspaceId: ws, type: 'droplet', missingSince: null }, select: { id: true, name: true, status: true } })
      return droplets.map(d => ({ key: `resource:${d.id}`, subjectType: 'resource', subjectId: d.id, failing: d.status !== 'active', title: `Droplet ${d.name} is ${d.status ?? 'in unknown state'}` }))
    }
    case 'pm2_down':
    case 'docker_unhealthy': {
      const kind = rule.type === 'pm2_down' ? 'pm2' : 'docker'
      // Only processes from agents that are currently reporting; stale agents are covered by agent_offline.
      const procs = await prisma.agentProcess.findMany({ where: { kind, agent: activeAgents }, include: { agent: { select: { hostname: true, lastSeenAt: true } } } })
      return procs.filter(p => fresh(p.agent.lastSeenAt)).map(p => ({
        key: `process:${p.id}`, subjectType: 'process', subjectId: p.id, failing: !isProcessHealthy(p),
        title: `${kind === 'pm2' ? 'PM2 process' : 'Container'} ${p.name} on ${p.agent.hostname} is ${p.health === 'unhealthy' ? 'unhealthy' : p.status}`,
      }))
    }
    case 'pm2_restarts': {
      const windowSec = rule.durationSec || 900
      const rows = await prisma.$queryRaw<{ seriesKey: string, delta: number }[]>`
        SELECT "seriesKey", max("value") - min("value") AS delta FROM "MetricSample"
        WHERE "workspaceId" = ${ws} AND "metric" = 'restarts' AND "ts" >= ${new Date(now.getTime() - windowSec * 1000)}
        GROUP BY "seriesKey"`
      return rows.map((r) => {
        const [, agentId, , proc] = r.seriesKey.split(':')
        return { key: r.seriesKey, subjectType: 'agent', subjectId: agentId!, failing: r.delta >= threshold, title: `PM2 process ${proc} restarted ${r.delta} times in ${Math.round(windowSec / 60)} min` }
      })
    }
    case 'cpu_high':
    case 'memory_high':
    case 'disk_high': {
      const metric = { cpu_high: 'cpu_pct', memory_high: 'mem_pct', disk_high: 'disk_pct' }[rule.type]
      const label = { cpu_high: 'CPU', memory_high: 'Memory', disk_high: 'Disk' }[rule.type]
      const [agentRows, dropletRows] = await Promise.all([
        latestValues(ws, metric, 'agent', new Date(now.getTime() - 5 * 60_000)),
        latestValues(ws, metric, 'resource', new Date(now.getTime() - 20 * 60_000)),
      ])
      return [...agentRows, ...dropletRows].map((r) => {
        const [type, id] = r.seriesKey.split(':')
        return { key: r.seriesKey, subjectType: type === 'agent' ? 'agent' : 'resource', subjectId: id!, failing: r.value >= threshold, title: `${label} usage ${r.value.toFixed(1)}% ≥ ${threshold}% (${type === 'agent' ? 'agent' : 'DigitalOcean'} metrics)` }
      })
    }
    case 'check_failing': {
      const checks = await prisma.check.findMany({ where: { workspaceId: ws, enabled: true, lastCheckedAt: { not: null } } })
      return checks.map(c => ({ key: `check:${c.id}`, subjectType: 'check', subjectId: c.id, failing: c.consecutiveFailures >= threshold, title: `Check ${c.name} is failing`, details: c.lastError ?? undefined }))
    }
    case 'tls_expiring': {
      const checks = await prisma.check.findMany({ where: { workspaceId: ws, enabled: true, tlsExpiresAt: { not: null } } })
      const out: Finding[] = checks.map((c) => {
        const days = (c.tlsExpiresAt!.getTime() - now.getTime()) / 86400_000
        return { key: `check:${c.id}:tls`, subjectType: 'check', subjectId: c.id, failing: days <= threshold, title: `TLS certificate for ${c.name} expires in ${Math.max(0, Math.floor(days))} days` }
      })
      const agents = await prisma.agent.findMany({ where: activeAgents, select: { id: true, hostname: true, collectors: true } })
      for (const a of agents) {
        for (const cert of ((a.collectors as any)?.nginx?.certificates ?? []) as { subject: string, notAfter: string }[]) {
          const days = (new Date(cert.notAfter).getTime() - now.getTime()) / 86400_000
          out.push({ key: `agent:${a.id}:cert:${cert.subject}`, subjectType: 'agent', subjectId: a.id, failing: days <= threshold, title: `Nginx certificate ${cert.subject} on ${a.hostname} expires in ${Math.max(0, Math.floor(days))} days` })
        }
      }
      return out
    }
    case 'do_connection_error': {
      const conns = await prisma.connection.findMany({ where: { workspaceId: ws, enabled: true } })
      return conns.map(c => ({
        key: `connection:${c.id}`, subjectType: 'connection', subjectId: c.id,
        failing: c.status === 'AUTH_ERROR' || c.status === 'ERROR', title: `DigitalOcean connection ${c.label}: ${c.status === 'AUTH_ERROR' ? 'authentication failed' : 'sync failing'}`, details: c.lastError ?? undefined,
      }))
    }
    default:
      return []
  }
}

async function enqueueNotifications(tx: Prisma.TransactionClient, workspaceId: string, incidentId: string, event: 'opened' | 'resolved') {
  const channels = await tx.notificationChannel.findMany({ where: { workspaceId, enabled: true }, select: { id: true } })
  if (channels.length) await tx.notificationDelivery.createMany({ data: channels.map(c => ({ incidentId, channelId: c.id, event })), skipDuplicates: true })
}

/** Applies duration (pending), hysteresis (recovery), dedup and cooldown semantics for one rule. */
export async function processRule(rule: AlertRule, now = new Date()) {
  const findings = await evaluateRule(rule, now)
  const recoverMs = Math.min(rule.durationSec, 600) * 1000
  const states = new Map((await prisma.alertState.findMany({ where: { ruleId: rule.id } })).map(s => [s.subjectKey, s]))
  const open = new Map((await prisma.incident.findMany({ where: { ruleId: rule.id, status: { not: 'RESOLVED' } } })).map(i => [i.dedupKey, i]))
  const opened: string[] = []
  const resolved: string[] = []

  for (const f of findings) {
    const dedupKey = `${rule.id}:${f.key}`
    const state = states.get(f.key)
    const incident = open.get(dedupKey)
    open.delete(dedupKey)
    if (f.failing) {
      const failingSince = state?.failingSince ?? now
      await prisma.alertState.upsert({ where: { ruleId_subjectKey: { ruleId: rule.id, subjectKey: f.key } }, create: { ruleId: rule.id, subjectKey: f.key, failingSince }, update: { failingSince, okSince: null } })
      if (incident) {
        await prisma.incident.update({ where: { id: incident.id }, data: { lastEvaluatedAt: now, title: f.title, details: f.details } })
      }
      else if (now.getTime() - failingSince.getTime() >= rule.durationSec * 1000) {
        await prisma.$transaction(async (tx) => {
          // Cooldown: a recently resolved incident for the same subject is reopened (no new notification).
          const recent = await tx.incident.findFirst({ where: { dedupKey, status: 'RESOLVED', resolvedAt: { gte: new Date(now.getTime() - rule.cooldownSec * 1000) } }, orderBy: { resolvedAt: 'desc' } })
          if (recent) {
            await tx.incident.update({ where: { id: recent.id }, data: { status: 'OPEN', resolvedAt: null, lastEvaluatedAt: now, title: f.title, details: f.details } })
            return
          }
          const inc = await tx.incident.create({
            data: { workspaceId: rule.workspaceId, ruleId: rule.id, dedupKey, subjectType: f.subjectType, subjectId: f.subjectId, title: f.title, details: f.details, severity: rule.severity, openedAt: now, lastEvaluatedAt: now },
          })
          await enqueueNotifications(tx, rule.workspaceId, inc.id, 'opened')
          opened.push(inc.id)
        })
      }
    }
    else {
      const okSince = state?.okSince ?? now
      if (incident && now.getTime() - okSince.getTime() >= recoverMs) {
        await resolveIncident(incident.id, rule.workspaceId, now)
        resolved.push(incident.id)
        await prisma.alertState.deleteMany({ where: { ruleId: rule.id, subjectKey: f.key } })
      }
      else if (incident || state) {
        await prisma.alertState.upsert({ where: { ruleId_subjectKey: { ruleId: rule.id, subjectKey: f.key } }, create: { ruleId: rule.id, subjectKey: f.key, okSince }, update: { failingSince: null, okSince } })
      }
    }
  }
  // Subjects that no longer exist (deleted check, removed process): resolve and forget.
  for (const inc of open.values()) { await resolveIncident(inc.id, rule.workspaceId, now, 'Subject no longer present'); resolved.push(inc.id) }
  const keys = findings.map(f => f.key)
  await prisma.alertState.deleteMany({ where: { ruleId: rule.id, subjectKey: { notIn: keys } } })
  return { evaluated: findings.length, opened, resolved }
}

export async function resolveIncident(id: string, workspaceId: string, now = new Date(), note?: string) {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.incident.updateMany({ where: { id, status: { not: 'RESOLVED' } }, data: { status: 'RESOLVED', resolvedAt: now, ...(note ? { details: note } : {}) } })
    if (count) await enqueueNotifications(tx, workspaceId, id, 'resolved')
  })
}

export async function evaluateAllRules(now = new Date()) {
  const rules = await prisma.alertRule.findMany({ where: { enabled: true } })
  let opened = 0
  let resolved = 0
  for (const rule of rules) {
    try {
      const r = await processRule(rule, now)
      opened += r.opened.length
      resolved += r.resolved.length
    }
    catch (e) {
      console.error('[alerts] rule evaluation failed', rule.id, (e as Error).message)
    }
  }
  return { rules: rules.length, opened, resolved }
}
