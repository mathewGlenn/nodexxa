import { z } from 'zod'

// Request schemas shared by Nitro handlers and Nuxt UI forms.

export const roleSchema = z.enum(['OWNER', 'ADMIN', 'VIEWER'])
export const themeSchema = z.enum(['light', 'dark', 'system'])
const email = z.string().trim().toLowerCase().email().max(254)
export const passwordSchema = z.string().min(12, 'Use at least 12 characters').max(256)

export const loginSchema = z.object({ email, password: z.string().min(1).max(256) })
export const profileSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), theme: themeSchema.optional() })
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: passwordSchema })

export const workspaceSchema = z.object({ name: z.string().trim().min(2).max(80) })
export const invitationSchema = z.object({ email, role: roleSchema })
export const acceptInvitationSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), password: passwordSchema.optional() })
export const memberUpdateSchema = z.object({ role: roleSchema.optional(), disabled: z.boolean().optional() })

const label = z.string().trim().min(1).max(80)
// DigitalOcean personal access tokens: dop_v1_ + 64 hex. Accept other printable tokens for OAuth/legacy formats.
const doToken = z.string().trim().min(20).max(512).regex(/^[\x21-\x7E]+$/, 'Token contains invalid characters')
export const connectionCreateSchema = z.object({ label, client: z.string().trim().max(80).optional(), token: doToken })
export const connectionUpdateSchema = z.object({
  label: label.optional(),
  client: z.string().trim().max(80).nullable().optional(),
  enabled: z.boolean().optional(),
  token: doToken.optional(),
})

export const checkSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(2048).refine(u => /^https?:\/\//i.test(u), 'Only http(s) URLs are allowed'),
  method: z.enum(['GET', 'HEAD']).default('GET'),
  intervalSec: z.coerce.number().int().min(30).max(86400).default(60),
  timeoutMs: z.coerce.number().int().min(1000).max(30000).default(10000),
  followRedirects: z.boolean().default(true),
  expectedStatusMin: z.coerce.number().int().min(100).max(599).default(200),
  expectedStatusMax: z.coerce.number().int().min(100).max(599).default(399),
  enabled: z.boolean().default(true),
}).refine(c => c.expectedStatusMin <= c.expectedStatusMax, { message: 'Status range is inverted', path: ['expectedStatusMax'] })

export const enrollmentCreateSchema = z.object({
  label: z.string().trim().max(80).optional(),
  ttlMinutes: z.coerce.number().int().min(5).max(1440).default(60),
})

export const agentUpdateSchema = z.object({
  displayName: z.string().trim().max(80).nullable().optional(),
  resourceId: z.string().uuid().nullable().optional(),
})

export const ALERT_TYPES = [
  'agent_offline', 'droplet_inactive', 'pm2_down', 'pm2_restarts', 'docker_unhealthy',
  'cpu_high', 'disk_high', 'memory_high', 'check_failing', 'tls_expiring', 'do_connection_error',
] as const
export const alertTypeSchema = z.enum(ALERT_TYPES)

export const alertRuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: alertTypeSchema,
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
  // threshold meaning depends on type: percent (cpu/disk/memory), count (restarts, failures), days (tls), seconds (agent_offline).
  threshold: z.coerce.number().min(0).max(1_000_000).optional(),
  durationSec: z.coerce.number().int().min(0).max(86400).default(0),
  cooldownSec: z.coerce.number().int().min(0).max(86400).default(900),
  enabled: z.boolean().default(true),
})

export const channelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['email', 'telegram']),
  target: z.string().trim().min(1).max(500),
  enabled: z.boolean().default(true),
}).superRefine((c, ctx) => {
  if (c.type === 'email' && !c.target.split(',').every(a => z.string().email().safeParse(a.trim()).success)) {
    ctx.addIssue({ code: 'custom', path: ['target'], message: 'Comma-separated email addresses expected' })
  }
  if (c.type === 'telegram' && !/^-?\d{1,20}$|^@\w{5,64}$/.test(c.target)) {
    ctx.addIssue({ code: 'custom', path: ['target'], message: 'Telegram chat id (number) or @channel expected' })
  }
})

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
