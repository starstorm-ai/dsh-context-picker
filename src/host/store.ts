/** Durable, content-addressed snapshot repository. */

import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type {
  AttachmentStore,
  ImageAttachmentRef,
  ImageMediaType,
} from '@deepseek-ai/dsh-attachment'
import { ContextPickerError } from '../config.ts'
import type {
  ContextCaptureInput,
  ContextImageMediaType,
  ContextMetadataEntry,
} from '../types.ts'
import { CONTEXT_REFERENCE_PATTERN } from '../uri.ts'

export interface StoredTextContext {
  readonly type: 'text'
  readonly text: string
  readonly language?: string
}

export interface StoredImageContext {
  readonly type: 'image'
  readonly attachment: ImageAttachmentRef
}

export interface ContextSnapshotRecord {
  readonly version: 1
  readonly ref: string
  readonly providerId: string
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly revision?: string
  readonly metadata: readonly ContextMetadataEntry[]
  readonly capturedAt: number
  readonly content: StoredTextContext | StoredImageContext
}

interface SnapshotIdentity {
  readonly version: 1
  readonly providerId: string
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly revision?: string
  readonly metadata: readonly ContextMetadataEntry[]
  readonly content: StoredTextContext | StoredImageContext
}

const PROVIDER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u
const MAX_KEY_CHARS = 4096
const MAX_LABEL_CHARS = 120
const MAX_DESCRIPTION_CHARS = 4096
const MAX_REVISION_CHARS = 256
const MAX_LANGUAGE_CHARS = 64
const MAX_IMAGE_NAME_CHARS = 160
const MAX_METADATA_ENTRIES = 20
const MAX_METADATA_KEY_CHARS = 64
const MAX_METADATA_VALUE_CHARS = 4096

/** Snapshot persistence independent of the UI and provider implementations. */
export class ContextSnapshotStore {
  readonly root: string

  constructor(
    root: string,
    private readonly attachments: AttachmentStore,
    private readonly maxTextBytes: number,
  ) {
    this.root = resolve(root)
  }

  async capture(input: ContextCaptureInput, signal?: AbortSignal): Promise<ContextSnapshotRecord> {
    signal?.throwIfAborted()
    const base = normalizeBase(input)
    let content: StoredTextContext | StoredImageContext
    if (input.content.type === 'text') {
      if (Buffer.byteLength(input.content.text, 'utf8') > this.maxTextBytes) {
        throw new ContextPickerError(
          `captured text exceeds ${this.maxTextBytes} UTF-8 bytes`,
          'CONTEXT_PICKER_TEXT_TOO_LARGE',
        )
      }
      const language = optionalBoundedLine(input.content.language, 'language', MAX_LANGUAGE_CHARS)
      content = {
        type: 'text',
        text: input.content.text,
        ...(language === undefined ? {} : { language }),
      }
    } else {
      const bytes = decodeImage(input.content.data, this.attachments.imageLimits.maxImageBytes)
      const name = optionalBoundedLine(input.content.name, 'image name', MAX_IMAGE_NAME_CHARS)
      signal?.throwIfAborted()
      const attachment = await this.attachments.saveImage({
        data: bytes,
        mediaType: input.content.mediaType as ImageMediaType,
        ...(name === undefined ? {} : { name }),
      })
      signal?.throwIfAborted()
      content = { type: 'image', attachment }
    }

    const identity: SnapshotIdentity = { version: 1, ...base, content }
    const ref = digestIdentity(identity)
    const existing = await this.tryRead(ref)
    if (existing !== undefined) return existing
    const record: ContextSnapshotRecord = {
      ...identity,
      ref,
      capturedAt: Date.now(),
    }
    await this.persist(record)
    return await this.read(ref)
  }

  async read(ref: string): Promise<ContextSnapshotRecord> {
    assertReference(ref)
    let source: string
    try {
      source = await readFile(this.pathFor(ref), 'utf8')
    } catch (error: unknown) {
      if (isNodeError(error, 'ENOENT')) {
        throw new ContextPickerError(
          `Context Picker snapshot ${ref} does not exist`,
          'CONTEXT_PICKER_REFERENCE_NOT_FOUND',
          { cause: error },
        )
      }
      throw storageFailure(`failed to read Context Picker snapshot ${ref}`, error)
    }
    const record = parseRecord(source, this.maxTextBytes)
    if (record.ref !== ref || digestIdentity(identityOf(record)) !== ref) {
      throw new ContextPickerError(
        `Context Picker snapshot ${ref} failed its content-address check`,
        'CONTEXT_PICKER_STORAGE_FAILED',
      )
    }
    return record
  }

