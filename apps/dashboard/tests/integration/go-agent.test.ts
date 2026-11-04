/**
 * Cross-language end-to-end: the compiled Go agent enrolls with, signs for and reports to the
 * production build of the dashboard. Skipped (and reported as skipped) only when Go is unavailable.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { BASE, createUser } from './helpers'

const hasGo = spawnSync('go', ['version']).status === 0
const agentDir = resolve(import.meta.dirname, '../../../../agents/linux')
const work = mkdtempSync(join(tmpdir(), 'nx-agent-'))
const bin = join(work, 'nodexxa-agent')
const config = join(work, 'config.json')
const stateDir = join(work, 'state')

function agent(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(bin, [...args, '--config', config], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 30_000 })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

describe.skipIf(!hasGo)('Go agent ↔ dashboard (real binary)', () => {
  beforeAll(() => {
    execFileSync('go', ['build', '-o', bin, './cmd/nodexxa-agent'], { cwd: agentDir, env: { ...process.env, CGO_ENABLED: '0' } })
    writeFileSync(config, JSON.stringify({ stateDir, intervalSec: 60, queueMax: 10, collectors: { pm2: true, docker: false, nginx: true, systemdUnits: [] } }))
  })

  it('enrolls once, reports, rotates its key, and is cut off by revocation', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const ws = `/api/w/${workspaceId}`
    const token = (await client.post(`${ws}/enrollments`, { label: 'go-e2e', ttlMinutes: 10 })).body.token

    const enrolled = agent(['enroll', '--server', BASE, '--hostname', 'go-e2e-host'], { NODEXXA_ENROLLMENT_TOKEN: token })
    expect(enrolled.code, enrolled.out).toBe(0)
    expect(enrolled.out).not.toContain(token)
    // Token is single-use: a second enrollment with a fresh state dir fails.
    const again = spawnSync(bin, ['enroll', '--server', BASE, '--config', config, '--state-dir', join(work, 'state2')], { env: { NODEXXA_ENROLLMENT_TOKEN: token }, encoding: 'utf8' })
    expect(again.status).toBe(1)
    expect(`${again.stderr}`).toMatch(/401/)

    const run1 = agent(['run', '--once'])
    expect(run1.code, run1.out).toBe(0)
    const list = (await client.get(`${ws}/agents`)).body
    expect(list).toHaveLength(1)
    const detail = (await client.get(`${ws}/agents/${list[0].id}`)).body
    expect(detail).toMatchObject({ hostname: 'go-e2e-host', state: 'online', os: 'linux' })
    expect(detail.system.memTotalBytes).toBeGreaterThan(0)
    expect(detail.system.filesystems.length).toBeGreaterThan(0)
    expect(detail.collectors.docker.status).toBe('disabled') // opt-in only
    expect(['ok', 'unavailable', 'error']).toContain(detail.collectors.pm2.status)
    expect(detail.series.mem_pct.points.length).toBe(1)

    const rotated = agent(['rotate-key'])
    expect(rotated.code, rotated.out).toBe(0)
    expect(agent(['run', '--once']).code).toBe(0)
    expect((await client.get(`${ws}/agents/${list[0].id}`)).body.keyRotatedAt).not.toBe(detail.keyRotatedAt)

    await client.post(`${ws}/agents/${list[0].id}/revoke`)
    const denied = agent(['run', '--once'])
    expect(denied.code).toBe(1)
    expect(denied.out).toMatch(/rejected agent credentials/)
  })
})
