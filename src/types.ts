/** Browser-safe wire records shared by Context Picker Host and Client faces. */

/** Image formats accepted by the DSH attachment boundary. */
export type ContextImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Bounded flat provenance metadata; values are data, never instructions. */
export interface ContextMetadataEntry {
  readonly key: string
  readonly value: string
}

/** Exact content captured by a provider at pick time. */
export type ContextCaptureContent =
  | {
    readonly type: 'text'
    readonly text: string
    readonly language?: string
  }
  | {
    readonly type: 'image'
    readonly mediaType: ContextImageMediaType
    /** Canonical base64 without a data-URL prefix. */
    readonly data: string
    readonly name?: string
  }

/** One source-owned candidate staged in the browser. */
export interface ContextCandidate {
  /** Stable identity within the provider. */
  readonly key: string
  /** User-facing chip and row label. */
  readonly label: string
  readonly description?: string
  readonly revision?: string
  readonly metadata?: readonly ContextMetadataEntry[]
  readonly content: ContextCaptureContent
  readonly appearance?: 'file' | 'session'
}

/** Host capture request. The aggregator, not a provider, supplies providerId. */
export interface ContextCaptureInput {
  readonly providerId: string
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly revision?: string
  readonly metadata?: readonly ContextMetadataEntry[]
  readonly content: ContextCaptureContent
}

/** Durable result returned after a user has actually picked a candidate. */
export interface CapturedContextReference {
  /** Lowercase SHA-256 snapshot identity. */
  readonly ref: string
  /** Canonical inline transport consumed by the Host pre-step hook. */
  readonly mention: string
  readonly label: string
  readonly contentType: 'text' | 'image'
}

/** Host-projected recent message offered by the built-in DSH provider. */
export interface RecentMessageCandidate extends ContextCandidate {
  readonly role: 'user' | 'assistant'
  readonly time: number
}
