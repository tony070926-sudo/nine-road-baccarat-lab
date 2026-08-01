import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { leaderboardBinding, runWrangler } from './release-config.mjs'

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'baccarat-wrangler-types-'))

try {
  for (const environment of [null, 'preview', 'production']) {
    const label = environment ?? 'top-level'
    const outputPath = join(temporaryDirectory, `${label}.d.ts`)
    const args = ['types', '--include-runtime=false']
    if (environment) args.push('--env', environment)
    args.push(outputPath)

    runWrangler(args, { capture: true })
    const generated = readFileSync(outputPath, 'utf8')
    if (!generated.includes(`${leaderboardBinding}: D1Database;`)) {
      throw new Error(`${label} generated types are missing ${leaderboardBinding}.`)
    }
  }

  console.log('Wrangler generated type checks passed for local, preview, and production.')
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
