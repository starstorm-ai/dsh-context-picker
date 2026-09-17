import { describe, expect, it } from 'vitest'
import {
  encodeContextReferenceUri,
  formatContextReferenceMention,
  parseContextReferenceText,
} from '../src/uri.ts'

const REF = '0123456789abcdef'.repeat(4)

describe('Context Picker reference grammar', () => {
  it('round-trips escaped labels and canonical refs', () => {
    const mention = formatContextReferenceMention({ ref: REF, label: String.raw`a]b\c` })
    expect(mention).toBe(String.raw`@[a\]b\\c](dsh-context:v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef)`)
    expect(parseContextReferenceText(`inspect ${mention}`)).toEqual({
      text: String.raw`inspect @a]b\c`,
      references: [{ ref: REF, label: String.raw`a]b\c` }],
    })
  })

  it('recognizes a bare URI and rejects non-canonical references', () => {
    expect(parseContextReferenceText(`use ${encodeContextReferenceUri(REF)}`).references)
      .toEqual([{ ref: REF, label: REF }])
    expect(() => parseContextReferenceText('@[bad](dsh-context:v1:not-a-ref)')).toThrow(/invalid/i)
  })
})
