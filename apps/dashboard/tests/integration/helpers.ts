import { generateKeyPairSync, randomUUID, sign, createHash, type KeyObject } from 'node:crypto'
import { prisma } from '../../server/utils/db'
import { hashPassword } from '../../server/utils/crypto'
import { defaultAlertRules } from '../../server/utils/alerts'
import { signingString } from '../../server/utils/protocol'

export const BASE = `http://127.0.0.1:${process.env.TEST_SERVER_PORT}`
export const PASSWORD = 'correct horse battery staple'

/** Minimal cookie-jar HTTP client that behaves like a same-origin browser (sends Origin). */
export class Client {
  cookies = new Map<string, string>()
  constructor(public origin = BASE) {}

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { origin: this.origin } : {}),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const [k, v] = pair!.split('=')
      if (v) this.cookies.set(k!, v)
      else this.cookies.delete(k!)
    }
    const text = await res.text()
    let json: any
    try { json = text ? JSON.parse(text) : undefined }
    catch { json = text }
    return { status: res.status, body: json, raw: text, headers: res.headers }
  }

  get = (p: string) => this.req('GET', p)
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {})
  patch = (p: string, b: unknown) => this.req('PATCH', p, b)
  put = (p: string, b: unknown) => this.req('PUT', p, b)
  del = (p: string) => this.req('DELETE', p)

  async login(email: string, password = PASSWORD) {
    const r = await this.post('/api/auth/login', { email, password })
    if (r.status !== 200) throw new Error(`login failed ${r.status} ${r.raw}`)
    return this
  }
}

let pwHash: Promise<string> | undefined

/** Creates a user + workspace membership directly in the DB (test fixture). */
export async function createUser(role: 'OWNER' | 'ADMIN' | 'VIEWER', workspaceId?: string) {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`
  const user = await prisma.user.create({ data: { email, name: role, passwordHash: await (pwHash ??= hashPassword(PASSWORD)) } })
  let wsId = workspaceId
  if (!wsId) {
    const ws = await prisma.workspace.create({ data: { name: `WS ${randomUUID().slice(0, 6)}` } })
    await prisma.alertRule.createMany({ data: defaultAlertRules(ws.id) })
    wsId = ws.id
  }
  await prisma.membership.create({ data: { userId: user.id, workspaceId: wsId, role } })
  return { user, email, workspaceId: wsId, client: await new Client().login(email) }
}

// ---------- Agent protocol helpers ----------
export interface TestAgent { id: string, privateKey: KeyObject, publicKeyB64: string, seq: bigint }

export function newKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url')
  return { privateKey, publicKeyB64: raw.toString('base64') }
}

export async function signedPost(agent: TestAgent, path: string, payload: unknown, opts: { seq?: bigint, timestamp?: number, key?: KeyObject, rawBody?: string } = {}) {
  const body = opts.rawBody ?? JSON.stringify(payload)
  const seq = opts.seq ?? (agent.seq += 1n)
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000))
  const msg = signingString('POST', path, agent.id, ts, seq.toString(), createHash('sha256').update(body).digest('hex'))
  const sig = sign(null, Buffer.from(msg), opts.key ?? agent.privateKey).toString('base64')
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nodexxa-agent-id': agent.id, 'x-nodexxa-timestamp': ts, 'x-nodexxa-seq': seq.toString(), 'x-nodexxa-signature': sig },
    body,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

export function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    collectedAt: new Date().toISOString(),
    system: {
      uptimeSec: 3600, cpuPercent: 12.5, load1: 0.3, load5: 0.2, load15: 0.1, memTotalBytes: 2e9, memAvailableBytes: 1e9, swapTotalBytes: 0, swapFreeBytes: 0,
      filesystems: [{ mount: '/', fsType: 'ext4', totalBytes: 50e9, usedBytes: 20e9 }, { mount: '/run', fsType: 'tmpfs', totalBytes: 1e8, usedBytes: 1e8 }],
    },
    pm2: { status: 'ok', items: [{ name: 'api', pmId: 0, status: 'online', restarts: 2, cpuPercent: 1.5, memoryBytes: 1e8, uptimeSec: 600 }] },
    docker: { status: 'disabled', items: [] },
    nginx: { status: 'ok', active: true, version: '1.24.0', sites: [{ serverNames: ['example.test'], listen: ['443 ssl'], tls: true }], certificates: [{ subject: 'example.test', notAfter: new Date(Date.now() + 5 * 86400_000).toISOString() }] },
    ...overrides,
  }
}

export function telemetry(snapshots: unknown[] = [snapshot()]) {
  return {
    protocolVersion: 1, agentVersion: '0.1.0-test', capabilities: ['system', 'pm2', 'nginx'],
    health: { startedAt: new Date().toISOString(), queueLength: 0, droppedSnapshots: 0 }, snapshots,
  }
}

export async function enrollAgent(client: Client, workspaceId: string, hostname = 'host-1'): Promise<TestAgent> {
  const { body } = await client.post(`/api/w/${workspaceId}/enrollments`, { label: hostname, ttlMinutes: 30 })
  const kp = newKeyPair()
  const res = await fetch(`${BASE}/api/agent/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 1, enrollmentToken: body.token, publicKey: kp.publicKeyB64, hostname, os: 'linux', arch: 'amd64', agentVersion: '0.1.0-test', capabilities: ['system', 'pm2'] }),
  })
  if (res.status !== 201) throw new Error(`enroll failed ${res.status} ${await res.text()}`)
  const { agentId } = await res.json() as { agentId: string }
  return { id: agentId, privateKey: kp.privateKey, publicKeyB64: kp.publicKeyB64, seq: 0n }
}
