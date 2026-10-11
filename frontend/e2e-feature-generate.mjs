import { chromium } from '@playwright/test'

const url = process.env.TEST_URL || 'http://localhost:33300'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`))

try {
  await page.goto(`${url}/stock/2330`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)

  // open feature settings modal — try common trigger button texts
  const triggers = ['特徵值設置', '生成特征值', '特徵設置', '功能設置']
  let found = false
  for (const t of triggers) {
    const btn = page.getByRole('button', { name: new RegExp(t) }).first()
    if (await btn.count()) { await btn.click(); found = true; console.log(`CLICKED: ${t}`); break }
  }
  if (!found) {
    console.log('NO_TRIGGER_FOUND, buttons:', await page.locator('button').allTextContents().then(x => x.slice(0, 30)))
    process.exit(2)
  }
  await page.waitForTimeout(1200)

  // dialog should be visible
  const dialog = page.locator('[role="dialog"]').first()
  const dialogVisible = await dialog.isVisible().catch(() => false)
  console.log('DIALOG_VISIBLE:', dialogVisible)
  if (!dialogVisible) process.exit(3)

  // check tabs
  const tabs = await page.locator('[role="tab"]').allTextContents()
  console.log('TABS:', tabs)

  // click 開始生成 button
  const genBtn = page.getByRole('button', { name: '開始生成' })
  if (await genBtn.count()) {
    console.log('GEN_BUTTON_FOUND')
    await genBtn.click()
    await page.waitForTimeout(1500)
    const btnText = await genBtn.textContent()
    console.log('GEN_BUTTON_TEXT_AFTER_CLICK:', btnText?.trim())
    // wait for completion
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(2000)
      const txt = await genBtn.textContent()
      console.log(`  poll ${i}: ${txt?.trim()}`)
      if (txt?.includes('完成')) break
    }
    // check footer status message
    const footerMsg = await page.locator('div').filter({ hasText: '生成完成' }).first().textContent().catch(() => null)
    console.log('FOOTER_MSG:', footerMsg)
  } else {
    console.log('NO_GEN_BUTTON, footer buttons:', await page.locator('[role="dialog"] button').allTextContents())
  }
} catch (e) {
  console.log('ERROR:', e.message)
  process.exit(1)
} finally {
  console.log('--- CONSOLE ---')
  console.log(logs.slice(-15).join('\n'))
  await browser.close()
}
