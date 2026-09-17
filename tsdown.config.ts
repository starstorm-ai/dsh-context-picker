import { resolve } from 'node:path'
import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'
import { clientBundle } from './upstream/deepseek-harness/packages/client/tsdown.client.ts'

const PACKAGE_ID = 'dsh-context-picker'
const base = clientBundle(PACKAGE_ID, ['lib/types/index.js'], {
  lib: { sourcemap: true },
})

/** DSH dynamic bundle plus the generated Context Picker Remote alias. */
export default defineConfig((inlineConfig): UserConfig[] => {
  const configs = base({ env: { ...inlineConfig.env, DSH_BUILD_FACE: 'client' } })
  return configs.map((config): UserConfig => config.name === `${PACKAGE_ID}/client`
    ? {
        ...config,
        alias: {
          ...config.alias,
          'dsh-context-picker/remote': resolve('lib/typert.remote-client.js'),
        },
        minify: true,
      }
    : config)
})
