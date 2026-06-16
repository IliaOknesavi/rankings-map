import { chromium } from 'playwright'

const url = process.argv[2] || 'http://localhost:4173/'
const out = process.argv[3] || 'shot.png'
const formula = process.argv[4] // optional: type a formula and apply

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(url, { waitUntil: 'networkidle' })
// wait for countries to be painted with real colors (not no-data)
await page.waitForFunction(() => {
  const ps = document.querySelectorAll('path.country')
  if (ps.length < 100) return false
  let colored = 0
  ps.forEach((p) => { const f = p.getAttribute('fill') || ''; if (f.startsWith('rgb')) colored++ })
  return colored > 80
}, { timeout: 15000 })

if (formula) {
  await page.fill('#formulaInput', formula)
  await page.click('#applyFormula')
  await page.waitForTimeout(800)
}

await page.screenshot({ path: out })
const status = await page.textContent('#status')
console.log('STATUS:', status)
console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none')
await browser.close()
