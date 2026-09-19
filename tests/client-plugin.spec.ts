import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import type { ContextPickerClientService } from '../src/client/service.ts'

describe('Context Picker client plugin', () => {
  it('captures through the dynamically mounted Remote namespace', async () => {
    const ctx = new Context()
    const capture = vi.fn(async () => ({
      ok: true as const,
      value: {
        ref: 'a'.repeat(64),
        mention: `@[selection](dsh-context:v1:${'a'.repeat(64)})`,
        label: 'selection',
        contentType: 'text' as const,
      },
    }))
    const namespace = {
      capture,
      recent: vi.fn(async () => ({ ok: true as const, value: [] })),
    }

    class RemoteService extends Service {
      constructor(private readonly ownerCtx: Context) {
        super(ownerCtx, 'remote')
      }

      async $mount(): Promise<() => Promise<void>> {
        const namespaceFiber = this.ownerCtx.plugin({
          apply: (scope) => { scope.provide('remote.contextPickerHost', namespace) },
        })
        await namespaceFiber
        return namespaceFiber.dispose
      }
    }

    new RemoteService(ctx)
    ctx.provide('locale', {
      bind: () => (key: string) => key,
      register: () => () => {},
    })
    ctx.provide('inputTriggers', { registerSource: () => () => {} })

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber
    const picker = ctx.get('contextPicker') as ContextPickerClientService
    picker.registerProvider({
      id: 'test-provider',
      label: 'Test contexts',
      candidates: () => [{
        key: 'one',
        label: 'selection',
        content: { type: 'text', text: 'private until picked' },
      }],
    })

    const sessionId = 'session-1' as SessionId
    const candidates = await picker.discover(sessionId, '', new AbortController().signal)
    const mention = await picker.serialize(candidates[0]!.ref, new AbortController().signal)

    expect(mention).toContain('dsh-context:v1:')
    expect(capture).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ providerId: 'test-provider', key: 'one' }),
      expect.any(AbortSignal),
    )
    await fiber.dispose()
  })
})
