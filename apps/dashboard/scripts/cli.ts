/**
 * Operator CLI (no web bootstrap endpoint and no default credentials exist).
 *   create-admin --email <e> --name <n> --workspace <w>   password via NODEXXA_ADMIN_PASSWORD or stdin
 *   rotate-encryption-key                                 re-encrypt stored DO tokens with the current key
 *   protocol-schema                                       regenerate packages/protocol/schema/v1.json
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { prisma } from '../server/utils/db'
import { ciphertextKeyId, decryptSecret, encryptSecret, hashPassword, keyRing } from '../server/utils/crypto'
import { defaultAlertRules } from '../server/utils/alerts'
import { protocolJsonSchemas } from '../server/utils/protocol'
import { passwordSchema } from '../shared/utils/schemas'

async function readPassword(): Promise<string> {
  if (process.env.NODEXXA_ADMIN_PASSWORD) return process.env.NODEXXA_ADMIN_PASSWORD
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false })
  process.stderr.write('Password (min 12 chars): ')
  const line = await rl.question('')
  rl.close()
  return line.trim()
}

async function createAdmin(args: string[]) {
  const { values } = parseArgs({ args, options: { email: { type: 'string' }, name: { type: 'string' }, workspace: { type: 'string' } } })
  if (!values.email || !values.name || !values.workspace) throw new Error('Usage: create-admin --email <email> --name <name> --workspace <workspace>')
  const password = passwordSchema.parse(await readPassword())
  const email = values.email.trim().toLowerCase()
  if (await prisma.user.findUnique({ where: { email } })) throw new Error('A user with this email already exists')
  const passwordHash = await hashPassword(password)
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, name: values.name!, passwordHash } })
    const ws = await tx.workspace.create({ data: { name: values.workspace!, memberships: { create: { userId: user.id, role: 'OWNER' } } } })
    await tx.alertRule.createMany({ data: defaultAlertRules(ws.id) })
    await tx.auditLog.create({ data: { workspaceId: ws.id, actorLabel: 'cli', action: 'workspace.bootstrap', targetType: 'user', targetId: user.id } })
    return { userId: user.id, workspaceId: ws.id }
  })
  console.log(JSON.stringify({ ok: true, ...result }))
}

async function rotateEncryptionKey() {
  const { currentId } = keyRing()
  const conns = await prisma.connection.findMany({ select: { id: true, tokenCiphertext: true } })
  let rotated = 0
  for (const c of conns) {
    if (ciphertextKeyId(c.tokenCiphertext) === currentId) continue
    const aad = `connection:${c.id}`
    const next = encryptSecret(decryptSecret(c.tokenCiphertext, aad), aad)
    // Compare-and-swap so a concurrent token rotation is never overwritten.
    const { count } = await prisma.connection.updateMany({ where: { id: c.id, tokenCiphertext: c.tokenCiphertext }, data: { tokenCiphertext: next } })
    rotated += count
  }
  await prisma.auditLog.create({ data: { actorLabel: 'cli', action: 'encryption_key.rotated', details: { keyId: currentId, rotated } } })
  console.log(JSON.stringify({ ok: true, keyId: currentId, rotated, total: conns.length }))
}

function protocolSchema() {
  const out = resolve(import.meta.dirname, '../../../packages/protocol/schema/v1.json')
  writeFileSync(out, `${JSON.stringify(protocolJsonSchemas(), null, 2)}\n`)
  console.log(`wrote ${out}`)
}

const [command, ...rest] = process.argv.slice(2)
const commands: Record<string, () => unknown> = {
  'create-admin': () => createAdmin(rest),
  'rotate-encryption-key': rotateEncryptionKey,
  'protocol-schema': protocolSchema,
}
const run = commands[command ?? '']
if (!run) {
  console.error(`Unknown command. Available: ${Object.keys(commands).join(', ')}`)
  process.exit(2)
}
Promise.resolve(run())
  .catch((e) => { console.error(`error: ${(e as Error).message}`); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
