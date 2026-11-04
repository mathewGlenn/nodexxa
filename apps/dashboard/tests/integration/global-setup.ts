/**
 * Integration harness: migrates a disposable Postgres database from scratch, starts the fake
 * DigitalOcean API and the *production build* of the dashboard (.output) with test env.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { startFakeDo, type FakeDo } from '../fixtures/fake-do'
import { PrismaClient } from '@prisma/client'
import { TEST_DB_NAME, TEST_DB_SERVER, TEST_ENV } from '../../vitest.config'

const root = resolve(import.meta.dirname, '../..')
let server: ChildProcess | undefined
let fake: FakeDo | undefined

async function waitFor(url: string, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return }
    catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

export async function setup() {
  const env = { ...process.env, ...TEST_ENV }
  if (!/^nodexxa_it_\d+_\d+$/.test(TEST_DB_NAME)) throw new Error('Refusing to use a non-disposable test database name')
  const admin = new PrismaClient({ datasourceUrl: TEST_DB_SERVER })
  await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`)
  await admin.$disconnect()
  // Non-destructive: applies all migrations to the brand-new, empty database.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: root, env, stdio: 'pipe' })
  fake = await startFakeDo(4510)

  if (!existsSync(resolve(root, '.output/server/index.mjs'))) throw new Error('Run `pnpm build` before integration tests')
  server = spawn('node', ['.output/server/index.mjs'], {
    cwd: root,
    env: { ...env, PORT: TEST_ENV.TEST_SERVER_PORT, HOST: '127.0.0.1', NODEXXA_PUBLIC_URL: `http://127.0.0.1:${TEST_ENV.TEST_SERVER_PORT}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr?.on('data', d => process.env.DEBUG_SERVER && process.stderr.write(d))
  await waitFor(`http://127.0.0.1:${TEST_ENV.TEST_SERVER_PORT}/api/health?ready`)
}

export async function teardown() {
  server?.kill('SIGTERM')
  await fake?.close()
  await new Promise(r => setTimeout(r, 500))
  if (process.env.KEEP_TEST_DB) return
  // Drops only the database this run created (name validated above).
  const admin = new PrismaClient({ datasourceUrl: TEST_DB_SERVER })
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}" WITH (FORCE)`)
  await admin.$disconnect()
}
