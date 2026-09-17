/** Web plugin: generated Remote, Provider registry, built-ins, and one @ source. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import contextPickerRemote from 'dsh-context-picker/remote'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { RecentMessageCandidate } from '../types.ts'
import { createClipboardProvider } from './clipboard-provider.ts'
import { en, NS, zh } from './locales.ts'
import { createRecentMessageProvider } from './recent-provider.ts'
import {
  ContextPickerClientService,
  type ContextPickerRemoteAdapter,
} from './service.ts'
import { createContextPickerSource } from './source.ts'

export type { ContextPickerLocaleKey } from './locales.ts'
export type {
  ContextPickerRemoteAdapter,
  StagedContextCandidate,
} from './service.ts'
export { ContextPickerClientService } from './service.ts'
export type * from '../provider.ts'

export const inject = ['remote', 'locale', 'inputTriggers']

/** Mount Remote first so the service never publishes a registry it cannot capture through. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contextPickerRemote)
  const adapter: ContextPickerRemoteAdapter = {
    capture: async (sessionId, input, signal) => unwrap(await ctx.remote.contextPickerHost.capture(
      sessionId,
      input,
      signal,
    )),
  }
  const serviceFiber = ctx.plugin(ContextPickerClientService, adapter)
  try {
    await serviceFiber
  } catch (error) {
    await serviceFiber.dispose()
    await disposeRemote()
    throw error
  }
  const ui = ctx.inject(['contextPicker', 'inputTriggers', 'locale', 'remote.contextPickerHost'], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await serviceFiber.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await serviceFiber.dispose()
    await disposeRemote()
  }
}

function registerUi(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'context-picker: dictionaries')
  ctx.effect(
    () => ctx.contextPicker.registerProvider(createClipboardProvider(t)),
    'context-picker: Clipboard Provider',
  )
  ctx.effect(
    () => ctx.contextPicker.registerProvider(createRecentMessageProvider({
      recent: async (
        sessionId: SessionId,
        query: string,
        signal: AbortSignal,
      ): Promise<readonly RecentMessageCandidate[]> => unwrap(
        await ctx.remote.contextPickerHost.recent(sessionId, query, signal),
      ),
    }, t)),
    'context-picker: DSH recent-message Provider',
  )
  ctx.effect(
    () => ctx.inputTriggers.registerSource(createContextPickerSource(ctx.contextPicker)),
    'context-picker: @ source',
  )
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  const error = new Error(result.error.message)
  Object.assign(error, { code: result.error.code, details: result.error.details })
  throw error
}
