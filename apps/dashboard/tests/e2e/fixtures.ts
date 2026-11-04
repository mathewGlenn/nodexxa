import { test as base, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { prisma } from '../../server/utils/db'
import { hashPassword } from '../../server/utils/crypto'
import { defaultAlertRules } from '../../server/utils/alerts'

export const PASSWORD = 'correct horse battery staple'
let hash: Promise<string> | undefined

export async function seedUser(role: 'OWNER' | 'ADMIN' | 'VIEWER', workspaceId?: string, theme = 'system') {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`
  const user = await prisma.user.create({ data: { email, name: `${role[0]}${role.slice(1).toLowerCase()} User`, theme, passwordHash: await (hash ??= hashPassword(PASSWORD)) } })
  let ws = workspaceId
  if (!ws) {
    ws = (await prisma.workspace.create({ data: { name: `E2E ${randomUUID().slice(0, 5)}` } })).id
    await prisma.alertRule.createMany({ data: defaultAlertRules(ws) })
  }
  await prisma.membership.create({ data: { userId: user.id, workspaceId: ws, role } })
  return { email, userId: user.id, workspaceId: ws }
}

export async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-password').fill(PASSWORD)
  await page.getByTestId('login-submit').click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
}

/** Fails the test on uncaught page errors or console errors (incl. hydration problems). */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    // Expected 4xx responses (e.g. a wrong password) are logged by Chromium as "Failed to load resource";
    // those are ignored here, but any 5xx response is recorded as a failure.
    page.on('console', (m) => {
      if ((m.type() === 'error' && !m.text().startsWith('Failed to load resource')) || /hydration/i.test(m.text())) errors.push(`console: ${m.text()}`)
    })
    page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`) })
    await use(errors)
    expect(errors, errors.join('\n')).toEqual([])
  },
})
export { expect }
