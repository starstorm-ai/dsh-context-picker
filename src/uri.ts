/** Canonical durable Context Picker URI and inline mention grammar. */

import { ContextPickerError } from './config.ts'

export const CONTEXT_REFERENCE_SCHEME = 'dsh-context:v1:'
export const CONTEXT_REFERENCE_PATTERN = /^[a-f0-9]{64}$/u

export interface ContextReferenceInput {
  readonly ref: string
  readonly label?: string
}

export function encodeContextReferenceUri(ref: string): string {
  if (!CONTEXT_REFERENCE_PATTERN.test(ref)) throw invalidReference(ref)
  return `${CONTEXT_REFERENCE_SCHEME}${ref}`
}

export function decodeContextReferenceUri(uri: string): string {
  if (!uri.startsWith(CONTEXT_REFERENCE_SCHEME)) throw invalidReference(uri)
  const ref = uri.slice(CONTEXT_REFERENCE_SCHEME.length)
  if (!CONTEXT_REFERENCE_PATTERN.test(ref) || encodeContextReferenceUri(ref) !== uri) {
    throw invalidReference(uri)
  }
  return ref
}

export function formatContextReferenceMention(reference: ContextReferenceInput): string {
  const label = escapeLabel(reference.label ?? reference.ref)
  return `@[${label}](${encodeContextReferenceUri(reference.ref)})`
}

export interface ParsedContextReferenceText {
  readonly text: string
  readonly references: ContextReferenceInput[]
}

/** Extract canonical Markdown mentions and bare URIs in appearance order. */
export function parseContextReferenceText(text: string): ParsedContextReferenceText {
  const references: ContextReferenceInput[] = []
  const pattern = /@\[((?:\\.|[^\\\]])*)\]\((dsh-context:v1:[^\s)]*)\)|(dsh-context:v1:[a-f0-9]+)/gu
  const rendered = text.replace(pattern, (
    _match,
    rawLabel: string | undefined,
    markdownUri: string | undefined,
    bareUri: string | undefined,
  ) => {
    const uri = markdownUri ?? bareUri
    if (uri === undefined) throw invalidReference('missing URI')
    const ref = decodeContextReferenceUri(uri)
    const label = rawLabel === undefined ? ref : unescapeLabel(rawLabel)
    references.push({ ref, label })
    return `@${label}`
  })
  return { text: rendered, references }
}

function escapeLabel(label: string): string {
  return label.replace(/[\\\]]/gu, match => `\\${match}`)
}

function unescapeLabel(label: string): string {
  return label.replace(/\\(.)/gu, '$1')
}

function invalidReference(value: string): ContextPickerError {
  return new ContextPickerError(
    `invalid Context Picker reference ${JSON.stringify(value)}`,
    'CONTEXT_PICKER_INVALID_REFERENCE',
  )
}
