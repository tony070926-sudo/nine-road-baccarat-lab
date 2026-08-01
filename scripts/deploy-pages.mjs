import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyAndVerifyRemoteMigrations } from './remote-migrations.mjs'
import { runReleasePreflight } from './release-guard.mjs'
import {
  npmBinary,
  pagesProjectName,
  releaseTargets,
  runCommand,
  runWrangler,
} from './release-config.mjs'

function readDeploymentDetails(outputPath, target) {
  const entries = readFileSync(outputPath, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const details = entries.findLast((entry) => entry?.type === 'pages-deploy-detailed')
  if (!details) throw new Error('Wrangler did not emit pages-deploy-detailed output.')
  if (
    details.pages_project !== pagesProjectName ||
    details.environment !== target.environment ||
    details.production_branch !== releaseTargets.production.branch ||
    typeof details.deployment_id !== 'string' ||
    details.deployment_id.length === 0 ||
    typeof details.url !== 'string'
  ) {
    throw new Error(
      `Pages deployment metadata did not match the ${target.environment} release contract.`,
    )
  }
  const deploymentUrl = new URL(details.url)
  if (
    deploymentUrl.protocol !== 'https:' ||
    !deploymentUrl.hostname.endsWith(`.${pagesProjectName}.pages.dev`)
  ) {
    throw new Error('Pages deployment returned an unexpected deployment URL.')
  }
  return details
}

try {
  const targetName = process.argv[2]
  const target = await runReleasePreflight(targetName)

  runCommand(npmBinary, ['run', 'check:architecture'])
  runCommand(npmBinary, ['run', 'check:functions'])
  runCommand(npmBinary, ['run', 'build'])

  await applyAndVerifyRemoteMigrations(targetName)
  // Close the migration-to-deploy window with one final current-project check.
  await runReleasePreflight(targetName)

  const outputDirectory = mkdtempSync(join(tmpdir(), 'baccarat-pages-deploy-'))
  const outputPath = join(outputDirectory, 'wrangler-output.jsonl')
  let deployment
  try {
    runWrangler(
      [
        'pages',
        'deploy',
        'dist',
        '--project-name',
        pagesProjectName,
        '--branch',
        target.branch,
      ],
      { extraEnv: { WRANGLER_OUTPUT_FILE_PATH: outputPath } },
    )
    deployment = readDeploymentDetails(outputPath, target)
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
  }

  console.log(
    `Deployment complete for ${targetName}: ${deployment.url} (${deployment.deployment_id}). Run the explicit-URL smoke check shown in README.md.`,
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
