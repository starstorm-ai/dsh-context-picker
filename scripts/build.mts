import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import ts from 'typescript'
import { WorkspaceAnalyzer } from '../upstream/deepseek-harness/packages/typert/generator/src/analyzer.ts'
import { FaceModelEmitter, type ModelEmitResult } from '../upstream/deepseek-harness/packages/typert/generator/src/emitter.ts'
import { WorkspaceTypertGenerator } from '../upstream/deepseek-harness/packages/typert/generator/src/workspace.ts'
import { REPOSITORY_ROOT, UPSTREAM_ROOT } from './lib/paths.mts'
import { pnpm, run } from './lib/process.mts'

const ROOT = REPOSITORY_ROOT
const UPSTREAM = UPSTREAM_ROOT
const MAX_CLIENT_RAW_BYTES = 1024 * 1024
const MAX_CLIENT_GZIP_BYTES = 320 * 1024
const TEMP = resolve(ROOT, '.tmp')
const SHADOW_PACKAGE = resolve(UPSTREAM, 'packages/external/dsh-context-picker')
const TYPERT_HOST_CONFIG = resolve(TEMP, 'tsconfig.typert-host.json')
const CHECK_ONLY = process.argv.includes('--check')
const UPSTREAM_ARTIFACTS = [
  'apps/cli/lib/bin.js',
  'apps/web/dist/index.html',
  'vendor/schemastery/lib/index.mjs',
  'packages/llm/llm/lib/typert.host.js',
  'packages/interaction/commands/lib/typert.host.js',
  'packages/goal/goal/lib/typert.host.js',
  'packages/subagent/subagent/lib/typert.host.js',
] as const
const UPSTREAM_REMOTE_OWNERS = [
  '@deepseek-ai/dsh-agent-presets',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-api-settings-controller',
  '@deepseek-ai/dsh-goal',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-cordis-host-runner',
  '@deepseek-ai/dsh-host-plugin-inventory',
  '@deepseek-ai/dsh-message-feedback',
  '@deepseek-ai/dsh-session-reference',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-api-workspace-controller',
] as const

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

function expectedSubmoduleCommit(): string {
  if (!existsSync(resolve(UPSTREAM_ROOT, '.git')) || !existsSync(resolve(UPSTREAM_ROOT, 'package.json'))) {
    throw new Error('DeepSeek Harness submodule is not initialized; run git submodule update --init --recursive')
  }
  const entry = git(REPOSITORY_ROOT, ['ls-files', '--stage', '--', 'upstream/deepseek-harness'])
  const match = /^160000 ([0-9a-f]{40})\s/.exec(entry)
  if (match === null) throw new Error('upstream/deepseek-harness is not recorded as a Git submodule')
  const expected = match[1]!
  const actual = git(UPSTREAM_ROOT, ['rev-parse', 'HEAD'])
  if (actual !== expected) {
    throw new Error(`DeepSeek Harness is checked out at ${actual}; expected ${expected}`)
  }
  return expected
}

async function buildUpstream(commit: string): Promise<void> {
  const stampPath = resolve(TEMP, 'upstream-build.json')
  const hasArtifacts = UPSTREAM_ARTIFACTS.every(path => existsSync(resolve(UPSTREAM, path)))
  const isDirty = git(UPSTREAM, ['status', '--porcelain', '--untracked-files=no']).length > 0
  let stampedCommit: string | undefined
  if (existsSync(stampPath)) {
    try {
      const stamp = JSON.parse(readFileSync(stampPath, 'utf8')) as { commit?: unknown }
      if (typeof stamp.commit === 'string') stampedCommit = stamp.commit
    } catch {
      // A disposable damaged stamp causes a clean prerequisite rebuild.
    }
  }
  if (hasArtifacts && !isDirty && stampedCommit === commit) return
  await pnpm(['install', '--frozen-lockfile'], { cwd: UPSTREAM, env: { ...process.env, CI: 'true' } })
  await pnpm(['run', 'clean'], { cwd: UPSTREAM, env: { ...process.env, CI: 'true' } })
  await pnpm(['run', 'build'], { cwd: UPSTREAM, env: { ...process.env, CI: 'true' } })
  const missing = UPSTREAM_ARTIFACTS.filter(path => !existsSync(resolve(UPSTREAM, path)))
  if (missing.length > 0) throw new Error(`DeepSeek Harness build did not emit: ${missing.join(', ')}`)
  mkdirSync(dirname(stampPath), { recursive: true })
  writeFileSync(stampPath, `${JSON.stringify({ commit }, null, 2)}\n`, 'utf8')
}

