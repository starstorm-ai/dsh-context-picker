/** Tag-safe JSON for model-visible untrusted context envelopes. */

export function stringifyTagSafeJson(value: unknown): string {
  const serialized: unknown = JSON.stringify(value)
  if (typeof serialized !== 'string') throw new TypeError('context-picker value is not JSON-serializable')
  return serialized.replaceAll('<', '\\u003c')
}
