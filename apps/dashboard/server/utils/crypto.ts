import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { env } from './env'

// ---------- AEAD secret storage (AES-256-GCM) ----------
// Ciphertext format: v1.<keyId>.<iv>.<tag>.<ciphertext> (base64url parts).
// `aad` binds a ciphertext to its owning row (e.g. connection id) so it cannot be swapped between rows.

function decodeKey(b64: string): Buffer {
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) throw new Error('Encryption keys must be 32 bytes, base64-encoded')
  return key
}

export function keyRing(): { currentId: string, keys: Map<string, Buffer> } {
  const e = env()
  const keys = new Map<string, Buffer>()
  for (const entry of e.NODEXXA_ENCRYPTION_KEYS_PREVIOUS.split(',').map(s => s.trim()).filter(Boolean)) {
    const idx = entry.indexOf(':')
    if (idx < 1) throw new Error('NODEXXA_ENCRYPTION_KEYS_PREVIOUS entries must be keyId:base64')
    keys.set(entry.slice(0, idx), decodeKey(entry.slice(idx + 1)))
  }
  keys.set(e.NODEXXA_ENCRYPTION_KEY_ID, decodeKey(e.NODEXXA_ENCRYPTION_KEY))
  return { currentId: e.NODEXXA_ENCRYPTION_KEY_ID, keys }
}

export function encryptSecret(plaintext: string, aad: string): string {
  const { currentId, keys } = keyRing()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keys.get(currentId)!, iv)
  cipher.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return ['v1', currentId, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

export function decryptSecret(payload: string, aad: string): string {
  const [version, keyId, iv, tag, ct] = payload.split('.')
  if (version !== 'v1' || !keyId || !iv || !tag || ct === undefined) throw new Error('Unsupported ciphertext format')
  const key = keyRing().keys.get(keyId)
  if (!key) throw new Error(`Encryption key "${keyId}" is not configured`)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}

export const ciphertextKeyId = (payload: string) => payload.split('.')[1]

// ---------- Tokens ----------
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

// ---------- Passwords (scrypt; N=2^17, r=8, p=1 per OWASP guidance) ----------
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }

function scryptAsync(password: string, salt: Buffer, len: number, opts: typeof SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize('NFKC'), salt, len, opts, (err, key) => err ? reject(err) : resolve(key)))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 32, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem })
  return timingSafeEqual(actual, expected)
}

// Equalizes login timing for unknown users.
let dummyHash: Promise<string> | undefined
export const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()))
