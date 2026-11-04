/**
 * Nodexxa background worker — a separate process from the Nuxt HTTP server.
 * Runs DO discovery, uptime checks, alert evaluation, notification delivery and retention.
 * Safe to run several replicas: work items are leased (SKIP LOCKED) and singleton tasks take advisory locks.
 */
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { prisma } from '../server/utils/db'
import { env } from '../server/utils/env'
import { syncConnection } from '../server/utils/sync'
import { runCheck } from '../server/utils/checks'
import { evaluateAllRules } from '../server/utils/alerts'
import { deliverPending } from '../server/utils/notify'
import { runRetention } from '../server/utils/retention'
import { claimDueChecks, claimDueConnections, recordHeartbeat, releaseConnection, withSingletonLock } from '../server/utils/scheduler'

const owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
const SYNC_CONCURRENCY = 2
const CHECK_CONCURRENCY = 8
const LOCK_ALERTS = 7_301
const LOCK_RETENTION = 7_302
let stopping = false

const log = (msg: string, extra?: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), worker: owner, msg, ...extra }))

async function task(name: string, fn: () => Promise<unknown>) {
  try {
    const result = await fn()
    await recordHeartbeat(name)
    return result
  }
  catch (e) {
    log('task failed', { task: name, error: (e as Error).message?.slice(0, 200) })
    await recordHeartbeat(name, (e as Error).message?.slice(0, 200)).catch(() => {})
  }
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item)
  }))
}

async function syncTick() {
  const ids = await claimDueConnections(owner, SYNC_CONCURRENCY * 2)
  await pool(ids, SYNC_CONCURRENCY, async (id) => {
    try {
      const r = await syncConnection(id)
      log('connection synced', { connectionId: id, ok: r.ok, ...(r.ok ? {} : { kind: r.kind }) })
    }
    finally { await releaseConnection(id, owner) }
  })
}

async function checkTick() {
  const ids = await claimDueChecks(owner, CHECK_CONCURRENCY * 4)
  await pool(ids, CHECK_CONCURRENCY, id => runCheck(id))
}

const every = (ms: number) => { let last = 0; return () => { if (Date.now() - last < ms) return false; last = Date.now(); return true } }
const dueAlerts = every(20_000)
const dueRetention = every(3600_000)

async function loop() {
  env() // fail fast on invalid configuration
  await prisma.$queryRaw`SELECT 1`
  log('worker started')
  while (!stopping) {
    await Promise.all([
      task('sync', syncTick),
      task('checks', checkTick),
      task('notifications', () => deliverPending()),
    ])
    if (dueAlerts()) await task('alerts', () => withSingletonLock(LOCK_ALERTS, () => evaluateAllRules()))
    if (dueRetention()) await task('retention', () => withSingletonLock(LOCK_RETENTION, async () => log('retention', await runRetention())))
    await new Promise(r => setTimeout(r, 5000))
  }
  await prisma.$disconnect()
  log('worker stopped')
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopping = true })
loop().catch((e) => {
  log('worker crashed', { error: (e as Error).message })
  process.exit(1)
})
