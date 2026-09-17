import { resolve } from 'node:path'
import { capture, run } from './process.mts'
import { REPOSITORY_ROOT } from './paths.mts'

const DSH_BIN = resolve(REPOSITORY_ROOT, 'upstream/deepseek-harness/apps/cli/lib/bin.js')

function command(args: readonly string[]): readonly string[] {
  return [DSH_BIN, ...args]
}

/** Run the pinned DSH CLI from its supported profile entrypoint. */
export async function runDsh(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd = REPOSITORY_ROOT,
): Promise<void> {
  await run(process.execPath, command(args), { cwd, env })
}

/** Run the pinned DSH CLI and capture its stdout. */
export async function captureDsh(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd = REPOSITORY_ROOT,
): Promise<string> {
  return await capture(process.execPath, command(args), { cwd, env })
}
