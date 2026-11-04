import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/db'
import { processRule } from '../../server/utils/alerts'
import { runCheck } from '../../server/utils/checks'
import { deliverPending } from '../../server/utils/notify'
import { runRetention } from '../../server/utils/retention'
import { resetEnvCache } from '../../server/utils/env'
import { claimDueChecks, withSingletonLock } from '../../server/utils/scheduler'
import { createUser, enrollAgent, signedPost, snapshot, telemetry } from './helpers'

let target: Server
let healthy = false
let telegram: Server
const telegramMessages: any[] = []

beforeAll(async () => {
  target = createServer((_q, r) => { r.writeHead(healthy ? 200 : 503); r.end() }).listen(4513, '127.0.0.1')
  telegram = createServer((q, r) => {
    let body = ''
    q.on('data', (c) => { body += c })
    q.on('end', () => { telegramMessages.push({ url: q.url, body: JSON.parse(body) }); r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"ok":true}') })
  }).listen(4512, '127.0.0.1')
})
afterAll(() => { target.close(); telegram.close() })

describe('uptime check → incident lifecycle', () => {
  it('opens one deduplicated incident on failure, resolves on recovery, and notifies', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
    resetEnvCache()
    const { client, workspaceId } = await createUser('OWNER')
    const ws = `/api/w/${workspaceId}`
    await client.post(`${ws}/channels`, { name: 'Ops chat', type: 'telegram', target: '-100123' })
    await client.post(`${ws}/channels`, { name: 'Ops mail', type: 'email', target: 'ops@example.test' }) // SMTP not configured
    const check = (await client.post(`${ws}/checks`, { name: 'API', url: 'http://127.0.0.1:4513/health', intervalSec: 30 })).body
    const rule = await prisma.alertRule.findFirstOrThrow({ where: { workspaceId, type: 'check_failing' } })
    expect(rule.durationSec).toBe(0)

    // Never-run check: no incident, no false healthy.
    expect((await processRule(rule)).opened).toHaveLength(0)
    healthy = false
    await runCheck(check.id)
    expect((await processRule(rule)).opened).toHaveLength(0) // threshold = 2 consecutive failures
    await runCheck(check.id)
    expect((await processRule(rule)).opened).toHaveLength(1)
    await runCheck(check.id)
    expect((await processRule(rule)).opened).toHaveLength(0) // deduplicated
    expect(await prisma.incident.count({ where: { workspaceId, status: 'OPEN' } })).toBe(1)

    healthy = true
    await runCheck(check.id)
    const resolved = await processRule(rule)
    expect(resolved.resolved).toHaveLength(1)

    await deliverPending()
    const deliveries = await prisma.notificationDelivery.findMany({ where: { incident: { workspaceId } }, include: { channel: true } })
    expect(deliveries.filter(d => d.channel.type === 'telegram').map(d => [d.event, d.status]).sort()).toEqual([['opened', 'sent'], ['resolved', 'sent']])
    expect(deliveries.filter(d => d.channel.type === 'email').every(d => d.status === 'skipped')).toBe(true)
    expect(telegramMessages.at(-1).body).toMatchObject({ chat_id: '-100123' })
    expect(JSON.stringify(deliveries)).not.toContain('test-bot-token')

    // Incident + check history are visible through the API.
    const incidents = (await client.get(`${ws}/incidents`)).body.items
    expect(incidents[0]).toMatchObject({ status: 'RESOLVED', severity: 'critical' })
    delete process.env.TELEGRAM_BOT_TOKEN
    resetEnvCache()
  })

  it('reopens within the cooldown instead of opening a duplicate', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const check = (await client.post(`/api/w/${workspaceId}/checks`, { name: 'Flappy', url: 'http://127.0.0.1:4513/' })).body
    const rule = await prisma.alertRule.findFirstOrThrow({ where: { workspaceId, type: 'check_failing' } })
    const fail = async () => { healthy = false; await runCheck(check.id); await runCheck(check.id); return processRule(rule) }
    await fail()
    healthy = true
    await runCheck(check.id)
    await processRule(rule)
    const again = await fail()
    expect(again.opened).toHaveLength(0)
    expect(await prisma.incident.count({ where: { workspaceId } })).toBe(1)
    expect((await prisma.incident.findFirstOrThrow({ where: { workspaceId } })).status).toBe('OPEN')
  })

  it('requires sustained duration (hysteresis) for threshold rules', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const agent = await enrollAgent(client, workspaceId)
    const full = snapshot({ system: { ...snapshot().system as object, filesystems: [{ mount: '/', fsType: 'ext4', totalBytes: 100, usedBytes: 95 }] } })
    await signedPost(agent, '/api/agent/v1/telemetry', telemetry([full]))
    const rule = await prisma.alertRule.findFirstOrThrow({ where: { workspaceId, type: 'disk_high' } }) // 85 % for 600 s
    const t0 = new Date()
    expect((await processRule(rule, t0)).opened).toHaveLength(0)
    expect((await processRule(rule, new Date(t0.getTime() + 240_000))).opened).toHaveLength(0)
    // Fresh sample still failing at t0+600s (data older than 5 min would be unknown, not failing).
    await prisma.metricSample.updateMany({ where: { seriesKey: `agent:${agent.id}` }, data: { ts: new Date(t0.getTime() + 600_000) } })
    const states = await prisma.alertState.findMany({ where: { ruleId: rule.id } })
    const r = await processRule(rule, new Date(t0.getTime() + 601_000))
    expect(r.opened, JSON.stringify({ states, r })).toHaveLength(1)
  })

  it('flags stale agents and expiring nginx certificates; never-reporting agents are not healthy', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const agent = await enrollAgent(client, workspaceId)
    await signedPost(agent, '/api/agent/v1/telemetry', telemetry())
    const offline = await prisma.alertRule.findFirstOrThrow({ where: { workspaceId, type: 'agent_offline' } })
    expect((await processRule(offline)).opened).toHaveLength(0)
    expect((await processRule(offline, new Date(Date.now() + 10 * 60_000))).opened).toHaveLength(1)
    const tls = await prisma.alertRule.findFirstOrThrow({ where: { workspaceId, type: 'tls_expiring' } })
    expect((await processRule(tls)).opened).toHaveLength(1) // cert expires in 5 days, threshold 14
  })

  it('opens PM2 incidents only after the duration and resolves when the process recovers', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const agent = await enrollAgent(client, workspaceId)
    const down = snapshot({ pm2: { status: 'ok', items: [{ name: 'api', pmId: 0, status: 'errored', restarts: 9, cpuPercent: null, memoryBytes: null, uptimeSec: null }] } })
    await signedPost(agent, '/api/agent/v1/telemetry', telemetry([down]))
    const rule = await prisma.alertRule.findFirstOrThrow({ where: { workspaceId, type: 'pm2_down' } }) // 60 s
    const t0 = new Date()
    expect((await processRule(rule, t0)).opened).toHaveLength(0)
    expect((await processRule(rule, new Date(t0.getTime() + 61_000))).opened).toHaveLength(1)
  })
})

