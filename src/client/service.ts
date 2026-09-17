/** Provider registry and privacy-preserving browser staging area. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ContextPickerProvider,
  ContextPickerProviderRegistry,
} from '../provider.ts'
import type {
  CapturedContextReference,
  ContextCandidate,
  ContextCaptureInput,
} from '../types.ts'

export interface ContextPickerRemoteAdapter {
  capture(
    sessionId: SessionId,
    input: ContextCaptureInput,
    signal: AbortSignal,
  ): Promise<CapturedContextReference>
}

export interface StagedContextCandidate {
  readonly ref: string
  readonly label: string
  readonly description?: string
  readonly section: string
  readonly appearance?: 'file' | 'session'
}

interface ProviderEntry {
  readonly provider: ContextPickerProvider
  readonly registration: number
}

interface StagedEntry {
  readonly sessionId: SessionId
  readonly label: string
  readonly appearance?: 'file' | 'session'
  input: ContextCaptureInput | undefined
  result?: CapturedContextReference
  inFlight: Promise<CapturedContextReference> | undefined
}

const LOCAL_REF_PREFIX = 'dsh-context-local:'
const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u
const MAX_CANDIDATES_PER_PROVIDER = 50

declare module '@deepseek-ai/cordis' {
  interface Context {
    contextPicker: ContextPickerClientService
  }
}

/** Root Web service. Provider implementations never receive chat/editor internals. */
export class ContextPickerClientService extends Service implements ContextPickerProviderRegistry {
  private readonly providers: ProviderEntry[] = []
  private readonly staged = new Map<string, StagedEntry>()
  private registration = 0
  private readonly lifecycle = new AbortController()

  constructor(ctx: Context, private readonly remote: ContextPickerRemoteAdapter) {
    super(ctx, 'contextPicker')
    ctx.effect(() => () => { this.lifecycle.abort(new Error('Context Picker client disposed')) }, 'context-picker: lifecycle')
  }

  registerProvider(provider: ContextPickerProvider): () => void {
    if (!PROVIDER_ID_PATTERN.test(provider.id)) {
      throw new Error(`Context Picker provider id ${JSON.stringify(provider.id)} is invalid`)
    }
    if (provider.label.trim() === '') throw new Error(`Context Picker provider ${provider.id} has no label`)
    if (this.providers.some(entry => entry.provider.id === provider.id)) {
      throw new Error(`Context Picker provider ${JSON.stringify(provider.id)} is already registered`)
    }
    const entry = { provider, registration: this.registration++ }
    this.providers.push(entry)
    return () => {
      const index = this.providers.indexOf(entry)
      if (index >= 0) this.providers.splice(index, 1)
    }
  }

  async discover(
    sessionId: SessionId,
    query: string,
    signal: AbortSignal,
  ): Promise<StagedContextCandidate[]> {
    const providers = [...this.providers].sort((left, right) =>
      (left.provider.order ?? 0) - (right.provider.order ?? 0)
      || left.registration - right.registration)
    const groups = await Promise.all(providers.map(async ({ provider }) => {
      try {
        const found = await provider.candidates(sessionId, { query, signal })
        signal.throwIfAborted()
        const staged = await Promise.all(found.slice(0, MAX_CANDIDATES_PER_PROVIDER).map(async candidate => {
          try {
            return await this.stage(sessionId, provider, candidate)
          } catch (error: unknown) {
            console.warn(`[dsh-context-picker] provider ${provider.id} returned an invalid candidate:`, error)
            return undefined
          }
        }))
        return staged.filter((candidate): candidate is StagedContextCandidate => candidate !== undefined)
      } catch (error: unknown) {
        if (signal.aborted) return []
        console.warn(`[dsh-context-picker] provider ${provider.id} discovery failed:`, error)
        return []
      }
    }))
    signal.throwIfAborted()
    return groups.flat()
  }

  describe(ref: string): Pick<StagedContextCandidate, 'label' | 'appearance'> | undefined {
    const entry = this.staged.get(ref)
    return entry === undefined
      ? undefined
      : { label: entry.label, ...(entry.appearance === undefined ? {} : { appearance: entry.appearance }) }
  }

  clipboardText(ref: string): string {
    return `@${this.staged.get(ref)?.label ?? 'context'}`
  }

  commit(ref: string): void {
    void this.start(ref).catch(() => {
      // Serialization retries and surfaces the error at the send boundary.
    })
  }

  async serialize(ref: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const result = await abortable(this.start(ref), signal)
    return result.mention
  }

  private async stage(
    sessionId: SessionId,
    provider: ContextPickerProvider,
    candidate: ContextCandidate,
  ): Promise<StagedContextCandidate> {
    validateCandidate(candidate)
    const input: ContextCaptureInput = structuredClone({
      providerId: provider.id,
      key: candidate.key,
      label: candidate.label,
      ...(candidate.description === undefined ? {} : { description: candidate.description }),
      ...(candidate.revision === undefined ? {} : { revision: candidate.revision }),
      ...(candidate.metadata === undefined ? {} : { metadata: candidate.metadata }),
      content: candidate.content,
    })
    const fingerprint = await sha256(canonicalJson([String(sessionId), input]))
    const ref = `${LOCAL_REF_PREFIX}${fingerprint}`
    const existing = this.staged.get(ref)
    if (existing === undefined) {
      this.staged.set(ref, {
        sessionId,
        label: candidate.label,
        ...(candidate.appearance === undefined ? {} : { appearance: candidate.appearance }),
        input,
        inFlight: undefined,
      })
    }
    return {
      ref,
      label: candidate.label,
      ...(candidate.description === undefined ? {} : { description: candidate.description }),
      section: provider.label,
      ...(candidate.appearance === undefined ? {} : { appearance: candidate.appearance }),
    }
  }

  private start(ref: string): Promise<CapturedContextReference> {
    const entry = this.staged.get(ref)
    if (entry === undefined || !ref.startsWith(LOCAL_REF_PREFIX)) {
      return Promise.reject(new Error('Context Picker reference is no longer available in this page'))
    }
    if (entry.result !== undefined) return Promise.resolve(entry.result)
    if (entry.inFlight !== undefined) return entry.inFlight
    if (entry.input === undefined) return Promise.reject(new Error('Context Picker staged payload is unavailable'))
    const input = entry.input
    const request = this.remote.capture(entry.sessionId, input, this.lifecycle.signal).then((result) => {
      entry.result = result
      entry.input = undefined
      return result
    }).finally(() => {
      entry.inFlight = undefined
    })
    entry.inFlight = request
    return request
  }
}

function validateCandidate(candidate: ContextCandidate): void {
  if (candidate.key.length === 0 || candidate.label.trim() === '') {
    throw new Error('candidate key and label must be non-empty')
  }
  if (candidate.content.type === 'text' && candidate.content.text.length === 0) {
    throw new Error('text candidate must be non-empty')
  }
  if (candidate.content.type === 'image' && candidate.content.data.length === 0) {
    throw new Error('image candidate must be non-empty')
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalValue(child)]))
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    void work.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}
