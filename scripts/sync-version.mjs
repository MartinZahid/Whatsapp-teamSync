import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version

if (!version) {
  console.error('[sync-version] No version found in package.json')
  process.exit(1)
}

const manifestPath = join(root, 'extension', 'public', 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.version !== version) {
  manifest.version = version
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`[sync-version] manifest.json -> ${version}`)
}

const versionTsPath = join(root, 'shared', 'version.ts')
const versionTs = `// Synced from package.json by scripts/sync-version.mjs

export const APP_VERSION = '${version}'
`
if (readFileSync(versionTsPath, 'utf8') !== versionTs) {
  writeFileSync(versionTsPath, versionTs)
  console.log(`[sync-version] shared/version.ts -> ${version}`)
}
