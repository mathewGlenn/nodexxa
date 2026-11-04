import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.string().default('development'),
  NODEXXA_ENCRYPTION_KEY: z.string().min(1, 'NODEXXA_ENCRYPTION_KEY is required'),
  NODEXXA_ENCRYPTION_KEY_ID: z.string().regex(/^[\w-]{1,32}$/).default('k1'),
  NODEXXA_ENCRYPTION_KEYS_PREVIOUS: z.string().default(''),
  NODEXXA_PUBLIC_URL: z.string().url().optional(),
  DO_API_BASE_URL: z.string().url().default('https://api.digitalocean.com'),
  // Test-only escape hatch so CI can probe a local mock HTTP server. Refused in production.
  NODEXXA_CHECKS_ALLOW_PRIVATE: z.enum(['true', 'false']).default('false'),
  // Allows non-Secure cookies for plain-HTTP local testing. Refused in production.
  NODEXXA_INSECURE_COOKIES: z.enum(['true', 'false']).default('false'),
  // Per-source-IP throttles (per-account throttles are fixed). Raise only behind a trusted proxy or in tests.
  NODEXXA_RATE_LIMIT_LOGIN_IP: z.coerce.number().int().positive().default(30),
  NODEXXA_RATE_LIMIT_ENROLL_IP: z.coerce.number().int().positive().default(10),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_API_BASE_URL: z.string().url().default('https://api.telegram.org'),
})

export type Env = z.infer<typeof schema>
let cached: Env | undefined

export function env(): Env {
  if (cached) return cached
  const parsed = schema.parse(process.env)
  if (parsed.NODE_ENV === 'production') {
    if (parsed.NODEXXA_CHECKS_ALLOW_PRIVATE === 'true') throw new Error('NODEXXA_CHECKS_ALLOW_PRIVATE must not be enabled in production')
    if (parsed.NODEXXA_INSECURE_COOKIES === 'true') throw new Error('NODEXXA_INSECURE_COOKIES must not be enabled in production')
    if (parsed.DO_API_BASE_URL !== 'https://api.digitalocean.com') throw new Error('DO_API_BASE_URL may only be overridden outside production')
  }
  cached = parsed
  return parsed
}

/** Test helper: forget cached env after mutating process.env. */
export const resetEnvCache = () => { cached = undefined }
