import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

function wranglerCredentialFiles() {
  const userHome = homedir()
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  const platformConfigHome =
    platform() === 'darwin'
      ? join(userHome, 'Library', 'Preferences')
      : platform() === 'win32'
        ? join(process.env.APPDATA ?? userHome, 'xdg.config')
        : join(userHome, '.config')

  return [
    join(userHome, '.wrangler', 'config', 'default.toml'),
    xdgConfigHome
      ? join(xdgConfigHome, '.wrangler', 'config', 'default.toml')
      : null,
    join(platformConfigHome, '.wrangler', 'config', 'default.toml'),
  ].filter((value, index, values) => value !== null && values.indexOf(value) === index)
}

function readWranglerOauthToken() {
  for (const credentialFile of wranglerCredentialFiles()) {
    if (!existsSync(credentialFile)) continue
    const contents = readFileSync(credentialFile, 'utf8')
    const match = contents.match(
      /^oauth_token\s*=\s*("(?:[^"\\]|\\.)*")\s*$/mu,
    )
    if (!match) continue
    try {
      const token = JSON.parse(match[1])
      if (typeof token === 'string' && token.length > 0) return token
    } catch {
      // Try the next supported Wrangler credential location.
    }
  }
  return null
}

function cloudflareAccessToken() {
  const explicitToken =
    process.env.CLOUDFLARE_PAGES_READ_TOKEN ??
    process.env.CLOUDFLARE_API_TOKEN ??
    process.env.CF_API_TOKEN
  if (explicitToken) return explicitToken

  const oauthToken = readWranglerOauthToken()
  if (oauthToken) return oauthToken

  throw new Error(
    'Unable to read the current Pages project metadata. Log in with Wrangler or set CLOUDFLARE_PAGES_READ_TOKEN to a token with Pages Read access.',
  )
}

export async function fetchPagesProjectMetadata({ accountIds, projectName }) {
  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    throw new Error('No authenticated Cloudflare account is available for Pages preflight.')
  }
  const accessToken = cloudflareAccessToken()
  const apiBaseUrl = 'https://api.cloudflare.com/client/v4'

  for (const accountId of accountIds) {
    const url = new URL(
      `${apiBaseUrl.replace(/\/$/u, '')}/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
    )
    let response
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      throw new Error(
        `Cloudflare Pages project lookup could not complete within the network/auth boundary: ${error instanceof Error ? error.message : 'unknown fetch failure'}.`,
      )
    }
    if (response.status === 404) continue

    let body
    try {
      body = await response.json()
    } catch {
      throw new Error(
        `Cloudflare Pages project lookup returned non-JSON HTTP ${response.status}.`,
      )
    }
    if (!response.ok || body?.success !== true) {
      const errorCodes = Array.isArray(body?.errors)
        ? body.errors
            .map((error) => error?.code)
            .filter((code) => typeof code === 'number' || typeof code === 'string')
            .join(',')
        : ''
      throw new Error(
        `Cloudflare Pages project lookup failed with HTTP ${response.status}${errorCodes ? ` (Cloudflare codes: ${errorCodes})` : ''}; refresh Wrangler authentication or verify Pages Read access.`,
      )
    }
    const result = body.result
    if (
      result?.name !== projectName ||
      typeof result.production_branch !== 'string' ||
      result.production_branch.length === 0
    ) {
      throw new Error('Cloudflare Pages project metadata is incomplete or targets another project.')
    }
    return {
      accountId,
      name: result.name,
      productionBranch: result.production_branch,
    }
  }

  throw new Error(
    `Pages project ${projectName} was not found in the authenticated Cloudflare accounts.`,
  )
}
