import { test, expect } from '@playwright/test'

// Read a CSS custom property from :root (browser normalizes hex to lowercase)
async function cssVar(page: import('@playwright/test').Page, name: string): Promise<string> {
  return page.evaluate((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), name)
}

function normHex(val: string): string {
  return val.toLowerCase().replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, '#$1$1$2$2$3$3')
}

const ACCENT = '#c6f135'
const CARD_BG = '#1a1a1a'
const BG_PRIMARY = '#0f0f0f'

test.describe('design tokens', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/onboarding.html')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
  })

  test('--bg-primary is #0F0F0F (ToyCad near-black)', async ({ page }) => {
    const val = await cssVar(page, '--bg-primary')
    expect(normHex(val)).toBe(BG_PRIMARY)
  })

  test('--bg-tertiary is #1A1A1A (card surface)', async ({ page }) => {
    const val = await cssVar(page, '--bg-tertiary')
    expect(normHex(val)).toBe(CARD_BG)
  })

  test('--accent is #C6F135 (brand green-yellow)', async ({ page }) => {
    const val = await cssVar(page, '--accent')
    expect(normHex(val)).toBe(ACCENT)
  })

  test('--accent-text is #000000 (black on accent)', async ({ page }) => {
    const val = await cssVar(page, '--accent-text')
    expect(normHex(val)).toBe('#000000')
  })

  test('--dock-active-bg is #C6F135', async ({ page }) => {
    const val = await cssVar(page, '--dock-active-bg')
    expect(normHex(val)).toBe(ACCENT)
  })

  test('--seg-active-bg is #C6F135', async ({ page }) => {
    const val = await cssVar(page, '--seg-active-bg')
    expect(normHex(val)).toBe(ACCENT)
  })

  test('--card-bg is #1A1A1A', async ({ page }) => {
    const val = await cssVar(page, '--card-bg')
    expect(normHex(val)).toBe(CARD_BG)
  })

  test('--system-blue remapped to #C6F135', async ({ page }) => {
    const val = await cssVar(page, '--system-blue')
    expect(normHex(val)).toBe(ACCENT)
  })
})

test.describe('btn-primary visual style', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/onboarding.html')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
  })

  test('primary button has #C6F135 background', async ({ page }) => {
    const btn = page.locator('.btn-primary').first()
    await expect(btn).toBeVisible()
    const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor)
    // rgb(198, 241, 53) = #C6F135
    expect(bg).toBe('rgb(198, 241, 53)')
  })

  test('primary button text is black', async ({ page }) => {
    const btn = page.locator('.btn-primary').first()
    await expect(btn).toBeVisible()
    const color = await btn.evaluate((el) => getComputedStyle(el).color)
    expect(color).toBe('rgb(0, 0, 0)')
  })

  test('primary button border-radius is 14px', async ({ page }) => {
    const btn = page.locator('.btn-primary').first()
    await expect(btn).toBeVisible()
    const br = await btn.evaluate((el) => getComputedStyle(el).borderRadius)
    expect(br).toBe('14px')
  })

  test('primary button font-weight is 700', async ({ page }) => {
    const btn = page.locator('.btn-primary').first()
    await expect(btn).toBeVisible()
    const fw = await btn.evaluate((el) => getComputedStyle(el).fontWeight)
    expect(fw).toBe('700')
  })
})

test.describe('glass-card style', () => {
  // payments page has glass-card elements; use home which renders a full shell
  test.beforeEach(async ({ page }) => {
    await page.goto('/home.html')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
  })

  test('glass-card background is #1A1A1A (solid dark)', async ({ page }) => {
    const card = page.locator('.glass-card').first()
    const count = await card.count()
    if (count === 0) { test.skip(); return }
    const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor)
    // rgb(26, 26, 26) = #1A1A1A
    expect(bg).toBe('rgb(26, 26, 26)')
  })

  test('glass-card border-radius is 20px', async ({ page }) => {
    const card = page.locator('.glass-card').first()
    const count = await card.count()
    if (count === 0) { test.skip(); return }
    const br = await card.evaluate((el) => getComputedStyle(el).borderRadius)
    expect(br).toBe('20px')
  })

  test('glass-card has no backdrop-filter blur', async ({ page }) => {
    const card = page.locator('.glass-card').first()
    const count = await card.count()
    if (count === 0) { test.skip(); return }
    const bf = await card.evaluate((el) => getComputedStyle(el).backdropFilter)
    expect(bf).toBe('none')
  })
})

test.describe('seg-control active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/home.html')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
  })

  test('active seg-btn has #C6F135 background', async ({ page }) => {
    const active = page.locator('.seg-btn.active').first()
    const count = await active.count()
    if (count === 0) { test.skip(); return }
    const bg = await active.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).toBe('rgb(198, 241, 53)')
  })

  test('active seg-btn text is black', async ({ page }) => {
    const active = page.locator('.seg-btn.active').first()
    const count = await active.count()
    if (count === 0) { test.skip(); return }
    const color = await active.evaluate((el) => getComputedStyle(el).color)
    expect(color).toBe('rgb(0, 0, 0)')
  })
})

test.describe('page background', () => {
  const pages = [
    { name: 'onboarding', path: '/onboarding.html' },
    { name: 'settings', path: '/settings.html' },
  ]

  for (const { name, path } of pages) {
    test(`${name} page html background is #0F0F0F`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(500)
      const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
      // rgb(15, 15, 15) = #0F0F0F
      expect(bg).toBe('rgb(15, 15, 15)')
    })
  }
})

test.describe('input-glass focus ring', () => {
  test('focused input gets accent green border', async ({ page }) => {
    await page.goto('/onboarding.html')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const input = page.locator('.input-glass').first()
    const count = await input.count()
    if (count === 0) { test.skip(); return }
    await input.focus()
    await page.waitForTimeout(200)
    const borderColor = await input.evaluate((el) => getComputedStyle(el).borderColor)
    // Should contain green channel dominance (198, 241, 53 or rgba variant)
    expect(borderColor).toMatch(/198.*241|241.*198/i)
  })
})

test.describe('seg-control container', () => {
  test('seg-control background is dark (#1A1A1A)', async ({ page }) => {
    await page.goto('/home.html')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    const ctrl = page.locator('.seg-control').first()
    const count = await ctrl.count()
    if (count === 0) { test.skip(); return }
    const bg = await ctrl.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).toBe('rgb(26, 26, 26)')
  })
})
