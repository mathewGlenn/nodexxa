import { z } from 'zod'

/**
 * Agent ↔ server protocol, version 1. This file is the source of truth; the JSON Schema in
 * packages/protocol/schema/v1.json is generated from it (`pnpm protocol:generate`) and tests fail on drift.
 * Unknown fields are stripped (forward compatible); every string, number and list is bounded.
 */
export const PROTOCOL_VERSION = 1
export const SUPPORTED_PROTOCOL_VERSIONS = [1]
export const MAX_BODY_BYTES = 512 * 1024
export const MAX_SNAPSHOTS = 20
export const CLOCK_SKEW_SEC = 300
export const CAPABILITIES = ['system', 'pm2', 'docker', 'nginx', 'systemd'] as const

const s = (max: number) => z.string().max(max)
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const pct = z.number().min(0).max(100)
const ts = z.string().datetime({ offset: true })
const collectorStatus = z.enum(['ok', 'unavailable', 'error', 'disabled'])
const collector = <T extends z.ZodType>(item: T, max: number) => z.object({
  status: collectorStatus,
  error: s(300).optional(),
  items: z.array(item).max(max).default([]),
})

export const enrollRequestSchema = z.object({
  protocolVersion: z.number().int(),
  enrollmentToken: s(128).min(20),
  publicKey: z.string().regex(/^[\w+/]{43}=$/, 'Ed25519 public key, base64 (32 bytes)'),
  hostname: s(253).min(1).regex(/^[\w.-]+$/),
  os: z.literal('linux'),
  arch: z.enum(['amd64', 'arm64']),
  agentVersion: s(40).regex(/^[\w.+-]+$/),
  capabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length),
})

export const systemSchema = z.object({
  uptimeSec: count,
  cpuPercent: pct.nullable(),
  load1: z.number().min(0).max(1e6),
  load5: z.number().min(0).max(1e6),
  load15: z.number().min(0).max(1e6),
  memTotalBytes: count,
  memAvailableBytes: count,
  swapTotalBytes: count,
  swapFreeBytes: count,
  filesystems: z.array(z.object({ mount: s(256), fsType: s(32), totalBytes: count, usedBytes: count })).max(32),
})

export const pm2ProcessSchema = z.object({
  name: s(128).min(1),
  pmId: z.number().int().min(0).max(1e6),
  status: s(32),
  restarts: count,
  cpuPercent: z.number().min(0).max(10000).nullable(),
  memoryBytes: count.nullable(),
  uptimeSec: count.nullable(),
})

export const containerSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{12}$/),
  name: s(128).min(1),
  image: s(256),
  state: s(32),
  health: z.enum(['healthy', 'unhealthy', 'starting', 'none']),
  status: s(128),
})

export const systemdUnitSchema = z.object({
  name: s(256).regex(/^[\w@.:-]+$/),
  activeState: s(32),
  subState: s(32),
})

export const nginxSchema = z.object({
  status: collectorStatus,
  error: s(300).optional(),
  active: z.boolean().nullable(),
  version: s(64).nullable().default(null),
  sites: z.array(z.object({ serverNames: z.array(s(253)).max(20), listen: z.array(s(64)).max(10), tls: z.boolean() })).max(100).default([]),
  certificates: z.array(z.object({ subject: s(253), notAfter: ts })).max(100).default([]),
})

export const snapshotSchema = z.object({
  collectedAt: ts,
  system: systemSchema.optional(),
  pm2: collector(pm2ProcessSchema, 200).optional(),
  docker: collector(containerSchema, 200).optional(),
  systemd: collector(systemdUnitSchema, 50).optional(),
  nginx: nginxSchema.optional(),
})

export const telemetryRequestSchema = z.object({
  protocolVersion: z.number().int(),
  agentVersion: s(40).regex(/^[\w.+-]+$/),
  capabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length),
  health: z.object({
    startedAt: ts,
    queueLength: count,
    droppedSnapshots: count,
    lastError: s(300).optional(),
  }),
  snapshots: z.array(snapshotSchema).min(1).max(MAX_SNAPSHOTS),
})

export const rotateKeyRequestSchema = z.object({
  protocolVersion: z.number().int(),
  newPublicKey: enrollRequestSchema.shape.publicKey,
  // Signature by the NEW key over "nodexxa-v1-rotate\n<agentId>\n<newPublicKey>" (proof of possession).
  proof: z.string().regex(/^[\w+/]{86}==$/),
})

export type TelemetryRequest = z.infer<typeof telemetryRequestSchema>
export type Snapshot = z.infer<typeof snapshotSchema>

/** Canonical string the agent signs for every authenticated request. */
export const signingString = (method: string, path: string, agentId: string, timestamp: string, seq: string, bodySha256Hex: string) =>
  ['nodexxa-v1', method.toUpperCase(), path, agentId, timestamp, seq, bodySha256Hex].join('\n')

export const protocolJsonSchemas = () => ({
  $comment: 'Generated from apps/dashboard/server/utils/protocol.ts — do not edit by hand.',
  version: PROTOCOL_VERSION,
  enrollRequest: z.toJSONSchema(enrollRequestSchema, { io: 'input' }),
  telemetryRequest: z.toJSONSchema(telemetryRequestSchema, { io: 'input' }),
  rotateKeyRequest: z.toJSONSchema(rotateKeyRequestSchema, { io: 'input' }),
})
