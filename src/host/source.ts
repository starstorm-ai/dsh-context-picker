/** Provenance attached to model-visible context injected by Context Picker. */

export interface ContextPickerMessageSource {
  readonly kind: 'context-picker'
  readonly form: 'recall'
  readonly version: 1
  readonly references: readonly {
    readonly ref: string
    readonly providerId: string
    readonly key: string
    readonly label: string
    readonly contentType: 'text' | 'image'
    readonly capturedAt: number
    readonly inputIndex: number
  }[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'context-picker': ContextPickerMessageSource
  }
}
