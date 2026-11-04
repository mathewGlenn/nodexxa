import type { H3Event } from 'h3'
import { createError, deleteCookie, getCookie, getRouterParam, setCookie } from 'h3'
import type { Membership, Role, User } from '@prisma/client'
import { prisma } from './db'
import { env } from './env'
import { randomToken, sha256 } from './crypto'

export const SESSION_COOKIE = 'nx_session'
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000
const ROLE_RANK: Record<Role, number> = { VIEWER: 0, ADMIN: 1, OWNER: 2 }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SafeUser = Pick<User, 'id' | 'email' | 'name' | 'theme'>
export const toSafeUser = (u: User): SafeUser => ({ id: u.id, email: u.email, name: u.name, theme: u.theme })

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: env().NODEXXA_INSECURE_COOKIES !== 'true',
  path: '/',
})

export async function createSession(event: H3Event, userId: string) {
  const token = randomToken()
  await prisma.session.create({ data: { tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } })
  setCookie(event, SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS / 1000 })
}

export async function destroySession(event: H3Event) {
  const token = getCookie(event, SESSION_COOKIE)
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } })
  deleteCookie(event, SESSION_COOKIE, cookieOptions())
}

export async function getSessionUser(event: H3Event): Promise<User | null> {
  if (event.context.user !== undefined) return event.context.user
  const token = getCookie(event, SESSION_COOKIE)
  let user: User | null = null
  if (token && token.length < 200) {
    const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } })
    if (session && session.expiresAt > new Date() && !session.user.disabledAt) {
      user = session.user
      // Sliding expiry, written at most every 10 minutes.
      if (Date.now() - session.lastUsedAt.getTime() > 600_000) {
        await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } })
      }
    }
  }
  event.context.user = user
  return user
}

export async function requireUser(event: H3Event): Promise<User> {
  const user = await getSessionUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  return user
}

/**
 * Resolves the `ws` route param and verifies the caller's active membership with at least `minRole`.
 * Non-members get 404 so workspace existence is not disclosed.
 */
export async function requireMember(event: H3Event, minRole: Role = 'VIEWER'): Promise<{ user: User, membership: Membership, workspaceId: string }> {
  const user = await requireUser(event)
  const workspaceId = getRouterParam(event, 'ws') ?? ''
  if (!UUID_RE.test(workspaceId)) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  const membership = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId } } })
  if (!membership || membership.disabledAt) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) throw createError({ statusCode: 403, statusMessage: 'Insufficient role' })
  return { user, membership, workspaceId }
}

export const hasRole = (role: Role, minRole: Role) => ROLE_RANK[role] >= ROLE_RANK[minRole]

/** Validates a UUID route param (404 when malformed) so it is safe to use in queries. */
export function idParam(event: H3Event, name = 'id'): string {
  const value = getRouterParam(event, name) ?? ''
  if (!UUID_RE.test(value)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return value
}
