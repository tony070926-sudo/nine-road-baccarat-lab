import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertLocalReleaseState,
  leaderboardBinding,
  pagesProjectName,
  projectRoot,
  releaseTargets,
  requiredSecret,
} from './release-config.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(projectRoot, relativePath), 'utf8'))
}

function assertDatabase(config, expected, label) {
  assert(
    Array.isArray(config?.d1_databases) && config.d1_databases.length === 1,
    `${label} must declare exactly one D1 database.`,
  )
  const database = config.d1_databases[0]
  assert(database.binding === leaderboardBinding, `${label} has the wrong D1 binding.`)
  assert(
    database.database_name === expected.databaseName,
    `${label} must target ${expected.databaseName}.`,
  )
  assert(
    database.database_id === expected.databaseId,
    `${label} must target D1 ${expected.databaseId}.`,
  )
  assert(database.migrations_dir === 'migrations', `${label} must use migrations/.`)
}

export function checkReleaseContract() {
  const config = readJson('wrangler.jsonc')
  const packageJson = readJson('package.json')
  const scripts = packageJson.scripts ?? {}

  assert(config.name === pagesProjectName, `Pages project must be ${pagesProjectName}.`)
  assert(config.pages_build_output_dir === './dist', 'Pages output must remain ./dist.')
  assert(!('secrets' in config), 'Pages configuration must not declare unsupported secrets.')
  assertDatabase(config, releaseTargets.preview, 'Top-level/local configuration')

  const environmentNames = Object.keys(config.env ?? {}).sort()
  assert(
    JSON.stringify(environmentNames) === JSON.stringify(['preview', 'production']),
    'wrangler.jsonc must explicitly define only env.preview and env.production.',
  )
  for (const targetName of environmentNames) {
    assert(
      !('secrets' in config.env[targetName]),
      `env.${targetName} must not declare unsupported Pages secrets.`,
    )
    assertDatabase(config.env[targetName], releaseTargets[targetName], `env.${targetName}`)
  }
  assert(
    releaseTargets.preview.databaseId !== releaseTargets.production.databaseId,
    'Preview and production D1 IDs must be different.',
  )
  assert(
    releaseTargets.preview.requireCleanWorktree === false &&
      releaseTargets.production.requireCleanWorktree === true,
    'Production alone must require a clean Git worktree.',
  )

  assertLocalReleaseState('preview', {
    branch: 'preview',
    worktreeStatus: ' M README.md\n?? local-preview-note.txt\n',
  })
  assertLocalReleaseState('production', { branch: 'main', worktreeStatus: '' })
  let dirtyProductionRejected = false
  try {
    assertLocalReleaseState('production', {
      branch: 'main',
      worktreeStatus: ' M README.md\n',
    })
  } catch (error) {
    dirtyProductionRejected =
      error instanceof Error && error.message.includes('clean Git worktree')
  }
  assert(dirtyProductionRejected, 'Production must reject a dirty Git worktree without bypass.')
  let wrongProductionBranchRejected = false
  try {
    assertLocalReleaseState('production', { branch: 'preview', worktreeStatus: '' })
  } catch {
    wrongProductionBranchRejected = true
  }
  assert(wrongProductionBranchRejected, 'Production must reject every branch except main.')

  const releaseGuard = readFileSync(join(projectRoot, 'scripts/release-guard.mjs'), 'utf8')
  assert(
    releaseGuard.includes('assertLocalReleaseState(targetName, { branch, worktreeStatus })'),
    'The remote release preflight must enforce the tested local-state guard.',
  )
  assert(
    releaseGuard.includes('fetchPagesProjectMetadata') &&
      releaseGuard.includes('pagesProject.productionBranch'),
    'The remote release preflight must verify the current Pages production branch.',
  )
  const deployScript = readFileSync(join(projectRoot, 'scripts/deploy-pages.mjs'), 'utf8')
  assert(
    deployScript.includes('WRANGLER_OUTPUT_FILE_PATH') &&
      deployScript.includes('pages-deploy-detailed'),
    'Deployments must verify Wrangler machine-readable environment metadata.',
  )

  const expectedScripts = {
    'release:preflight:preview': 'node scripts/release-guard.mjs preview',
    'release:preflight:production': 'node scripts/release-guard.mjs production',
    'db:migrate:preview': 'node scripts/remote-migrations.mjs apply preview',
    'db:migrate:production': 'node scripts/remote-migrations.mjs apply production',
    'db:verify:preview': 'node scripts/remote-migrations.mjs verify preview',
    'db:verify:production': 'node scripts/remote-migrations.mjs verify production',
    'deploy:preview': 'node scripts/deploy-pages.mjs preview',
    'deploy:production': 'node scripts/deploy-pages.mjs production',
    'smoke:leaderboard': 'node scripts/smoke-leaderboard.mjs',
    'check:release': 'node scripts/check-release-contract.mjs',
    'check:wrangler-types': 'node scripts/check-wrangler-types.mjs',
  }
  for (const [name, expected] of Object.entries(expectedScripts)) {
    assert(scripts[name] === expected, `package.json script ${name} must be ${expected}.`)
  }
  assert(!('deploy' in scripts), 'A target-ambiguous deploy script is forbidden.')
  assert(
    !('db:migrate:remote' in scripts),
    'A target-ambiguous remote migration script is forbidden.',
  )
  assert(
    scripts['db:migrate:local'] ===
      'wrangler d1 migrations apply nine-road-baccarat-leaderboard-preview --env preview --local',
    'Local migrations must target the preview D1 configuration.',
  )
  assert(
    scripts['check:functions']?.includes('npm run check:release') &&
      scripts['check:functions']?.includes('npm run check:wrangler-types') &&
      scripts['check:functions']?.includes(
        'wrangler types --include-runtime=false --check functions/types.d.ts',
      ),
    'check:functions must run release, generated environment, and tracked Wrangler type checks for CI.',
  )
  assert(
    scripts.check?.includes('npm run check:functions'),
    'The main check must include check:functions.',
  )

  const gitignore = readFileSync(join(projectRoot, '.gitignore'), 'utf8').split(/\r?\n/u)
  for (const pattern of ['.env*', '!.env.example', '.dev.vars*', '!.dev.vars.example']) {
    assert(gitignore.includes(pattern), `.gitignore must contain ${pattern}.`)
  }

  const examplePath = join(projectRoot, '.dev.vars.example')
  assert(existsSync(examplePath), '.dev.vars.example must exist.')
  const example = readFileSync(examplePath, 'utf8')
  const match = example.match(
    new RegExp(`^${requiredSecret}=([^\\r\\n]+)$`, 'mu'),
  )
  assert(match && match[1].length >= 32, `${requiredSecret} example must be 32+ characters.`)

  console.log('Release contract checks passed (preview and production are isolated).')
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invokedPath) {
  try {
    checkReleaseContract()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
