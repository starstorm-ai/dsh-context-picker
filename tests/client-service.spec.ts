import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { ContextPickerClientService } from '../src/client/service.ts'

describe('ContextPickerClientService', () => {
  it('keeps discovery local, captures on pick, and shares capture with serialization', async () => {
    const ctx = new Context()
    const capture = vi.fn(async () => ({
      ref: 'a'.repeat(64),
      mention: `@[selection](dsh-context:v1:${'a'.repeat(64)})`,
      label: 'selection',
      contentType: 'text' as const,
    }))
    const fiber = ctx.plugin(ContextPickerClientService, { capture })
    await fiber
    const service = ctx.contextPicker
    service.registerProvider({
      id: 'test-provider',
      label: 'Test contexts',
      candidates: () => [{
        key: 'one',
        label: 'selection',
        content: { type: 'text', text: 'private until picked' },
        appearance: 'file',
      }],
    })
    const candidates = await service.discover('session-1' as SessionId, '', new AbortController().signal)
    expect(candidates).toHaveLength(1)
    expect(capture).not.toHaveBeenCalled()
    service.commit(candidates[0]!.ref)
    const mention = await service.serialize(candidates[0]!.ref, new AbortController().signal)
    expect(mention).toContain('dsh-context:v1:')
    expect(capture).toHaveBeenCalledOnce()
    await fiber.dispose()
  })
})
