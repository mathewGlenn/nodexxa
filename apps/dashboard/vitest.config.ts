import { defineConfig } from 'vitest/config'

// Each run migrates a brand-new database (created and later dropped by the integration harness),
// so tests never touch an existing database. TEST_DATABASE_SERVER_URL must point at a maintenance DB.
export const TEST_DB_SERVER = process.env.TEST_DATABASE_SERVER_URL ?? 'postgresql://nodexxa:nodexxa@localhost:5432/postgres'
export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? `nodexxa_it_${Date.now()}_${process.pid}`
process.env.TEST_DB_NAME = TEST_DB_NAME // keep the name stable if the config is re-evaluated in workers
const dbUrl = new URL(TEST_DB_SERVER)
dbUrl.pathname = `/${TEST_DB_NAME}`

// Fixed, test-only values. Never used outside the disposable test database.
export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: dbUrl.toString(),
  NODEXXA_ENCRYPTION_KEY: 'q6vF0bX2m3n4p5r6s7t8u9v0w1x2y3z4A5B6C7D8E9o=',
  NODEXXA_ENCRYPTION_KEY_ID: 'test2',
  NODEXXA_ENCRYPTION_KEYS_PREVIOUS: 'test1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  DO_API_BASE_URL: 'http://127.0.0.1:4510',
  TELEGRAM_API_BASE_URL: 'http://127.0.0.1:4512',
  NODEXXA_CHECKS_ALLOW_PRIVATE: 'true',
  NODEXXA_INSECURE_COOKIES: 'true',
  NODEXXA_RATE_LIMIT_LOGIN_IP: '100000',
  NODEXXA_RATE_LIMIT_ENROLL_IP: '100000',
  TEST_SERVER_PORT: '4511',
}

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], env: { ...TEST_ENV, NODEXXA_CHECKS_ALLOW_PRIVATE: 'false' } } },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          env: TEST_ENV,
          globalSetup: ['tests/integration/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
})
