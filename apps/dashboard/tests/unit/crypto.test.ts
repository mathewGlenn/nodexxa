import { afterEach, describe, expect, it } from 'vitest'
import { ciphertextKeyId, decryptSecret, encryptSecret, hashPassword, verifyPassword } from '../../server/utils/crypto'
import { resetEnvCache } from '../../server/utils/env'

// Deliberately not shaped like a real DigitalOcean token (avoids secret-scanner false positives).
const TOKEN = `fake-do-token-${'z'.repeat(48)}`

describe('AEAD secret storage', () => {
  afterEach(() => resetEnvCache())

  it('round-trips and never contains the plaintext', () => {
    const ct = encryptSecret(TOKEN, 'connection:a')
    expect(ct).not.toContain(TOKEN)
    expect(ct.startsWith('v1.test2.')).toBe(true)
    expect(decryptSecret(ct, 'connection:a')).toBe(TOKEN)
  })

  it('uses a fresh IV for every encryption', () => {
    expect(encryptSecret(TOKEN, 'x')).not.toBe(encryptSecret(TOKEN, 'x'))
  })

  it('rejects a ciphertext moved to another row (AAD binding)', () => {
    const ct = encryptSecret(TOKEN, 'connection:a')
    expect(() => decryptSecret(ct, 'connection:b')).toThrow()
  })

  it('rejects tampering', () => {
    const parts = encryptSecret(TOKEN, 'connection:a').split('.')
    const ct = Buffer.from(parts[4]!, 'base64url')
    ct[0]! ^= 1
    parts[4] = ct.toString('base64url')
    expect(() => decryptSecret(parts.join('.'), 'connection:a')).toThrow()
  })

  it('decrypts with a previous key during rotation and re-encrypts with the current one', () => {
    const prevId = process.env.NODEXXA_ENCRYPTION_KEY_ID
    const prevKey = process.env.NODEXXA_ENCRYPTION_KEY
    // Encrypt as if the old key (test1) were current…
    process.env.NODEXXA_ENCRYPTION_KEY_ID = 'test1'
    process.env.NODEXXA_ENCRYPTION_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='
    process.env.NODEXXA_ENCRYPTION_KEYS_PREVIOUS = ''
    resetEnvCache()
    const old = encryptSecret(TOKEN, 'c')
    expect(ciphertextKeyId(old)).toBe('test1')
    // …then restore the real config where test1 is only a previous key.
    process.env.NODEXXA_ENCRYPTION_KEY_ID = prevId
    process.env.NODEXXA_ENCRYPTION_KEY = prevKey
    process.env.NODEXXA_ENCRYPTION_KEYS_PREVIOUS = 'test1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='
    resetEnvCache()
    expect(decryptSecret(old, 'c')).toBe(TOKEN)
    expect(ciphertextKeyId(encryptSecret(TOKEN, 'c'))).toBe('test2')
  })

  it('fails closed when the key is unknown or malformed', () => {
    const ct = encryptSecret(TOKEN, 'c').replace('.test2.', '.unknown.')
    expect(() => decryptSecret(ct, 'c')).toThrow(/not configured/)
    const key = process.env.NODEXXA_ENCRYPTION_KEY
    process.env.NODEXXA_ENCRYPTION_KEY = 'c2hvcnQ='
    resetEnvCache()
    expect(() => encryptSecret(TOKEN, 'c')).toThrow(/32 bytes/)
    process.env.NODEXXA_ENCRYPTION_KEY = key
  })
})

describe('password hashing', () => {
  it('verifies correct and rejects wrong passwords', async () => {
    const h = await hashPassword('correct horse battery staple')
    expect(h.startsWith('scrypt$131072$8$1$')).toBe(true)
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true)
    expect(await verifyPassword('wrong password!!', h)).toBe(false)
    expect(await verifyPassword('x', 'garbage')).toBe(false)
  })
})
