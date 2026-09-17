/** Public provider SDK. Context sources depend on this contract, not chat UI internals. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ContextCandidate } from './types.ts'

/** Cancellable discovery request for one active DSH session. */
export interface ContextProviderRequest {
  readonly query: string
  readonly signal: AbortSignal
}

/**
 * A Context Picker source.
 *
 * Candidates remain local until the user picks one. `key` identifies the
 * source object and `revision` identifies its immutable content revision.
 */
export interface ContextPickerProvider {
  /** Stable machine id, for example `dsh-file-manager`. */
  readonly id: string
  /** Localized menu section label. */
  readonly label: string
  /** Lower values appear first. */
  readonly order?: number
  candidates(
    sessionId: SessionId,
    request: ContextProviderRequest,
  ): Promise<readonly ContextCandidate[]> | readonly ContextCandidate[]
}

/** Public registry exposed as `ctx.contextPicker` in the Web client. */
export interface ContextPickerProviderRegistry {
  registerProvider(provider: ContextPickerProvider): () => void
}
