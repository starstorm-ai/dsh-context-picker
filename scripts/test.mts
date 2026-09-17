import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { captureDsh, runDsh } from './lib/dsh.mts'
import { ensureDevelopmentLink, hasDevelopmentLink } from './lib/dev-profile.mts'
import { packTarball } from './lib/package.mts'
import { REPOSITORY_ROOT, UPSTREAM_ROOT } from './lib/paths.mts'
import { run } from './lib/process.mts'

function markdownFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', '.pnpm-store', '.tmp', 'lib', 'node_modules', 'upstream'].includes(entry.name)) return []
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) return markdownFiles(child)
    return entry.isFile() && extname(entry.name) === '.md' ? [child] : []
  })
}

function verifyMarkdown(): void {
  for (const path of markdownFiles(REPOSITORY_ROOT)) {
    const text = readFileSync(path, 'utf8')
    if (!text.endsWith('\n')) throw new Error(`${relative(REPOSITORY_ROOT, path)} has no final newline`)
    if (/ +$/m.test(text)) throw new Error(`${relative(REPOSITORY_ROOT, path)} has trailing whitespace`)
    const fences = text.match(/^```/gm)?.length ?? 0
    if (fences % 2 !== 0) throw new Error(`${relative(REPOSITORY_ROOT, path)} has an unclosed code fence`)
    for (const match of text.matchAll(/\[[^\]]+\]\((?!https?:|#)(?<target>[^)#]+)(?:#[^)]+)?\)/g)) {
      const target = match.groups?.target
      if (target === undefined || target.startsWith('<')) continue
      const decoded = decodeURIComponent(target)
      if (!existsSync(resolve(dirname(path), decoded))) {
        throw new Error(`${relative(REPOSITORY_ROOT, path)} links to missing ${target}`)
      }
    }
  }
}

async function verifyLinkedDevelopment(): Promise<void> {
  const home = resolve(REPOSITORY_ROOT, '.tmp/linked-smoke-home')
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })
  const env = { ...process.env, DSH_HOME: home }

  try {
    if (!await ensureDevelopmentLink(home, env)) {
      throw new Error('first development-link setup unexpectedly reported an existing link')
    }
    if (!hasDevelopmentLink(home)) throw new Error('development link is not readable after setup')
    if (await ensureDevelopmentLink(home, env)) {
      throw new Error('unchanged development link invoked package installation again')
    }

    const composed = await captureDsh(['--profile', 'web', '--dump-config'], env)
    if (!composed.includes('dsh-context-picker') || !composed.includes('context-picker')) {
      throw new Error('linked development Profile did not compose the Context Picker plugin')
    }
  } finally {
    const manifestPath = resolve(home, 'profiles/web/package.json')
    if (existsSync(manifestPath)
      && readFileSync(manifestPath, 'utf8').includes('dsh-context-picker')) {
      await runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-context-picker', '--config.offline=true'], env)
    }
    rmSync(home, { recursive: true, force: true })
  }
}

async function verifyPackedPlugin(): Promise<void> {
  const home = resolve(REPOSITORY_ROOT, '.tmp/packed-smoke-home')
  if (relative(REPOSITORY_ROOT, home).startsWith('..')) {
    throw new Error(`unsafe packed-smoke home: ${home}`)
  }
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })
  const env = { ...process.env, DSH_HOME: home }
  const tarball = await packTarball()
  const tarballDigest = createHash('sha256').update(readFileSync(tarball)).digest('hex').slice(0, 16)
  if (!tarball.endsWith(`-${tarballDigest}.tgz`)) {
    throw new Error('packed tarball path is not content-addressed; a local install could reuse stale contents')
  }

  try {
    await runDsh(['plugin', '--profile', 'web', 'add', tarball, '--config.prefer-offline=true'], env)
    const profileManifestPath = resolve(home, 'profiles/web/package.json')
    if (!existsSync(profileManifestPath)) throw new Error('plugin install did not initialize the isolated Web profile')
    const profile = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
      dsh?: { profile?: { bundles?: readonly string[] } }
    }
    if (profile.dsh?.profile?.bundles?.includes('dsh-context-picker') !== true) {
      throw new Error('installed plugin was not added to the Web profile Bundle list')
    }
    const installedRoot = resolve(home, 'profiles/web/node_modules/dsh-context-picker')
    for (const path of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
      if (!existsSync(resolve(installedRoot, path))) {
        throw new Error(`installed Context Picker package is missing ${path}`)
      }
    }
    if (existsSync(resolve(installedRoot, 'upstream'))) {
      throw new Error('installed Context Picker package contains development-only upstream sources')
    }
    const composed = await captureDsh(['--profile', 'web', '--dump-config'], env)
    if (!composed.includes('dsh-context-picker') || !composed.includes('context-picker')) {
      throw new Error('composed Web profile is missing the Context Picker plugin')
    }
    await runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-context-picker', '--config.offline=true'], env)
    const restored = await captureDsh(['--profile', 'web', '--dump-config'], env)
    if (restored.includes('dsh-context-picker')) {
      throw new Error('plugin removal left its Bundle in the Web profile')
    }
  } finally {
    try {
      const manifestPath = resolve(home, 'profiles/web/package.json')
      if (existsSync(manifestPath)
        && readFileSync(manifestPath, 'utf8').includes('dsh-context-picker')) {
        await runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-context-picker', '--config.offline=true'], env)
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
}

await run(process.execPath, [
  resolve(REPOSITORY_ROOT, 'node_modules/tsx/dist/cli.mjs'),
  resolve(REPOSITORY_ROOT, 'scripts/build.mts'),
], { cwd: REPOSITORY_ROOT })
await run(process.execPath, [
  resolve(REPOSITORY_ROOT, 'node_modules/vitest/vitest.mjs'),
  'run',
  '--configLoader',
  'runner',
], { cwd: REPOSITORY_ROOT })
await run(process.execPath, [
  resolve(UPSTREAM_ROOT, 'node_modules/oxlint/bin/oxlint'),
  '--deny-warnings',
  resolve(REPOSITORY_ROOT, 'src'),
  resolve(REPOSITORY_ROOT, 'scripts'),
  resolve(REPOSITORY_ROOT, 'tests'),
  resolve(REPOSITORY_ROOT, 'tsdown.config.ts'),
  resolve(REPOSITORY_ROOT, 'vitest.config.ts'),
], { cwd: UPSTREAM_ROOT })
verifyMarkdown()
await verifyLinkedDevelopment()
await verifyPackedPlugin()
process.stdout.write('passed build, tests, lint, documentation, and packed DSH plugin checks\n')
