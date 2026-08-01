import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const sourceRoot = join(projectRoot, 'src')

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!/\.(ts|tsx)$/.test(entry.name)) return []
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) return []
    return [path]
  })
}

function layerOf(path) {
  const pathFromSource = relative(sourceRoot, path)
  if (pathFromSource.startsWith(`game${sep}`)) return 'game'
  if (pathFromSource.startsWith(`audio${sep}`)) return 'audio'
  if (pathFromSource.startsWith(`components${sep}`)) return 'components'
  if (pathFromSource.startsWith(`app${sep}`)) return 'app'
  return 'root'
}

const forbiddenTargets = {
  game: new Set(['app', 'audio', 'components']),
  audio: new Set(['app', 'components']),
  components: new Set(['app']),
}

const violations = []
const importPattern = /(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g

for (const file of sourceFiles(sourceRoot)) {
  const sourceLayer = layerOf(file)
  const forbidden = forbiddenTargets[sourceLayer]
  if (!forbidden) continue

  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1]
    if (!specifier.startsWith('.')) continue
    const targetLayer = layerOf(resolve(dirname(file), specifier))
    if (forbidden.has(targetLayer)) {
      violations.push(
        `${relative(projectRoot, file)} (${sourceLayer}) must not import ${specifier} (${targetLayer})`,
      )
    }
  }
}

for (const legacyPath of [
  'src/game/storage.ts',
  'src/game/roundJournal.ts',
  'src/game/roundTransaction.ts',
]) {
  if (existsSync(join(projectRoot, legacyPath))) {
    violations.push(`${legacyPath} reintroduces a retired v1 write path`)
  }
}

const appPath = join(sourceRoot, 'App.tsx')
const appLines = readFileSync(appPath, 'utf8').split('\n').length
if (appLines > 2_900) {
  violations.push(
    `src/App.tsx has ${appLines} lines; extract presentation or session responsibilities before exceeding 2900`,
  )
}

if (violations.length > 0) {
  console.error('Architecture checks failed:\n')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log(`Architecture checks passed (${appLines} App.tsx lines).`)
}
