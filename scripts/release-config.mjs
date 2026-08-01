import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

export const projectRoot = resolve(import.meta.dirname, '..')
export const cloudflareAccountId = '9755cd236862dadca7cf413336ee661b'
export const pagesProjectName = 'nine-road-baccarat-lab'
export const leaderboardBinding = 'LEADERBOARD_DB'
export const requiredSecret = 'LEADERBOARD_RATE_LIMIT_SECRET'

export const releaseTargets = Object.freeze({
  preview: Object.freeze({
    environment: 'preview',
    branch: 'preview',
    requireCleanWorktree: false,
    databaseName: 'nine-road-baccarat-leaderboard-preview',
    databaseId: 'e0bfb3cc-1dbe-4663-97a4-adaa691b62b0',
  }),
  production: Object.freeze({
    environment: 'production',
    branch: 'main',
    requireCleanWorktree: true,
    databaseName: 'nine-road-baccarat-leaderboard',
    databaseId: 'c941400a-5a6c-459a-bdc6-28884b58f8fa',
  }),
})

export const wranglerBinary = join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
)
export const npmBinary = process.platform === 'win32' ? 'npm.cmd' : 'npm'

export function getReleaseTarget(targetName) {
  if (!Object.hasOwn(releaseTargets, targetName)) {
    throw new Error(
      `Release target must be exactly "preview" or "production"; received ${JSON.stringify(targetName)}.`,
    )
  }
  return releaseTargets[targetName]
}

export function assertLocalReleaseState(targetName, { branch, worktreeStatus }) {
  const target = getReleaseTarget(targetName)
  if (!branch || branch !== target.branch) {
    throw new Error(
      `${targetName} releases require Git branch ${target.branch}; current branch is ${branch || '(detached HEAD)'}.`,
    )
  }
  if (target.requireCleanWorktree && worktreeStatus.trim()) {
    throw new Error(
      'Production releases require a clean Git worktree; commit or remove every tracked and untracked change first.',
    )
  }
  return target
}

export function stripAnsi(value) {
  return value.replaceAll(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

export function runCommand(
  command,
  args,
  { capture = false, extraEnv = {}, label = `${command} ${args.join(' ')}` } = {},
) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      ...extraEnv,
    },
    stdio: capture ? 'pipe' : 'inherit',
  })

  if (result.error) {
    throw new Error(`Unable to start ${label}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stderr.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`)
  }

  return {
    stdout: stripAnsi(result.stdout ?? ''),
    stderr: stripAnsi(result.stderr ?? ''),
  }
}

export function runWrangler(args, options) {
  return runCommand(wranglerBinary, args, {
    label: `wrangler ${args.join(' ')}`,
    ...options,
  })
}
