/** Localized labels owned by the Context Picker aggregation layer. */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

export const NS = 'context-picker'

export const zh = {
  'clipboard.section': '剪贴板',
  'clipboard.text': '剪贴板文本',
  'clipboard.image': '剪贴板图片',
  'recent.section': 'DSH 最近消息',
  'recent.user': '用户 · {preview}',
  'recent.assistant': 'AI · {preview}',
} satisfies Record<string, string>

export type ContextPickerLocaleKey = keyof typeof zh

export const en = {
  'clipboard.section': 'Clipboard',
  'clipboard.text': 'Clipboard text',
  'clipboard.image': 'Clipboard image',
  'recent.section': 'Recent DSH messages',
  'recent.user': 'You · {preview}',
  'recent.assistant': 'AI · {preview}',
} satisfies Record<ContextPickerLocaleKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'context-picker': ContextPickerLocaleKey
  }
}

export type ContextPickerTranslate =
  import('@deepseek-ai/dsh-client-ui-slots').TranslateNS<typeof NS>
