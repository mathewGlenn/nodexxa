import { createError, defineEventHandler, getRequestHeader, getRequestHost, setResponseHeader } from 'h3'
import { env } from '../utils/env'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence for cookie-authenticated mutations: the request must come from our own origin.
 * Session cookies are also SameSite=Strict. Agent endpoints use request signatures, not cookies.
 */
export default defineEventHandler((event) => {
  const path = event.path
  if (!path.startsWith('/api/')) return
  setResponseHeader(event, 'Cache-Control', 'no-store')
  if (SAFE_METHODS.has(event.method) || path.startsWith('/api/agent/')) return

  const origin = getRequestHeader(event, 'origin')
  const fetchSite = getRequestHeader(event, 'sec-fetch-site')
  const allowed = new Set<string>()
  const publicUrl = env().NODEXXA_PUBLIC_URL
  if (publicUrl) allowed.add(new URL(publicUrl).host)
  allowed.add(getRequestHost(event, { xForwardedHost: process.env.NODEXXA_TRUST_PROXY === 'true' }))

  let ok = false
  if (origin) {
    try { ok = allowed.has(new URL(origin).host) }
    catch { ok = false }
  }
  else {
    ok = fetchSite === 'same-origin'
  }
  if (!ok) throw createError({ statusCode: 403, statusMessage: 'Cross-site request rejected' })
})
