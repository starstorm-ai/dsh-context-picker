/** Built-in Provider backed by the Host's exact current Session surface. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ContextPickerProvider } from '../provider.ts'
import type { RecentMessageCandidate } from '../types.ts'
import type { ContextPickerTranslate } from './locales.ts'

export interface RecentMessageRemote {
  recent(
    sessionId: SessionId,
    query: string,
    signal: AbortSignal,
  ): Promise<readonly RecentMessageCandidate[]>
}

export function createRecentMessageProvider(
  remote: RecentMessageRemote,
  t: ContextPickerTranslate,
): ContextPickerProvider {
  return {
    id: 'dsh-recent',
    label: t('recent.section'),
    order: 20,
    async candidates(sessionId, { query, signal }) {
      const candidates = await remote.recent(sessionId, query, signal)
      return candidates.map(candidate => ({
        ...candidate,
        label: t(candidate.role === 'user' ? 'recent.user' : 'recent.assistant', {
          preview: candidate.label,
        }),
        description: new Intl.DateTimeFormat(undefined, {
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(candidate.time),
      }))
    },
  }
}
