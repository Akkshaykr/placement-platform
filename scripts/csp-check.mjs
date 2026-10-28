// Builds the site with placeholder config, serves it with the exact headers from public/_headers,
// and loads key pages in headless Chromium to detect Content-Security-Policy violations.
// Usage: node scripts/csp-check.mjs        (needs `npx playwright install chromium` once)
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'dist-csp')
const isWindows = process.platform === 'win32'

execFileSync(isWindows ? 'npx.cmd' : 'npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
  cwd: root,
  stdio: 'ignore',
  shell: isWindows,
  env: { ...process.env, VITE_SUPABASE_URL: 'https://csp-check.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_csp_check_key' },
})

// Parse the global header block of public/_headers.
const headerLines = readFileSync(join(root, 'public', '_headers'), 'utf8').split('\n')
const globalHeaders = {}
let inGlobal = false
for (const line of headerLines) {
  if (line.startsWith('/*')) { inGlobal = true; continue }
  if (/^\S/.test(line)) { inGlobal = false; continue }
  if (inGlobal && line.trim()) {
    const i = line.indexOf(':')
    globalHeaders[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  let file = join(out, path)
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(out, 'index.html') // SPA fallback
  res.writeHead(200, { ...globalHeaders, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(5190, r))

const browser = await chromium.launch()
const problems = []
try {
  const page = await browser.newPage()
  page.on('console', (m) => { if (/content security policy|refused to/i.test(m.text())) problems.push(m.text()) })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  for (const path of ['/', '/login', '/register']) {
    await page.goto(`http://localhost:5190${path}`)
    await page.getByRole('heading').first().waitFor()
    const fontOk = await page.evaluate(async () => {
      await document.fonts.ready
      return document.fonts.check('16px "Geist Variable"')
    })
    if (!fontOk) problems.push(`Geist font not available on ${path}`)
  }
  const csp = globalHeaders['Content-Security-Policy']
  if (!csp) problems.push('No Content-Security-Policy header found in public/_headers')
} finally {
  await browser.close()
  server.close()
}

if (problems.length) {
  console.error('csp-check FAILED:\n' + problems.map((p) => ` - ${p}`).join('\n'))
  process.exit(1)
}
console.log('csp-check: OK (landing, login, register render under the production CSP with no violations; fonts load).')
