import { prisma } from './db'

/**
 * Leases due rows so concurrent workers never process the same item:
 * FOR UPDATE SKIP LOCKED + an expiring lease (recovers from crashed workers).
 */
export async function claimDueConnections(owner: string, limit: number, leaseSec = 600) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Connection" SET "leaseOwner" = ${owner}, "leaseUntil" = now() + make_interval(secs => ${leaseSec})
    WHERE "id" IN (
      SELECT "id" FROM "Connection"
      WHERE "enabled" AND "nextSyncAt" <= now() AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
      ORDER BY "nextSyncAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING "id"`
  return rows.map(r => r.id)
}

export async function releaseConnection(id: string, owner: string) {
  await prisma.connection.updateMany({ where: { id, leaseOwner: owner }, data: { leaseOwner: null, leaseUntil: null } })
}

export async function claimDueChecks(owner: string, limit: number, leaseSec = 120) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Check" SET "leaseOwner" = ${owner}, "leaseUntil" = now() + make_interval(secs => ${leaseSec})
    WHERE "id" IN (
      SELECT "id" FROM "Check"
      WHERE "enabled" AND "nextRunAt" <= now() AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
      ORDER BY "nextRunAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING "id"`
  return rows.map(r => r.id)
}

/**
 * Runs `fn` only if this process wins a transaction-scoped advisory lock for `key`
 * (singleton tasks such as alert evaluation and retention). Returns undefined when skipped.
 */
export async function withSingletonLock<T>(key: number, fn: () => Promise<T>, timeoutMs = 10 * 60_000): Promise<T | undefined> {
  // The lock lives in a dedicated transaction (one pooled connection) and is released when it ends,
  // so it can never leak onto another pooled connection. `fn` uses the normal client.
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${key}) AS locked`
    if (!row?.locked) return undefined
    return fn()
  }, { timeout: timeoutMs, maxWait: 10_000 })
}

export async function recordHeartbeat(task: string, error?: string) {
  await prisma.workerHeartbeat.upsert({
    where: { id: task },
    create: { id: task, task, lastRunAt: new Date(), lastError: error ?? null },
    update: { lastRunAt: new Date(), lastError: error ?? null },
  })
}
