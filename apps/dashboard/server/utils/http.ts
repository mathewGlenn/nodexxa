import type { H3Event } from 'h3'
import { createError, getQuery, getRequestIP, readBody } from 'h3'
import type { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from './db'

/** Parses a JSON body with a Zod schema. Errors list field paths/messages only, never echo input. */
export async function parseBody<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.infer<T>> {
  const body = await readBody(event).catch(() => undefined)
  return validate(schema, body)
}

export function parseQuery<T extends z.ZodType>(event: H3Event, schema: T): z.infer<T> {
  return validate(schema, getQuery(event))
}

function validate<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request',
      data: { issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
    })
  }
  return result.data
}

export const clientIp = (event: H3Event) => getRequestIP(event, { xForwardedFor: process.env.NODEXXA_TRUST_PROXY === 'true' }) ?? 'unknown'

/**
 * Fixed-window rate limiter stored in Postgres so limits hold across app instances.
 * Returns true when the request is allowed.
 */
export async function hitRateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}) THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}) THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count"`
  return (rows[0]?.count ?? 0) <= limit
}

export async function enforceRateLimit(key: string, limit: number, windowSec: number) {
  if (!(await hitRateLimit(key, limit, windowSec))) {
    throw createError({ statusCode: 429, statusMessage: 'Too many requests' })
  }
}

interface AuditInput {
  workspaceId?: string | null
  actor: { id: string, email: string } | string
  action: string
  targetType?: string
  targetId?: string
  details?: Record<string, unknown>
}

export async function audit(input: AuditInput, tx: Prisma.TransactionClient = prisma) {
  await tx.auditLog.create({
    data: {
      workspaceId: input.workspaceId ?? null,
      actorUserId: typeof input.actor === 'string' ? null : input.actor.id,
      actorLabel: typeof input.actor === 'string' ? input.actor : input.actor.email,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      details: (input.details ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  })
}

export function notFound(what = 'Not found'): never {
  throw createError({ statusCode: 404, statusMessage: what })
}

export const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