function clean(): void {
  for (const path of [resolve(ROOT, 'lib'), TYPERT_HOST_CONFIG]) {
    const rel = relative(ROOT, path)
    if (rel.startsWith('..') || rel === '') throw new Error(`refusing to clean unsafe path ${path}`)
    rmSync(path, { recursive: true, force: true })
  }
  mkdirSync(resolve(ROOT, 'lib'), { recursive: true })
  mkdirSync(TEMP, { recursive: true })
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function materializeShadowPackage(): void {
  for (const directory of ['src/host']) mkdirSync(resolve(SHADOW_PACKAGE, directory), { recursive: true })
  cpSync(resolve(ROOT, 'package.json'), resolve(SHADOW_PACKAGE, 'package.json'))
  for (const file of [
    'src/index.ts',
    'src/config.ts',
    'src/types.ts',
    'src/provider.ts',
    'src/uri.ts',
    'src/serialization.ts',
    'src/host/recent.ts',
    'src/host/source.ts',
    'src/host/store.ts',
  ]) cpSync(resolve(ROOT, file), resolve(SHADOW_PACKAGE, file))
  writeJson(resolve(SHADOW_PACKAGE, 'tsconfig.json'), {
    extends: resolve(UPSTREAM, 'tsconfig.base.json'),
    compilerOptions: {
      rootDir: 'src',
      outDir: 'lib/types',
      noEmit: true,
      rewriteRelativeImportExtensions: false,
    },
    include: ['src'],
    references: [
      { path: resolve(UPSTREAM, 'vendor/cordis') },
      { path: resolve(UPSTREAM, 'vendor/schemastery') },
      { path: resolve(UPSTREAM, 'packages/core/agent') },
      { path: resolve(UPSTREAM, 'packages/attachment/attachment') },
      { path: resolve(UPSTREAM, 'packages/util/home-paths') },
      { path: resolve(UPSTREAM, 'packages/llm/llm') },
      { path: resolve(UPSTREAM, 'packages/core/session') },
      { path: resolve(UPSTREAM, 'packages/session-query/session-query') },
      { path: resolve(UPSTREAM, 'packages/typert/protocol') },
    ],
  })

  const upstreamConfig = ts.readConfigFile(resolve(UPSTREAM, 'tsconfig.host.json'), ts.sys.readFile)
  if (upstreamConfig.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(upstreamConfig.error.messageText, '\n'))
  }
  const references = (upstreamConfig.config.references as readonly { readonly path: string }[])
    .map(reference => ({ path: resolve(UPSTREAM, reference.path) }))
  writeJson(TYPERT_HOST_CONFIG, {
    extends: resolve(UPSTREAM, 'tsconfig.host.json'),
    files: [],
    include: [],
    references: [...references, { path: SHADOW_PACKAGE }],
  })
}

function generateTypert(): void {
  const workspace = new WorkspaceAnalyzer({
    root: UPSTREAM,
    hostConfig: TYPERT_HOST_CONFIG,
    faces: ['host'],
    packages: ['dsh-context-picker'],
    checkDiagnostics: false,
  }).analyze()
  const face = workspace.faces.find(candidate => candidate.face === 'host')
  if (face === undefined) throw new Error('Typert did not model the Context Picker Host face')
  const artifact = new FaceModelEmitter(face).emit('dsh-context-picker')
  if (artifact.remote === undefined) throw new Error('Typert did not produce the Context Picker Remote artifact')
  writeTypertArtifact(resolve(ROOT, 'lib'), artifact)
}

function cleanupShadowPackage(): void {
  rmSync(SHADOW_PACKAGE, { recursive: true, force: true })
  const externalParent = dirname(SHADOW_PACKAGE)
  if (existsSync(externalParent) && readdirSync(externalParent).length === 0) rmdirSync(externalParent)
}

function generateUpstreamRemoteContracts(): void {
  const artifacts = new WorkspaceTypertGenerator(UPSTREAM, { checkDiagnostics: false })
    .generate(UPSTREAM_REMOTE_OWNERS, ['host'])
  const owners = new Set<string>(UPSTREAM_REMOTE_OWNERS)
  for (const artifact of artifacts) {
    if (!owners.has(artifact.package)) continue
    const output = resolve(UPSTREAM, artifact.packageRoot, 'lib')
    mkdirSync(output, { recursive: true })
    writeTypertArtifact(output, artifact)
  }
  for (const owner of owners) {
    if (!artifacts.some(artifact => artifact.package === owner && artifact.remote !== undefined)) {
      throw new Error(`Typert did not produce required Remote contract: ${owner}`)
    }
  }
}