  private async tryRead(ref: string): Promise<ContextSnapshotRecord | undefined> {
    try {
      return await this.read(ref)
    } catch (error: unknown) {
      if (error instanceof ContextPickerError && error.code === 'CONTEXT_PICKER_REFERENCE_NOT_FOUND') {
        return undefined
      }
      throw error
    }
  }

  private async persist(record: ContextSnapshotRecord): Promise<void> {
    const target = this.pathFor(record.ref)
    const directory = dirname(target)
    const temporary = join(directory, `.${record.ref}.${process.pid}.${randomUUID()}.tmp`)
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      try {
        // A hard-link publishes without replacing an existing immutable object.
        await link(temporary, target)
      } catch (error: unknown) {
        if (!isNodeError(error, 'EEXIST')) throw error
      }
    } catch (error: unknown) {
      throw storageFailure(`failed to persist Context Picker snapshot ${record.ref}`, error)
    } finally {
      try {
        await unlink(temporary)
      } catch (error: unknown) {
        if (!isNodeError(error, 'ENOENT')) {
          // The immutable target is already authoritative; temporary cleanup
          // failure is best-effort and must not make a successful pick unusable.
        }
      }
    }
  }

  private pathFor(ref: string): string {
    assertReference(ref)
    return join(this.root, ref.slice(0, 2), `${ref}.json`)
  }
}

function normalizeBase(input: ContextCaptureInput): Omit<SnapshotIdentity, 'version' | 'content'> {
  if (!PROVIDER_PATTERN.test(input.providerId)) invalid('providerId has an invalid shape')
  const key = boundedString(input.key, 'key', MAX_KEY_CHARS)
  const label = boundedLine(input.label, 'label', MAX_LABEL_CHARS)
  const description = optionalBoundedLine(input.description, 'description', MAX_DESCRIPTION_CHARS)
  const revision = optionalBoundedLine(input.revision, 'revision', MAX_REVISION_CHARS)
  const metadata = normalizeMetadata(input.metadata)
  return {
    providerId: input.providerId,
    key,
    label,
    ...(description === undefined ? {} : { description }),
    ...(revision === undefined ? {} : { revision }),
    metadata,
  }
}

function normalizeMetadata(input: readonly ContextMetadataEntry[] | undefined): ContextMetadataEntry[] {
  if (input === undefined) return []
  if (input.length > MAX_METADATA_ENTRIES) invalid(`metadata has more than ${MAX_METADATA_ENTRIES} entries`)
  const seen = new Set<string>()
  const result = input.map((entry) => {
    const key = boundedLine(entry.key, 'metadata key', MAX_METADATA_KEY_CHARS)
    const value = boundedLine(entry.value, `metadata ${key}`, MAX_METADATA_VALUE_CHARS)
    if (seen.has(key)) invalid(`metadata key ${JSON.stringify(key)} is duplicated`)
    seen.add(key)
    return { key, value }
  })
  return result.sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value))
}

function decodeImage(data: string, maxBytes: number): Uint8Array {
  if (data.length === 0 || data.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new ContextPickerError('captured image exceeds the configured byte limit', 'CONTEXT_PICKER_IMAGE_LIMIT_EXCEEDED')
  }
  const bytes = Buffer.from(data, 'base64')
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes || bytes.toString('base64') !== data) {
    throw new ContextPickerError('captured image is not canonical base64 within the byte limit', 'CONTEXT_PICKER_INVALID_CAPTURE')
  }
  return bytes
}

function digestIdentity(identity: SnapshotIdentity): string {
  return createHash('sha256').update(JSON.stringify(identity), 'utf8').digest('hex')
}

function identityOf(record: ContextSnapshotRecord): SnapshotIdentity {
  return {
    version: 1,
    providerId: record.providerId,
    key: record.key,
    label: record.label,
    ...(record.description === undefined ? {} : { description: record.description }),
    ...(record.revision === undefined ? {} : { revision: record.revision }),
    metadata: record.metadata,
    content: record.content,
  }
}