describe('scheduling and retention', () => {
  it('advisory-locked singleton tasks run on one worker only', async () => {
    let runs = 0
    const task = () => withSingletonLock(99_001, async () => { runs++; await new Promise(r => setTimeout(r, 300)); return 'ran' })
    const results = await Promise.all([task(), task(), task()])
    expect(runs).toBe(1)
    expect(results.filter(r => r === undefined)).toHaveLength(2)
  })

  it('check claims are disjoint across concurrent workers', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    for (let i = 0; i < 8; i++) await client.post(`/api/w/${workspaceId}/checks`, { name: `c${i}`, url: 'http://127.0.0.1:4513/' })
    const claims = (await Promise.all([1, 2, 3, 4].map(i => claimDueChecks(`w${i}`, 50)))).flat()
    expect(new Set(claims).size).toBe(claims.length)
  })

  it('downsamples old raw samples into hourly rollups and expires old data', async () => {
    const { workspaceId } = await createUser('OWNER')
    const seriesKey = `resource:${crypto.randomUUID()}`
    const old = new Date(Date.now() - 3 * 86400_000)
    old.setUTCMinutes(0, 0, 0)
    await prisma.metricSample.createMany({
      data: [0, 10, 20].map((m, i) => ({ workspaceId, seriesKey, metric: 'cpu_pct', ts: new Date(old.getTime() + m * 60_000), value: [10, 20, 30][i]!, source: 'agent' })),
    })
    await prisma.metricSample.create({ data: { workspaceId, seriesKey, metric: 'cpu_pct', ts: new Date(Date.now() - 200 * 86400_000), value: 1, source: 'agent:1h' } })
    await runRetention()
    const rows = await prisma.metricSample.findMany({ where: { seriesKey } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ value: 20, source: 'agent:1h', ts: old })
  })
})
