import { spawn } from 'node:child_process'

/** Inputs for one inherited-output subprocess. */
export interface RunOptions {
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
}

/**
 * Run one command, await its exit, and reject on spawn or non-zero status.
 * @param command - executable name or absolute path.
 * @param args - literal argument vector.
 * @param options - working directory and optional environment.
 */
export async function run(command: string, args: readonly string[], options: RunOptions): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`${command} ended by signal ${signal}`))
      } else if (code !== 0) {
        reject(new Error(`${command} exited with status ${String(code)}`))
      } else {
        resolve()
      }
    })
  })
}

/** Run the repository-selected pnpm executable. */
export async function pnpm(args: readonly string[], options: RunOptions): Promise<void> {
  const cli = process.env.npm_execpath
  if (cli === undefined || cli.length === 0) {
    throw new Error('pnpm scripts require npm_execpath so pnpm can be launched without a command shell')
  }
  // This repository intentionally carries a large pinned workspace submodule.
  // Do not let programmatic `pnpm exec` calls run pnpm's automatic dependency
  // repair, which can otherwise purge node_modules while a dev server is live.
  await run(process.execPath, [cli, '--pm-on-fail=ignore', ...args], options)
}

/** Capture stdout while forwarding stderr and rejecting non-zero exits. */
export async function capture(command: string, args: readonly string[], options: RunOptions): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
      shell: false,
      windowsHide: true,
    })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal !== null) reject(new Error(`${command} ended by signal ${signal}`))
      else if (code !== 0) reject(new Error(`${command} exited with status ${String(code)}`))
      else resolve(stdout)
    })
  })
}
