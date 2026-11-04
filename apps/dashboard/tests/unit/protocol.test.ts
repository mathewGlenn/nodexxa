import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { enrollRequestSchema, protocolJsonSchemas, rotateKeyRequestSchema, signingString, telemetryRequestSchema } from '../../server/utils/protocol'

const protocolDir = resolve(import.meta.dirname, '../../../../packages/protocol')
const fixtures = (dir: string) => readdirSync(resolve(protocolDir, 'fixtures/v1', dir)).map(f => ({ f, json: JSON.parse(readFileSync(resolve(protocolDir, 'fixtures/v1', dir, f), 'utf8')) }))
const schemaFor = (f: string) => (f.startsWith('enroll') ? enrollRequestSchema : f.startsWith('rotate') ? rotateKeyRequestSchema : telemetryRequestSchema)

describe('protocol v1 fixtures', () => {
  it.each(fixtures('valid'))('accepts valid fixture $f', ({ f, json }) => {
    const r = schemaFor(f).safeParse(json)
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
  })

  it.each(fixtures('invalid'))('rejects invalid fixture $f', ({ f, json }) => {
    expect(schemaFor(f).safeParse(json).success).toBe(false)
  })

  it('strips unknown (potentially sensitive) fields such as env and args', () => {
    const json = fixtures('valid').find(x => x.f === 'telemetry-full.json')!.json
    const tampered = structuredClone(json)
    tampered.snapshots[0].pm2.items[0].env = { SECRET: 'x' }
    tampered.snapshots[0].pm2.items[0].args = ['--password=x']
    const parsed = telemetryRequestSchema.parse(tampered)
    expect(JSON.stringify(parsed)).not.toMatch(/SECRET|password=x/)
  })

  it('checked-in JSON Schema matches the Zod source (no drift)', () => {
    const onDisk = JSON.parse(readFileSync(resolve(protocolDir, 'schema/v1.json'), 'utf8'))
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(protocolJsonSchemas())))
  })

  it('has a stable signing string format shared with the Go agent', () => {
    expect(signingString('post', '/api/agent/v1/telemetry', 'id', '1700000000', '42', 'abc')).toBe('nodexxa-v1\nPOST\n/api/agent/v1/telemetry\nid\n1700000000\n42\nabc')
  })
})
