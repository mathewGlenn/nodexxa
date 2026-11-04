import { expect, login, seedUser, test } from './fixtures'

test('mobile layout has no horizontal page scroll and a usable navigation menu', async ({ page, errors }) => {
  const { email } = await seedUser('OWNER')
  await login(page, email)
  for (const path of ['/', '/servers', '/agents', '/settings']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1)
  }
  // Sidebar collapses into a toggle on small screens.
  await page.getByRole('button', { name: /open|menu|toggle/i }).first().click()
  await page.getByRole('link', { name: 'Checks' }).click()
  await expect(page).toHaveURL(/\/checks$/)
  expect(errors).toEqual([])
})
