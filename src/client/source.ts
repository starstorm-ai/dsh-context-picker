/** One @ source that aggregates every registered Context Picker Provider. */

import type {
  InputTriggerSource,
  InputTriggerCandidate,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { ContextPickerClientService } from './service.ts'

export function createContextPickerSource(service: ContextPickerClientService): InputTriggerSource {
  return {
    trigger: '@',
    name: 'context-picker',
    order: 20,
    showGroupTitle: false,
    async candidates(session, { query, signal }) {
      const candidates = await service.discover(session.sessionId, query, signal)
      return candidates.map((candidate): InputTriggerCandidate => ({
        name: candidate.label,
        ...(candidate.description === undefined ? {} : { description: candidate.description }),
        ...(candidate.appearance === undefined ? {} : { icon: candidate.appearance }),
        section: candidate.section,
        value: candidate.ref,
      }))
    },
    onPick({ candidate, action }) {
      if (action !== 'pick' || candidate.value === undefined) return undefined
      const staged = service.describe(candidate.value)
      if (staged === undefined) return undefined
      service.commit(candidate.value)
      return {
        insert: {
          source: 'context-picker',
          ref: candidate.value,
          label: staged.label,
          ...(staged.appearance === undefined ? {} : { appearance: staged.appearance }),
          clipboardText: service.clipboardText(candidate.value),
        },
      }
    },
    codec: {
      clipboardText: ref => service.clipboardText(ref),
      serialize: (ref, signal) => service.serialize(ref, signal),
    },
  }
}
