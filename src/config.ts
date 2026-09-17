/** Configuration bounds and stable Context Picker diagnostics. */

export const DEFAULT_MAX_TEXT_BYTES = 256 * 1024
export const DEFAULT_MAX_REFERENCES = 12
export const DEFAULT_RECENT_MESSAGE_LIMIT = 12
export const HARD_MAX_TEXT_BYTES = 4 * 1024 * 1024
export const HARD_MAX_REFERENCES = 32
export const HARD_MAX_RECENT_MESSAGE_LIMIT = 50

export interface Config {
  /** Explicit DSH home override, primarily useful for isolated deployments/tests. */
  dshHome?: string
  /** Maximum UTF-8 bytes in one captured text snapshot. */
  maxTextBytes?: number
  /** Maximum distinct snapshots expanded by one direct user message. */
  maxReferences?: number
  /** Maximum recent user/assistant messages exposed by the built-in provider. */
  recentMessageLimit?: number
}

export type ContextPickerErrorCode =
  | 'CONTEXT_PICKER_INVALID_CONFIG'
  | 'CONTEXT_PICKER_INVALID_CAPTURE'
  | 'CONTEXT_PICKER_INVALID_REFERENCE'
  | 'CONTEXT_PICKER_REFERENCE_NOT_FOUND'
  | 'CONTEXT_PICKER_TOO_MANY_REFERENCES'
  | 'CONTEXT_PICKER_TEXT_TOO_LARGE'
  | 'CONTEXT_PICKER_IMAGE_LIMIT_EXCEEDED'
  | 'CONTEXT_PICKER_STORAGE_FAILED'
  | 'CONTEXT_PICKER_CANCELLED'

export class ContextPickerError extends Error {
  constructor(
    message: string,
    readonly code: ContextPickerErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ContextPickerError'
  }
}
