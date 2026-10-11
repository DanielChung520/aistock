#!/usr/bin/env node
/**
 * Page quality checker for sidebar menu pages.
 *
 * Verifies two PASS criteria:
 *  1. Title moved to Header (no duplicate h1 inside <main>).
 *  2. List content does not overflow iframe footer (main.scrollHeight ≤ main.clientHeight).
 *
 * Usage:
 *   node scripts/check-page-quality.mjs <path> <expectedHeaderTitle> [--full]
 *
 * Examples:
 *   node scripts/check-page-quality.mjs /watchlist 自選股管理
 *   node scripts/check-page-quality.mjs /basics/stock-codes 證券代號查詢 --full
 *
 * --full    take a fullPage screenshot in addition to viewport
 * --shot    save the viewport screenshot to ./qa-shots/<path>.png
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const [route, expectedTitle, ...flags] = args
const wantFull = flags.includes('--full')
const wantShot = flags.includes('--shot')
const wantSticky = flags.includes('--sticky-test')

if (!route || !expectedTitle) {
  console.error('Usage: node scripts/check-page-quality.mjs <path> <expectedHeaderTitle> [--full|--shot|--sticky-test]')
  process.exit(2)
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:33300'
const url = BASE_URL + route
const safeName = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
} catch (e) {
  // Some pages keep polling (e.g. watchlist job status); allow up to 5s extra
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(3000)
}

// Best-effort: wait for either a loading skeleton to disappear or a table to appear
await page
  .waitForFunction(
    () => {
      const skeletons = document.querySelectorAll('[data-slot="card-content"] .animate-pulse, [data-slot="card-content"] .h-12.bg-muted')
      if (skeletons.length > 0) return false
      const table = document.querySelector('main table')
      const emptyText = document.body.textContent?.includes('找不到') || document.body.textContent?.includes('尚未')
      return !!table || !!emptyText
    },
    { timeout: 12000 },
  )
  .catch(() => {})
await page.waitForTimeout(800)

const report = await page.evaluate(() => {
  const $ = (sel) => document.querySelector(sel)
  const $$ = (sel) => Array.from(document.querySelectorAll(sel))
  const header = $('header')
  const main = $('main')
  const footer = document.querySelector('footer')

  const headerRect = header?.getBoundingClientRect()
  const footerRect = footer?.getBoundingClientRect()
  const mainRect = main?.getBoundingClientRect()

  // h1s INSIDE <main> (excluding header / footer / aside), ignoring sr-only (a11y-only) ones
  const mainH1s = main
    ? Array.from(main.querySelectorAll('h1'))
        .filter((h) => {
          // Treat as visible unless every parent up to <main> is sr-only
          let el = h
          while (el && el !== main) {
            if (el.classList?.contains('sr-only')) return false
            el = el.parentElement
          }
          return true
        })
        .map((h) => h.textContent?.trim())
    : []
  const headerH1 = header?.querySelector('h1')?.textContent?.trim() ?? null

  // Look for list-related rows: tr inside main
  const mainRows = main ? main.querySelectorAll('tbody tr').length : 0
  const overflows = main ? (main.scrollHeight > main.clientHeight + 1) : false

  return {
    url: location.href,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    header: {
      text: headerH1,
      rect: headerRect ? { top: headerRect.top, bottom: headerRect.bottom } : null,
    },
    main: {
      rect: mainRect ? { top: mainRect.top, bottom: mainRect.bottom, height: mainRect.height } : null,
      scrollHeight: main?.scrollHeight ?? null,
      clientHeight: main?.clientHeight ?? null,
      bodyScrollTop: document.scrollingElement?.scrollTop ?? null,
      overflows,
    },
    footer: {
      rect: footerRect ? { top: footerRect.top, bottom: footerRect.bottom, height: footerRect.height } : null,
      coveredByMain: footerRect && mainRect ? footerRect.top < mainRect.bottom : null,
    },
    mainH1s,
    mainRows,
  }
})

// Reload for shot to clear scroll state if needed
if (wantShot || wantFull) {
  const dir = path.join(process.cwd(), 'qa-shots')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `${safeName}.png`)
  await page.screenshot({ path: out, fullPage: wantFull })
  report.screenshot = out
}

const checks = []
checks.push({ name: 'Header title matches expected', pass: report.header.text === expectedTitle, got: report.header.text, expected: expectedTitle })
checks.push({ name: 'No <h1> inside <main>', pass: report.mainH1s.length === 0, got: report.mainH1s })
checks.push({ name: 'Main content fits without internal overflow', pass: report.main.overflows === false, got: { scrollHeight: report.main.scrollHeight, clientHeight: report.main.clientHeight } })
checks.push({ name: 'Footer is inside viewport (not pushed off-screen)', pass: !!report.footer.rect && report.footer.rect.bottom <= report.viewport.h, got: report.footer.rect })
checks.push({ name: 'Footer is not overlapped by main content', pass: report.footer.coveredByMain === false, got: report.footer.coveredByMain })
checks.push({ name: 'No console errors', pass: consoleErrors.length === 0, got: consoleErrors })

let stickyResult = null
if (wantSticky && report.mainRows >= 1) {
  // Find a vertically-scrollable ancestor of the table whose own height is finite
  stickyResult = await page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main) return null
    const table = main.querySelector('table')
    if (!table) return null
    const thead = table.querySelector('thead')
    if (!thead) return null
    // Walk up to find an element with overflow != visible and finite scrollHeight > clientHeight
    let wrapper = table.parentElement
    let chosen = null
    while (wrapper && wrapper !== document.body) {
      const cs = window.getComputedStyle(wrapper)
      const ovY = cs.overflowY
      if ((ovY === 'auto' || ovY === 'scroll' || ovY === 'hidden') && wrapper.scrollHeight > wrapper.clientHeight + 1) {
        chosen = wrapper
        break
      }
      wrapper = wrapper.parentElement
    }
    if (!chosen) return { found: false }
    // Scroll the wrapper down
    chosen.scrollTop = 240
    void chosen.offsetHeight
    const theadRect = thead.getBoundingClientRect()
    const wrapperRect = chosen.getBoundingClientRect()
    chosen.scrollTop = 0
    return {
      found: true,
      wrapperClass: chosen.className,
      wrapperTag: chosen.tagName,
      wrapperDataSlot: chosen.getAttribute('data-slot'),
      scrollHeight: chosen.scrollHeight,
      clientHeight: chosen.clientHeight,
      theadTopAfterScroll: theadRect.top,
      wrapperTopAfterScroll: wrapperRect.top,
      delta: theadRect.top - wrapperRect.top,
    }
  })
  if (stickyResult?.found) {
    const stickyOK = Math.abs(stickyResult.delta) < 4
    checks.push({
      name: 'Sticky table header (thead pinned to scroll-container top after scroll)',
      pass: stickyOK,
      got: stickyResult,
    })
  } else if (stickyResult && !stickyResult.found) {
    checks.push({
      name: 'Sticky table header (skip — page has no overflow-auto scroll container)',
      pass: true,
      skipped: true,
      got: stickyResult,
    })
  }
}

const allPass = checks.every((c) => c.pass)
const out = {
  route,
  url,
  expectedTitle,
  report,
  stickyResult,
  checks,
  allPass,
}
console.log(JSON.stringify(out, null, 2))

await browser.close()
process.exit(allPass ? 0 : 1)
