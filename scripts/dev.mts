import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { runDsh } from './lib/dsh.mts'
import { ensureDevelopmentLink, installDevelopmentTarball } from './lib/dev-profile.mts'
import { packTarball } from './lib/package.mts'
import { DEVELOPMENT_DSH_HOME, REPOSITORY_ROOT, UPSTREAM_ROOT } from './lib/paths.mts'
import { run } from './lib/process.mts'

const action = process.argv[2] ?? 'start'
if (action !== 'start' && action !== 'install' && action !== 'web' && action !== 'remove') {
  throw new Error('usage: tsx scripts/dev.mts <start|install|web|remove>')
}

const dshBin = resolve(UPSTREAM_ROOT, 'apps/cli/lib/bin.js')
const env = { ...process.env, DSH_HOME: DEVELOPMENT_DSH_HOME }
mkdirSync(DEVELOPMENT_DSH_HOME, { recursive: true })

async function buildPlugin(): Promise<void> {
  await run(process.execPath, [
    resolve(REPOSITORY_ROOT, 'node_modules/tsx/dist/cli.mjs'),
    resolve(REPOSITORY_ROOT, 'scripts/build.mts'),
  ], { cwd: REPOSITORY_ROOT })
}

if (action === 'start') {
  await buildPlugin()
  const linked = await ensureDevelopmentLink(DEVELOPMENT_DSH_HOME, env)
  process.stdout.write(linked
    ? `linked ${REPOSITORY_ROOT} into ${DEVELOPMENT_DSH_HOME}\n`
    : 'development link is current; skipped plugin installation\n')
  process.stdout.write('starting Web; type @ in a Session composer to open Context Picker\n')
  await runDsh(['web'], env)
} else if (action === 'install') {
  await buildPlugin()
  const tarball = await packTarball()
  await installDevelopmentTarball(DEVELOPMENT_DSH_HOME, tarball, env)
  process.stdout.write(`installed packed plugin ${tarball} into ${DEVELOPMENT_DSH_HOME}\n`)
} else {
  if (!existsSync(dshBin)) throw new Error('DeepSeek Harness is not built; run pnpm build first')
  if (action === 'web') {
    await runDsh(['web'], env)
  } else {
    await runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-context-picker', '--config.offline=true'], env)
  }
}
