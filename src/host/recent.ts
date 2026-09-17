/** Projection of recent first-party conversation messages into provider candidates. */

import type { Message } from '@deepseek-ai/dsh-llm'
import type { SessionSurfaceSnapshot } from '@deepseek-ai/dsh-session-query'
import type { RecentMessageCandidate } from '../types.ts'

export function recentMessageCandidates(
  snapshot: SessionSurfaceSnapshot,
  query: string,
  limit: number,
  maxTextBytes: number,
): RecentMessageCandidate[] {
  const needle = query.trim().toLocaleLowerCase()
  const result: RecentMessageCandidate[] = []
  for (let index = snapshot.events.length - 1; index >= 0 && result.length < limit; index -= 1) {
    const event = snapshot.events[index]
    if (event === undefined) continue
    let role: 'user' | 'assistant'
    let message: Message
    if (event.type === 'user/message') {
      if (event.data.source.kind !== 'user') continue
      role = 'user'
      message = event.data
    } else if (event.type === 'assistant/message') {
      role = 'assistant'
      message = event.data.message
    } else {
      continue
    }
    const raw = message.content
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('\n')
      .trim()
    if (raw === '') continue
    const text = truncateUtf8(raw, maxTextBytes)
    const search = `${role} ${text}`.toLocaleLowerCase()
    if (needle !== '' && !search.includes(needle)) continue
    result.push({
      key: String(message.id),
      label: preview(text),
      revision: `${String(event.seq)}:${String(message.id)}`,
      metadata: [
        { key: 'messageId', value: String(message.id) },
        { key: 'role', value: role },
        { key: 'seq', value: String(event.seq) },
        { key: 'sessionId', value: String(snapshot.session.id) },
        { key: 'time', value: String(event.time) },
      ],
      content: { type: 'text', text },
      appearance: 'session',
      role,
      time: event.time,
    })
  }
  return result
}

function preview(text: string): string {
  const line = text.replace(/\s+/gu, ' ').trim()
  return line.length <= 72 ? line : `${line.slice(0, 71)}…`
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const suffix = '\n[…truncated by Context Picker]'
  const suffixBytes = Buffer.byteLength(suffix, 'utf8')
  const target = Math.max(0, maxBytes - suffixBytes)
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(text.slice(0, middle), 'utf8') <= target) low = middle
    else high = middle - 1
  }
  return `${text.slice(0, low)}${suffix}`
}
