import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture } from './process.mts'
import { REPOSITORY_ROOT } from './paths.mts'

interface PackageManifest {
  readonly name: string
  readonly version: string
}

/** Pack the current build under a content-addressed path and return it. */
export async function packTarball(): Promise<string> {
  const manifest = JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8')) as PackageManifest
  const output = resolve(REPOSITORY_ROOT, '.tmp/packs')
  if (!output.startsWith(`${REPOSITORY_ROOT}\\`) && !output.startsWith(`${REPOSITORY_ROOT}/`)) {
    throw new Error(`unsafe pack output: ${output}`)
  }
  mkdirSync(output, { recursive: true })
  const tarball = resolve(output, `${manifest.name}-${manifest.version}.tgz`)
  rmSync(tarball, { force: true })
  const pnpmCli = process.env.npm_execpath
  if (pnpmCli === undefined || pnpmCli.length === 0) {
    throw new Error('packed smoke requires npm_execpath so pnpm can be launched without a command shell')
  }
  await capture(process.execPath, [
    pnpmCli,
    '--pm-on-fail=ignore',
    'pack',
    '--config.ignore-scripts=true',
    '--pack-destination',
    output,
  ], {
    cwd: REPOSITORY_ROOT,
  })
  const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex').slice(0, 16)
  const contentAddressedTarball = resolve(output, `${manifest.name}-${manifest.version}-${digest}.tgz`)
  copyFileSync(tarball, contentAddressedTarball)
  return contentAddressedTarball
}
