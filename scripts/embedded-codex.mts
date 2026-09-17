import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { packTarball } from './lib/package.mts'
import { REPOSITORY_ROOT } from './lib/paths.mts'
import { run } from './lib/process.mts'

const configuredEmbeddedRoot = process.env.DSH_EMBEDDED_CODEX_ROOT?.trim()
const EMBEDDED_CODEX_ROOT = configuredEmbeddedRoot
  ? resolve(configuredEmbeddedRoot)
  : resolve(REPOSITORY_ROOT, '..', 'dsh-embedded-codex')
const EMBEDDED_DSH_HOME = resolve(EMBEDDED_CODEX_ROOT, '.tmp/dsh-home')
const EMBEDDED_DSH_BIN = resolve(
  EMBEDDED_CODEX_ROOT,
  'upstream/deepseek-harness/apps/cli/lib/bin.js',
)
const PROFILE_ROOT = resolve(EMBEDDED_DSH_HOME, 'profiles/web')
const PROFILE_MANIFEST = resolve(PROFILE_ROOT, 'package.json')
const PROFILE_MODULES = resolve(PROFILE_ROOT, 'node_modules')
const INSTALLED_PLUGIN = resolve(PROFILE_ROOT, 'node_modules/dsh-context-picker')

interface ProfileManifest {
  readonly dependencies?: Readonly<Record<string, string>>
}

function comparablePath(path: string): string {
  const normalized = realpathSync(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Remove only the reproducible dependency tree from Embedded Codex's temporary Web Profile. */
function resetEmbeddedProfileModules(): void {
  if (relative(PROFILE_ROOT, PROFILE_MODULES) !== 'node_modules') {
    throw new Error(`refusing to rebuild unsafe Embedded Codex Profile path: ${PROFILE_MODULES}`)
  }
  try {
    rmSync(PROFILE_MODULES, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch (error: unknown) {
    throw new Error(
      `cannot rebuild ${PROFILE_MODULES}; stop the running Embedded Codex Web process and retry`,
      { cause: error },
    )
  }
}

function verifyPackedInstallation(): void {
  if (!existsSync(PROFILE_MANIFEST) || !existsSync(INSTALLED_PLUGIN)) {
    throw new Error('Embedded Codex did not install dsh-context-picker into its Web Profile')
  }
  const manifest = JSON.parse(readFileSync(PROFILE_MANIFEST, 'utf8')) as ProfileManifest
  const specifier = manifest.dependencies?.['dsh-context-picker']
  if (specifier === undefined || specifier.startsWith('link:')) {
    throw new Error('Embedded Codex still points at the source checkout instead of the packed plugin')
  }
  if (comparablePath(INSTALLED_PLUGIN) === comparablePath(REPOSITORY_ROOT)) {
    throw new Error('Embedded Codex still exposes dsh-context-picker through a source link')
  }
}

if (!existsSync(EMBEDDED_DSH_BIN)) {
  throw new Error(
    `Embedded Codex DSH CLI is not built at ${EMBEDDED_DSH_BIN}; run pnpm build in ${EMBEDDED_CODEX_ROOT} first`,
  )
}

await run(process.execPath, [
  resolve(REPOSITORY_ROOT, 'node_modules/tsx/dist/cli.mjs'),
  resolve(REPOSITORY_ROOT, 'scripts/build.mts'),
], { cwd: REPOSITORY_ROOT })
const tarball = await packTarball()
resetEmbeddedProfileModules()
await run(process.execPath, [
  EMBEDDED_DSH_BIN,
  'plugin',
  '--profile',
  'web',
  'add',
  tarball,
  '--config.prefer-offline=true',
], {
  cwd: REPOSITORY_ROOT,
  env: { ...process.env, DSH_HOME: EMBEDDED_DSH_HOME },
})
verifyPackedInstallation()
process.stdout.write(`installed packed Context Picker ${tarball} into ${EMBEDDED_DSH_HOME}\n`)
