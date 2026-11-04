import { BlockList, isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import type { TLSSocket } from 'node:tls'
import { env } from './env'

// Destinations an uptime check may never reach: loopback, private, CGNAT, link-local (incl. cloud
// metadata 169.254.169.254), multicast, reserved, documentation, and IPv6 equivalents. IPv6 forms
// that embed IPv4 (mapped, NAT64, 6to4, Teredo) are refused outright.
const blockList = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockList.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blockList.addSubnet(net, prefix, 'ipv6')

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 0) return true
  return blockList.check(ip, family === 4 ? 'ipv4' : 'ipv6')
}

const allowPrivate = () => env().NODEXXA_CHECKS_ALLOW_PRIVATE === 'true'

export class ProbeError extends Error {}

/** Resolves a hostname and refuses it if ANY returned address is disallowed (defeats mixed answers). */
export async function resolveSafe(hostname: string): Promise<{ address: string, family: 4 | 6 }> {
  const host = hostname.replace(/^\[|\]$/g, '')
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.internal') || lower.endsWith('.local')) {
    if (!allowPrivate()) throw new ProbeError('Destination host is not allowed')
  }
  const literal = isIP(host)
  const addrs = literal ? [{ address: host, family: literal }] : await dnsLookup(host, { all: true, verbatim: true }).catch(() => { throw new ProbeError('DNS resolution failed') })
  if (!addrs.length) throw new ProbeError('DNS resolution returned no addresses')
  if (!allowPrivate() && addrs.some(a => isBlockedAddress(a.address))) throw new ProbeError('Destination resolves to a private, loopback, link-local or reserved address')
  return { address: addrs[0]!.address, family: addrs[0]!.family as 4 | 6 }
}

/** Save-time validation for check URLs (probe-time validation still runs on every hop). */
export async function assertCheckUrlAllowed(raw: string) {
  const url = new URL(raw)
  try {
    if (url.username || url.password) throw new ProbeError('Credentials in URLs are not allowed')
    await resolveSafe(url.hostname)
  }
  catch (e) {
    if (e instanceof ProbeError && e.message !== 'DNS resolution failed') {
      const { createError } = await import('h3')
      throw createError({ statusCode: 400, statusMessage: e.message })
    }
    // Unresolvable hosts are allowed to be saved; they will simply report as down.
  }
}

export interface ProbeOptions { url: string, method: 'GET' | 'HEAD', timeoutMs: number, followRedirects: boolean, expectedStatusMin: number, expectedStatusMax: number }
export interface ProbeResult { ok: boolean, httpStatus: number | null, latencyMs: number | null, error: string | null, tlsExpiresAt: Date | null, finalUrl: string }

const MAX_REDIRECTS = 5

function requestOnce(url: URL, pinned: { address: string, family: 4 | 6 }, method: string, timeoutMs: number) {
  return new Promise<{ status: number, location?: string, cert?: Date }>((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http
    const req = mod.request(url, {
      method,
      // Connect to the address we validated (prevents DNS rebinding between check and connect).
      lookup: ((_h: string, opts: { all?: boolean }, cb: (...args: any[]) => void) =>
        opts?.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family)) as any,
      headers: { 'User-Agent': 'nodexxa-uptime/1', 'Accept': '*/*' },
      timeout: timeoutMs,
      agent: false,
    }, (res) => {
      let cert: Date | undefined
      if (url.protocol === 'https:') {
        const peer = (res.socket as TLSSocket).getPeerCertificate?.()
        if (peer?.valid_to) cert = new Date(peer.valid_to)
      }
      let received = 0
      res.on('data', (chunk: Buffer) => { received += chunk.length; if (received > 65536) res.destroy() })
      res.on('close', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, cert }))
      res.on('error', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, cert }))
    })
    req.on('timeout', () => req.destroy(new ProbeError(`Timed out after ${timeoutMs} ms`)))
    req.on('error', reject)
    req.end()
  })
}

function describe(e: unknown): string {
  if (e instanceof ProbeError) return e.message
  const code = (e as NodeJS.ErrnoException)?.code
  return code ? `Connection failed (${code})` : 'Connection failed'
}

export async function probe(opts: ProbeOptions): Promise<ProbeResult> {
  const started = performance.now()
  const deadline = Date.now() + opts.timeoutMs
  let url = new URL(opts.url)
  let tlsExpiresAt: Date | null = null
  try {
    for (let hop = 0; ; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ProbeError('Only http(s) URLs are allowed')
      if (url.username || url.password) throw new ProbeError('Credentials in URLs are not allowed')
      const pinned = await resolveSafe(url.hostname)
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new ProbeError(`Timed out after ${opts.timeoutMs} ms`)
      const res = await requestOnce(url, pinned, opts.method, remaining)
      if (res.cert) tlsExpiresAt = res.cert
      if (res.status >= 300 && res.status < 400 && res.location && opts.followRedirects) {
        if (hop >= MAX_REDIRECTS) throw new ProbeError('Too many redirects')
        url = new URL(res.location, url) // every hop is re-validated at the top of the loop
        continue
      }
      const latencyMs = Math.round(performance.now() - started)
      const ok = res.status >= opts.expectedStatusMin && res.status <= opts.expectedStatusMax
      return { ok, httpStatus: res.status, latencyMs, error: ok ? null : `Unexpected HTTP status ${res.status}`, tlsExpiresAt, finalUrl: url.toString() }
    }
  }
  catch (e) {
    return { ok: false, httpStatus: null, latencyMs: null, error: describe(e), tlsExpiresAt, finalUrl: url.toString() }
  }
}
