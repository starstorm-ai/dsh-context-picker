import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClipboardProvider } from '../src/client/clipboard-provider.ts'
import type { ContextPickerTranslate } from '../src/client/locales.ts'

const sessionId = 'clipboard-session' as SessionId
const labels = {
  'clipboard.section': 'Clipboard',
  'clipboard.text': 'Clipboard text',
  'clipboard.image': 'Clipboard image',
} as const
const t = ((key: keyof typeof labels) => labels[key]) as ContextPickerTranslate

afterEach(() => { vi.unstubAllGlobals() })

describe('Clipboard Provider display labels', () => {
  it('puts a normalized text preview in the picked-reference label', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        readText: vi.fn(async () => 'const answer = 42\nconsole.log(answer)'),
      },
    })
    const provider = createClipboardProvider(t)
    const candidates = await provider.candidates(sessionId, {
      query: '',
      signal: new AbortController().signal,
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      label: 'Clipboard text · const answer = 42 console.log(answer)',
      content: {
        type: 'text',
        text: 'const answer = 42\nconsole.log(answer)',
      },
    })
  })

  it('puts the generated image name and size in the picked-reference label', async () => {
    const bytes = new Uint8Array(1536)
    vi.stubGlobal('navigator', {
      clipboard: {
        read: vi.fn(async () => [{
          types: ['image/png'],
          getType: vi.fn(async () => new Blob([bytes], { type: 'image/png' })),
        }]),
      },
    })
    const provider = createClipboardProvider(t)
    const candidates = await provider.candidates(sessionId, {
      query: 'Clipboard image',
      signal: new AbortController().signal,
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      label: 'Clipboard image · clipboard.png · 1.5 KiB',
      description: 'image/png',
      content: {
        type: 'image',
        mediaType: 'image/png',
        name: 'clipboard.png',
      },
    })
  })
})
