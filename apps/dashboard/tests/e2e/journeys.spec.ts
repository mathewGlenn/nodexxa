import { prisma } from '../../server/utils/db'
import { syncConnection } from '../../server/utils/sync'
import { processRule } from '../../server/utils/alerts'
import { FAKE_TOKENS } from '../fixtures/fake-do'
import { expect, login, PASSWORD, seedUser, test } from './fixtures'

test('rejects a wrong password without revealing which part was wrong', async ({ page, errors }) => {
  const { email } = await seedUser('OWNER')
  await page.goto('/connections')
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)connections/)
  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-password').fill('not-the-password')
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('login-error')).toHaveText('Invalid email or password')
  await page.getByTestId('login-password').fill(PASSWORD)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/connections$/)
  expect(errors).toEqual([])
})

test('admin connects two DO teams; inventory stays separated with colliding IDs', async ({ page, errors }) => {
  const { email, workspaceId } = await seedUser('OWNER')
  await login(page, email)
  await page.goto('/connections')
  for (const [label, token] of [['Alpha prod', FAKE_TOKENS.alpha], ['Beta client', FAKE_TOKENS.beta]] as const) {
    await page.getByTestId('add-connection').click()
    await page.getByTestId('connection-label').fill(label)
    await page.getByTestId('connection-token').fill(token)
    await page.getByTestId('connection-submit').click()
    await expect(page.getByTestId('connections-table')).toContainText(label)
  }
  await expect(page.getByTestId('connections-table')).toContainText(`••••${FAKE_TOKENS.alpha.slice(-4)}`)
  await expect(page.locator('body')).not.toContainText(FAKE_TOKENS.alpha)

  // Worker step (run in-process for determinism).
  for (const c of await prisma.connection.findMany({ where: { workspaceId } })) await syncConnection(c.id)

  await page.goto('/servers')
  const table = page.getByTestId('resource-table')
  await expect(table.getByRole('link', { name: 'alpha-web-1' })).toBeVisible()
  await expect(table.getByRole('link', { name: 'beta-web-1' })).toBeVisible()
  await expect(table.locator('tbody tr')).toHaveCount(6)
  await expect(table).toContainText('1001 ') // provider ID shown twice, once per team

  await table.getByRole('link', { name: 'alpha-web-1' }).click()
  await expect(page.getByText('Source: DigitalOcean Monitoring API')).toBeVisible()
  await expect(page.getByRole('img', { name: /CPU: \d+ samples/ })).toBeVisible()

  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: /Production/ }).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('viewer can browse but sees no privileged controls and is denied by the API', async ({ page, errors }) => {
  const owner = await seedUser('OWNER')
  const viewer = await seedUser('VIEWER', owner.workspaceId)
  await login(page, viewer.email)
  for (const [path, control] of [['/connections', 'add-connection'], ['/agents', 'enroll-agent'], ['/checks', 'add-check'], ['/alerts', 'add-rule']]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }).or(page.locator('h1')).first()).toBeVisible()
    await expect(page.getByTestId(control)).toHaveCount(0)
  }
  await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0)
  const res = await page.request.post(`/api/w/${owner.workspaceId}/enrollments`, { data: { ttlMinutes: 10 }, headers: { origin: new URL(page.url()).origin } })
  expect(res.status()).toBe(403)
  expect(errors).toEqual([])
})

test('enrollment wizard reveals a one-time token exactly once', async ({ page, errors }) => {
  const { email, workspaceId } = await seedUser('ADMIN')
  await login(page, email)
  await page.goto('/agents')
  await page.getByTestId('enroll-agent').click()
  await page.getByTestId('create-enrollment').click()
  const token = await page.getByTestId('enrollment-token').inputValue()
  expect(token.length).toBeGreaterThan(30)
  await expect(page.getByText('nodexxa-agent enroll --server')).toBeVisible()
  await expect(page.getByText('sha256sum --ignore-missing -c SHA256SUMS', { exact: false })).toBeVisible()
  const stored = await prisma.enrollmentToken.findFirstOrThrow({ where: { workspaceId } })
  expect(stored.tokenHash).not.toContain(token)
  await page.getByRole('button', { name: 'Done' }).click()
  await page.reload()
  await expect(page.locator('body')).not.toContainText(token)
  expect(errors).toEqual([])
})

test('failing uptime check produces an incident that can be acknowledged', async ({ page, errors }) => {
  const { email, workspaceId } = await seedUser('OWNER')
  const check = await prisma.check.create({ data: { workspaceId, name: 'Public API', url: 'https://api.example.test/health', lastStatus: 'down', lastCheckedAt: new Date(), consecutiveFailures: 3, lastError: 'Connection failed (ECONNREFUSED)' } })
  const rule = await prisma.alertRule.findFirstOrThrow({ where: { workspaceId, type: 'check_failing' } })
  await processRule(rule)
  await login(page, email)
  await expect(page.getByText('Check Public API is failing')).toBeVisible() // overview
  await page.goto('/incidents')
  const row = page.getByTestId('incidents-table').locator('tr', { hasText: 'Public API' })
  await row.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(row).toContainText('acknowledged')
  await page.goto(`/checks/${check.id}`)
  await expect(page.getByText('Connection failed (ECONNREFUSED)')).toBeVisible()
  expect(errors).toEqual([])
})

test('owner invites a viewer who joins via one-time link', async ({ page, browser, errors }) => {
  const { email } = await seedUser('OWNER')
  await login(page, email)
  await page.goto('/team')
  await page.getByTestId('invite-email').fill('invited-e2e@example.test')
  await page.getByTestId('invite-submit').click()
  const link = await page.getByTestId('invite-link').textContent()
  const ctx = await browser.newContext()
  const p2 = await ctx.newPage()
  await p2.goto(link!)
  await p2.getByLabel('Your name').fill('Invited Person')
  await p2.getByLabel('Password').fill('another-long-password')
  await p2.getByRole('button', { name: 'Create account' }).click()
  await expect(p2.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await p2.goto(link!)
  await expect(p2.getByText('This invitation is invalid or has expired.')).toBeVisible()
  await ctx.close()
  expect(errors).toEqual([])
})
