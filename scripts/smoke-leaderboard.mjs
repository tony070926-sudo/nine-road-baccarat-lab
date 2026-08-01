import { randomBytes, randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const confirmedWrite = args.includes('--confirm-write')
const urlArguments = args.filter((argument) => argument !== '--confirm-write')

function fail(message) {
  throw new Error(message)
}

function assertIntegrity(response, body, label) {
  if (response.headers.get('X-Leaderboard-Integrity') !== 'self-reported-unverified') {
    fail(`${label} is missing the self-reported-unverified integrity header.`)
  }
  if (response.ok && body?.integrity !== 'self-reported-unverified') {
    fail(`${label} is missing the self-reported-unverified response marker.`)
  }
}

async function requestJson(url, init, label) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    fail(`${label} returned non-JSON HTTP ${response.status}.`)
  }
  assertIntegrity(response, body, label)
  return { response, body }
}

try {
  if (urlArguments.length !== 1) {
    fail(
      'Usage: npm run smoke:leaderboard -- https://explicit-deployment.example --confirm-write',
    )
  }
  if (!confirmedWrite) {
    fail('Smoke POST creates one disposable leaderboard identity; pass --confirm-write to continue.')
  }

  const baseUrl = new URL(urlArguments[0])
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    fail('Smoke URL must use http or https.')
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    fail('Smoke URL must not contain credentials, a query, or a fragment.')
  }
  const endpoint = new URL('/api/leaderboard', baseUrl)

  const getUrl = new URL(endpoint)
  getUrl.searchParams.set('page', '1')
  getUrl.searchParams.set('pageSize', '20')
  const getResult = await requestJson(getUrl, { method: 'GET' }, 'GET smoke')
  if (getResult.response.status !== 200 || !Array.isArray(getResult.body?.entries)) {
    fail(`GET smoke failed with HTTP ${getResult.response.status}.`)
  }

  const playerId = randomUUID()
  const token = randomBytes(32).toString('base64url')
  const suffix = Date.now().toString(36).slice(-7)
  const initialSubmission = {
    playerId,
    displayName: `smoke${suffix}`,
    highestBalance: 10_000,
  }
  const postHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const firstPost = await requestJson(
    endpoint,
    {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify(initialSubmission),
    },
    'POST smoke',
  )
  if (
    firstPost.response.status !== 200 ||
    firstPost.body?.entry?.highestBalance !== 10_000 ||
    !Number.isSafeInteger(firstPost.body?.entry?.rank) ||
    firstPost.body.entry.rank < 1
  ) {
    fail(`POST smoke failed with HTTP ${firstPost.response.status}.`)
  }

  const changedSubmissions = ['A', 'B'].map((marker) => ({
    ...initialSubmission,
    displayName: `smoke${marker}${suffix}`,
    highestBalance: 10_000.5,
  }))
  const concurrentResults = await Promise.all(
    changedSubmissions.map((submission, index) =>
      requestJson(
        endpoint,
        {
          method: 'POST',
          headers: postHeaders,
          body: JSON.stringify(submission),
        },
        `429 smoke ${index + 1}`,
      ),
    ),
  )
  const rateLimited = concurrentResults.find(({ response }) => response.status === 429)
  if (
    !rateLimited ||
    !String(rateLimited.body?.error?.code ?? '').endsWith('rate_limited') ||
    !rateLimited.response.headers.get('Retry-After')
  ) {
    fail(
      `429 smoke failed; received HTTP ${concurrentResults.map(({ response }) => response.status).join(', ')}.`,
    )
  }
  if (!concurrentResults.every(({ response }) => [200, 429].includes(response.status))) {
    fail(
      `Concurrent smoke returned an unexpected status: ${concurrentResults.map(({ response }) => response.status).join(', ')}.`,
    )
  }

  console.log(
    `Leaderboard smoke passed for ${baseUrl.origin}: GET 200, POST 200, cooldown 429.`,
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
