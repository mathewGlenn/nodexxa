import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { isBlockedAddress, probe, resolveSafe } from '../../server/utils/probe'

describe('SSRF address policy', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd00:ec2::254', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1', '0:0:0:0:0:ffff:a9fe:a9fe', '::127.0.0.1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1', 'ff02::1', 'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each(['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])('allows public %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false)
  })

  it.each(['localhost', 'api.localhost', '127.0.0.1', '[::1]', '169.254.169.254', 'metadata.google.internal'])('refuses hostname %s', async (host) => {
    await expect(resolveSafe(host)).rejects.toThrow()
  })
})

describe('probe', () => {
  function server(handler: Parameters<typeof createServer>[1]) {
    return new Promise<{ url: string, close: () => void }>((resolve) => {
      const s = createServer(handler).listen(0, '127.0.0.1', () => resolve({ url: `http://local.test:${(s.address() as AddressInfo).port}`, close: () => s.close() }))
    })
  }
  // Only "local.test" is mapped to loopback; every other hostname goes through the real policy.
  const testResolver = async (h: string) => (h === 'local.test' ? { address: '127.0.0.1', family: 4 as const } : resolveSafe(h))
  const opts = { method: 'GET' as const, timeoutMs: 3000, followRedirects: true, expectedStatusMin: 200, expectedStatusMax: 399 }

  it('reports success with latency', async () => {
    const s = await server((_q, r) => r.end('ok'))
    const res = await probe({ ...opts, url: s.url }, testResolver)
    s.close()
    expect(res).toMatchObject({ ok: true, httpStatus: 200, error: null })
    expect(res.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('re-validates every redirect hop (redirect to metadata endpoint is refused)', async () => {
    const s = await server((_q, r) => { r.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); r.end() })
    const res = await probe({ ...opts, url: s.url }, testResolver)
    s.close()
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/private|loopback|link-local|reserved/)
  })

  it('does not follow redirects when disabled and judges the 3xx status', async () => {
    const s = await server((_q, r) => { r.writeHead(301, { location: 'http://169.254.169.254/' }); r.end() })
    const res = await probe({ ...opts, url: s.url, followRedirects: false, expectedStatusMax: 299 }, testResolver)
    s.close()
    expect(res).toMatchObject({ ok: false, httpStatus: 301 })
  })

  it('flags unexpected statuses and timeouts', async () => {
    const s = await server((q, r) => { if (q.url === '/slow') return; r.writeHead(503); r.end() })
    expect(await probe({ ...opts, url: s.url }, testResolver)).toMatchObject({ ok: false, httpStatus: 503 })
    const slow = await probe({ ...opts, url: `${s.url}/slow`, timeoutMs: 300 }, testResolver)
    s.close()
    expect(slow.ok).toBe(false)
    expect(slow.error).toMatch(/Timed out|Connection failed/)
  })

  it('refuses URLs with embedded credentials and loopback targets in the default policy', async () => {
    expect((await probe({ ...opts, url: 'http://user:pass@example.com/' })).error).toMatch(/Credentials/)
    expect((await probe({ ...opts, url: 'http://127.0.0.1:1/' })).error).toMatch(/not allowed|private|loopback/)
  })
})
