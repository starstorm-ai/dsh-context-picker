import type { SessionSurfaceSnapshot } from '@deepseek-ai/dsh-session-query'
import { describe, expect, it } from 'vitest'
import { recentMessageCandidates } from '../src/host/recent.ts'

describe('recentMessageCandidates', () => {
  it('returns newest direct user/model text and excludes synthetic context', () => {
    const snapshot = {
      session: { id: 'session-1' },
      events: [
        {
          type: 'user/message', seq: 1, time: 10, surfaceOp: 'append',
          data: { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'first question' }] },
        },
        {
          type: 'user/message', seq: 2, time: 20, surfaceOp: 'append',
          data: { id: 'p1', role: 'user', source: { kind: 'plugin', plugin: 'test' }, content: [{ type: 'text', text: 'hidden context' }] },
        },
        {
          type: 'assistant/message', seq: 3, time: 30, surfaceOp: 'append',
          data: {
            turn: 1,
            step: 1,
            message: {
              id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
              content: [{ type: 'text', text: 'latest answer' }],
            },
          },
        },
      ],
    } as unknown as SessionSurfaceSnapshot
    const candidates = recentMessageCandidates(snapshot, '', 10, 1024)
    expect(candidates.map(candidate => [candidate.role, candidate.content])).toEqual([
      ['assistant', { type: 'text', text: 'latest answer' }],
      ['user', { type: 'text', text: 'first question' }],
    ])
    expect(recentMessageCandidates(snapshot, 'question', 10, 1024)).toHaveLength(1)
  })
})
