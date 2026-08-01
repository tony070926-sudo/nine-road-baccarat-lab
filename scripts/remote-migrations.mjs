import { pathToFileURL } from 'node:url'
import { runReleasePreflight } from './release-guard.mjs'
import { getReleaseTarget, runWrangler } from './release-config.mjs'

export function verifyNoPendingMigrations(targetName) {
  const target = getReleaseTarget(targetName)
  const result = runWrangler(
    [
      'd1',
      'migrations',
      'list',
      target.databaseName,
      '--env',
      target.environment,
      '--remote',
    ],
    { capture: true },
  )
  const output = `${result.stdout}\n${result.stderr}`
  if (!output.includes('No migrations to apply!')) {
    process.stderr.write(output)
    throw new Error(`${targetName} D1 still has pending migrations; deployment is blocked.`)
  }
  console.log(`Remote migration verification passed for ${targetName}: no pending migrations.`)
}

export async function applyAndVerifyRemoteMigrations(targetName) {
  const target = await runReleasePreflight(targetName)
  runWrangler([
    'd1',
    'migrations',
    'apply',
    target.databaseName,
    '--env',
    target.environment,
    '--remote',
  ])
  verifyNoPendingMigrations(targetName)
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invokedPath) {
  try {
    const action = process.argv[2]
    const targetName = process.argv[3]
    if (action === 'apply') {
      await applyAndVerifyRemoteMigrations(targetName)
    } else if (action === 'verify') {
      await runReleasePreflight(targetName)
      verifyNoPendingMigrations(targetName)
    } else {
      throw new Error('Migration action must be exactly "apply" or "verify".')
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
