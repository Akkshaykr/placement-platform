// Scans the production build for things that must never ship to the browser.
// Run after `npm run build` (the `npm run check` script does this for you).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dist = resolve(import.meta.dirname, '..', 'dist')
if (!existsSync(dist)) {
  console.error('dist/ not found. Run `npm run build` first.')
  process.exit(1)
}

const forbidden = [
  { name: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: 'JWT with role service_role', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*(?:c2VydmljZV9yb2xl|InNlcnZpY2Vfcm9sZSI)[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/ },
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'GEMINI_API_KEY reference', pattern: /GEMINI_API_KEY/ },
  { name: 'SERVICE_ROLE variable name', pattern: /SERVICE_ROLE_KEY/ },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
]

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

let failures = 0
let scanned = 0
for (const file of walk(dist)) {
  if (!/\.(js|css|html|map|json|txt|svg)$/.test(file)) continue
  scanned += 1
  const text = readFileSync(file, 'utf8')
  for (const { name, pattern } of forbidden) {
    if (pattern.test(text)) {
      console.error(`FOUND ${name} in ${file.replace(dist, 'dist')}`)
      failures += 1
    }
  }
}

for (const required of ['index.html', '_headers']) {
  if (!existsSync(join(dist, required))) {
    console.error(`Missing ${required} in dist/`)
    failures += 1
  }
}

if (failures > 0) {
  console.error(`verify-build: ${failures} problem(s) in ${scanned} files.`)
  process.exit(1)
}
console.log(`verify-build: OK (${scanned} files scanned, no secret patterns, required files present).`)
