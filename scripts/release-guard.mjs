import { pathToFileURL } from 'node:url'
import { checkReleaseContract } from './check-release-contract.mjs'
import { fetchPagesProjectMetadata } from './pages-project-metadata.mjs'
import {
  assertLocalReleaseState,
  cloudflareAccountId,
  getReleaseTarget,
  pagesProjectName,
  releaseTargets,
  requiredSecret,
  runCommand,
  runWrangler,
} from './release-config.mjs'

function parseJson(value, label) {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(
      `${label} did not return valid JSON: ${error instanceof Error ? error.message : error}`,
    )
  }
}

export async function runReleasePreflight(targetName) {
  const target = getReleaseTarget(targetName)
  checkReleaseContract()

  const branch = runCommand('git', ['branch', '--show-current'], {
    capture: true,
    label: 'git branch check',
  }).stdout.trim()
  const worktreeStatus = runCommand(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    { capture: true, label: 'git worktree check' },
  ).stdout
  assertLocalReleaseState(targetName, { branch, worktreeStatus })

  const databaseListResult = runWrangler(
    ['d1', 'list', '--env', target.environment, '--json'],
    { capture: true },
  )
  const databases = parseJson(databaseListResult.stdout, 'wrangler d1 list')
  const databaseInfo = Array.isArray(databases)
    ? databases.find(
        (database) =>
          database?.name === target.databaseName && database?.uuid === target.databaseId,
      )
    : null
  if (!databaseInfo) {
    throw new Error(
      `${targetName} D1 target ${target.databaseName} (${target.databaseId}) does not exist in the authenticated Cloudflare account.`,
    )
  }

  const whoamiResult = runWrangler(['whoami', '--json'], { capture: true })
  const whoami = parseJson(whoamiResult.stdout, 'wrangler whoami')
  const explicitAccountId =
    process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID
  if (explicitAccountId && explicitAccountId !== cloudflareAccountId) {
    throw new Error(
      `Cloudflare account override is ${explicitAccountId}; expected ${cloudflareAccountId}.`,
    )
  }
  const authenticatedAccountIds = Array.isArray(whoami?.accounts)
    ? whoami.accounts.map((account) => account?.id)
    : []
  if (!authenticatedAccountIds.includes(cloudflareAccountId)) {
    throw new Error(
      `Wrangler is not authenticated to the required Cloudflare account ${cloudflareAccountId}.`,
    )
  }
  const pagesProject = await fetchPagesProjectMetadata({
    accountIds: [cloudflareAccountId],
    projectName: pagesProjectName,
  })
  if (pagesProject.productionBranch !== releaseTargets.production.branch) {
    throw new Error(
      `Pages production_branch is ${pagesProject.productionBranch}; expected ${releaseTargets.production.branch}. Deployment is blocked before migrations.`,
    )
  }

  const productionDeploymentsResult = runWrangler(
    [
      'pages',
      'deployment',
      'list',
      '--project-name',
      pagesProjectName,
      '--environment',
      'production',
      '--json',
    ],
    { capture: true },
  )
  const productionDeployments = parseJson(
    productionDeploymentsResult.stdout,
    'wrangler pages deployment list',
  )
  const latestProductionDeployment = Array.isArray(productionDeployments)
    ? productionDeployments[0]
    : null
  if (
    latestProductionDeployment?.Environment !== 'Production' ||
    latestProductionDeployment?.Branch !== releaseTargets.production.branch
  ) {
    throw new Error(
      `Latest Pages production deployment must be on ${releaseTargets.production.branch}.`,
    )
  }

  const secretResult = runWrangler(
    [
      'pages',
      'secret',
      'list',
      '--env',
      target.environment,
      '--project-name',
      pagesProjectName,
    ],
    { capture: true },
  )
  const secretOutput = `${secretResult.stdout}\n${secretResult.stderr}`
  if (!secretOutput.includes(`"${target.environment}" environment`)) {
    throw new Error(`Unable to confirm the Pages ${target.environment} environment.`)
  }
  const escapedSecret = requiredSecret.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!new RegExp(`(?:^|\\s)-\\s+${escapedSecret}:`, 'mu').test(secretOutput)) {
    throw new Error(
      `Pages ${target.environment} is missing required secret ${requiredSecret}.`,
    )
  }

  console.log(
    `Release preflight passed for ${targetName}: branch ${branch}, D1 ${target.databaseName}, Pages production branch ${pagesProject.productionBranch}, secret present.`,
  )
  return target
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invokedPath) {
  try {
    await runReleasePreflight(process.argv[2])
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