function parseRecord(source: string, maxTextBytes: number): ContextSnapshotRecord {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error: unknown) {
    throw storageFailure('Context Picker snapshot is not valid JSON', error)
  }
  if (!isRecord(value) || value.version !== 1 || typeof value.ref !== 'string'
    || typeof value.providerId !== 'string' || typeof value.key !== 'string'
    || typeof value.label !== 'string' || !Array.isArray(value.metadata)
    || typeof value.capturedAt !== 'number' || !Number.isSafeInteger(value.capturedAt)
    || !isRecord(value.content)) {
    throw storageFailure('Context Picker snapshot has an invalid envelope')
  }
  if ((value.description !== undefined && typeof value.description !== 'string')
    || (value.revision !== undefined && typeof value.revision !== 'string')) {
    throw storageFailure('Context Picker snapshot optional metadata is invalid')
  }
  const baseInput: ContextCaptureInput = {
    providerId: value.providerId,
    key: value.key,
    label: value.label,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.revision === 'string' ? { revision: value.revision } : {}),
    metadata: value.metadata.map((entry): ContextMetadataEntry => {
      if (!isRecord(entry) || typeof entry.key !== 'string' || typeof entry.value !== 'string') {
        throw storageFailure('Context Picker snapshot metadata is invalid')
      }
      return { key: entry.key, value: entry.value }
    }),
    // normalizeBase intentionally ignores content; the real stored union is
    // validated below without ever accepting browser image bytes from disk.
    content: { type: 'text', text: 'shape-only' },
  }
  const base = normalizeBase(baseInput)
  let content: StoredTextContext | StoredImageContext
  if (value.content.type === 'text') {
    if (typeof value.content.text !== 'string'
      || (value.content.language !== undefined && typeof value.content.language !== 'string')
      || Buffer.byteLength(value.content.text, 'utf8') > maxTextBytes) {
      throw storageFailure('Context Picker text snapshot is invalid')
    }
    const language = optionalBoundedLine(value.content.language, 'language', MAX_LANGUAGE_CHARS)
    content = {
      type: 'text',
      text: value.content.text,
      ...(language === undefined ? {} : { language }),
    }
  } else if (value.content.type === 'image' && isImageAttachmentRef(value.content.attachment)) {
    content = { type: 'image', attachment: value.content.attachment }
  } else {
    throw storageFailure('Context Picker snapshot content is invalid')
  }
  return {
    version: 1,
    ref: value.ref,
    ...base,
    capturedAt: value.capturedAt,
    content,
  }
}

function isImageAttachmentRef(value: unknown): value is ImageAttachmentRef {
  if (!isRecord(value)) return false
  return typeof value.attachmentId === 'string'
    && isImageMediaType(value.mediaType)
    && Number.isSafeInteger(value.bytes) && (value.bytes as number) > 0
    && Number.isSafeInteger(value.width) && (value.width as number) > 0
    && Number.isSafeInteger(value.height) && (value.height as number) > 0
    && (value.name === undefined || typeof value.name === 'string')
}

function isImageMediaType(value: unknown): value is ContextImageMediaType {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function assertReference(ref: string): void {
  if (!CONTEXT_REFERENCE_PATTERN.test(ref)) {
    throw new ContextPickerError('Context Picker reference has an invalid shape', 'CONTEXT_PICKER_INVALID_REFERENCE')
  }
}

function boundedString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    invalid(`${name} must contain 1-${max} characters`)
  }
  return value as string
}

function boundedLine(value: unknown, name: string, max: number): string {
  const text = boundedString(value, name, max)
  if ([...text].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code === 0x7f || (code < 0x20 && code !== 0x09)
  })) invalid(`${name} must be a single printable line`)
  return text
}

function optionalBoundedLine(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined
  return boundedLine(value, name, max)
}

function invalid(message: string): never {
  throw new ContextPickerError(message, 'CONTEXT_PICKER_INVALID_CAPTURE')
}

function storageFailure(message: string, cause?: unknown): ContextPickerError {
  return new ContextPickerError(
    message,
    'CONTEXT_PICKER_STORAGE_FAILED',
    cause === undefined ? undefined : { cause },
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}
