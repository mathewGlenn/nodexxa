import { expect, login, seedUser, test } from './fixtures'

const PAGES = ['/', '/connections', '/projects', '/servers', '/applications', '/checks', '/incidents', '/alerts', '/agents', '/team', '/settings', '/audit']

test('theme choice persists across reload and SSR renders it (no flash)', async ({ page, errors }) => {
  const { email } = await seedUser('OWNER')
  await login(page, email)
  await page.getByTestId('theme-select').first().click()
  await page.getByRole('option', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  // No flash: with the application bundle blocked (no hydration at all), the blocking inline
  // head script alone must already apply the persisted theme before first paint.
  await page.route('**/_nuxt/**/*.js', route => route.abort())
  await page.goto('/settings')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.unroute('**/_nuxt/**/*.js')

  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  expect(errors).toEqual([])
})

test('preference follows the user to a new browser at login', async ({ browser }) => {
  const { email } = await seedUser('OWNER', undefined, 'dark')
  const ctx = await browser.newContext({ colorScheme: 'light' })
  const page = await ctx.newPage()
  await login(page, email)
  await expect(page.locator('html')).toHaveClass(/dark/)
  await ctx.close()
})

test('system mode follows the OS preference', async ({ browser }) => {
  const { email } = await seedUser('OWNER', undefined, 'system')
  for (const scheme of ['dark', 'light'] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme })
    const page = await ctx.newPage()
    await login(page, email)
    if (scheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
    else await expect(page.locator('html')).not.toHaveClass(/dark/)
    await ctx.close()
  }
})

for (const mode of ['light', 'dark'] as const) {
  test(`every page renders without errors in ${mode} mode`, async ({ page, errors }) => {
    const { email } = await seedUser('OWNER', undefined, mode)
    await login(page, email)
    for (const path of PAGES) {
      await page.goto(path)
      await expect(page.locator('html')).toHaveClass(mode === 'dark' ? /dark/ : /light/)
      await expect(page.locator('h1').first()).toBeVisible()
    }
    expect(errors).toEqual([])
  })
}