function writeTypertArtifact(output: string, artifact: ModelEmitResult): void {
  writeFileSync(resolve(output, `typert.${artifact.face}.js`), artifact.js)
  writeFileSync(resolve(output, `typert.${artifact.face}.d.ts`), artifact.dts)
  if (artifact.remote === undefined) return
  writeFileSync(resolve(output, 'typert.remote-client.js'), artifact.remote.js)
  writeFileSync(resolve(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
  writeFileSync(resolve(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
}

function textArtifacts(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return textArtifacts(path)
    return /(?:\.d\.ts|\.[cm]?js|\.map)$/.test(entry.name) ? [path] : []
  })
}

function verifyArtifacts(): void {
  const required = [
    'lib/index.js',
    'lib/index.js.map',
    'lib/client.js',
    'lib/client.js.map',
    'lib/types/index.d.ts',
    'lib/types/provider.d.ts',
    'lib/types/client/index.d.ts',
    'lib/typert.host.js',
    'lib/typert.host.d.ts',
    'lib/typert.remote-client.js',
    'lib/typert.remote-client.d.ts',
  ]
  for (const file of required) if (!existsSync(resolve(ROOT, file))) throw new Error(`missing build artifact: ${file}`)
  const client = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')
  if (!client.includes('__ModuleLoader__.load') || !client.includes('dsh-context-picker')) {
    throw new Error('client.js is not a DSH Context Picker dynamic module bundle')
  }
  const clientMap = JSON.parse(readFileSync(resolve(ROOT, 'lib/client.js.map'), 'utf8')) as {
    sources?: readonly unknown[]
  }
  const clientSources = clientMap.sources ?? []
  if (!clientSources.some(source =>
    typeof source === 'string' && /(?:^|[\\/])zod(?:[\\/]|$)/u.test(source))) {
    throw new Error('client.js did not inline zod; the Embedded Codex module table cannot satisfy it')
  }
  const localRoots = new Set([ROOT, UPSTREAM, ROOT.replaceAll('\\', '/'), UPSTREAM.replaceAll('\\', '/')])
  for (const file of textArtifacts(resolve(ROOT, 'lib'))) {
    const content = readFileSync(file, 'utf8')
    const leaked = [...localRoots].find(root => root !== '' && content.includes(root))
    if (leaked !== undefined) throw new Error(`${relative(ROOT, file)} leaks absolute build path ${leaked}`)
  }
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    dsh?: { bundle?: { patch?: unknown } }
    files?: readonly string[]
  }
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('Context Picker bundle patch is not declared')
  if (manifest.files?.includes('cordis.patch.yml') !== true) throw new Error('Context Picker bundle patch is not published')
  const patch = readFileSync(resolve(ROOT, 'cordis.patch.yml'), 'utf8')
  if (!patch.includes('id: context-picker') || !patch.includes('name: dsh-context-picker')) {
    throw new Error('Context Picker bundle patch does not insert its plugin row')
  }
  if (/^\s*disabled:\s*true\s*$/m.test(patch)) throw new Error('Context Picker must not disable a DSH provider')
  const raw = statSync(resolve(ROOT, 'lib/client.js')).size
  const gzip = gzipSync(readFileSync(resolve(ROOT, 'lib/client.js'))).byteLength
  if (raw > MAX_CLIENT_RAW_BYTES || gzip > MAX_CLIENT_GZIP_BYTES) {
    throw new Error(`client.js exceeds budget: ${raw} raw bytes, ${gzip} gzip bytes`)
  }
  console.log(`dsh-context-picker: client.js ${(raw / 1024).toFixed(1)} KiB raw, ${(gzip / 1024).toFixed(1)} KiB gzip`)
}

if (!existsSync(resolve(ROOT, 'node_modules'))) {
  throw new Error('dependencies are not installed; run pnpm install --frozen-lockfile first')
}

const upstreamCommit = expectedSubmoduleCommit()
await buildUpstream(upstreamCommit)
clean()
generateUpstreamRemoteContracts()
await run(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '-b', 'tsconfig.host.json'], { cwd: ROOT })
materializeShadowPackage()
try {
  generateTypert()
} finally {
  cleanupShadowPackage()
}
await run(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '-b', 'tsconfig.client.json'], { cwd: ROOT })
if (CHECK_ONLY) {
  console.log('dsh-context-picker: Host and Client typecheck passed')
} else {
  materializeShadowPackage()
  try {
    await run(process.execPath, [
      resolve(ROOT, 'node_modules/tsdown/dist/run.mjs'),
      '--env.DSH_BUILD_FACE',
      'client',
    ], { cwd: ROOT })
    verifyArtifacts()
  } finally {
    cleanupShadowPackage()
  }
}
process.stdout.write('built DeepSeek Harness prerequisites and dsh-context-picker\n')
