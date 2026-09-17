/** Browser clipboard provider; reads the OS clipboard only while its @ menu is queried. */

import type { ContextPickerProvider } from '../provider.ts'
import type { ContextCandidate, ContextImageMediaType } from '../types.ts'
import type { ContextPickerTranslate } from './locales.ts'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export function createClipboardProvider(t: ContextPickerTranslate): ContextPickerProvider {
  return {
    id: 'clipboard',
    label: t('clipboard.section'),
    order: 10,
    async candidates(_sessionId, { query, signal }) {
      const textLabel = t('clipboard.text')
      const imageLabel = t('clipboard.image')
      const wantsText = matches(query, textLabel)
      const wantsImage = matches(query, imageLabel)
      if (!wantsText && !wantsImage) return []
      const clipboard = globalThis.navigator?.clipboard
      if (clipboard === undefined) return []
      signal.throwIfAborted()
      let text: string | undefined
      let image: { type: ContextImageMediaType; blob: Blob } | undefined

      if ('read' in clipboard && typeof clipboard.read === 'function') {
        try {
          const items = await clipboard.read()
          signal.throwIfAborted()
          for (const item of items) {
            if (wantsText && text === undefined && item.types.includes('text/plain')) {
              text = await (await item.getType('text/plain')).text()
            }
            if (wantsImage && image === undefined) {
              const type = IMAGE_TYPES.find(candidate => item.types.includes(candidate))
              if (type !== undefined) image = { type, blob: await item.getType(type) }
            }
            if ((!wantsText || text !== undefined) && (!wantsImage || image !== undefined)) break
          }
        } catch (error: unknown) {
          if (signal.aborted) throw signal.reason
          // Some browsers expose read() but permit readText() only.
          if (!wantsText) throw error
        }
      }

      if (wantsText && text === undefined && typeof clipboard.readText === 'function') {
        text = await clipboard.readText()
      }
      signal.throwIfAborted()
      const candidates: ContextCandidate[] = []
      if (wantsText && text !== undefined && text.length > 0) {
        const textPreview = preview(text)
        candidates.push({
          key: 'text',
          label: `${textLabel} · ${textPreview}`,
          revision: await digest(new TextEncoder().encode(text)),
          content: { type: 'text', text },
        })
      }
      if (wantsImage && image !== undefined) {
        const bytes = new Uint8Array(await image.blob.arrayBuffer())
        signal.throwIfAborted()
        const imageName = `clipboard.${extension(image.type)}`
        candidates.push({
          key: 'image',
          label: `${imageLabel} · ${imageName} · ${formatBytes(bytes.byteLength)}`,
          description: image.type,
          revision: await digest(bytes),
          content: {
            type: 'image',
            mediaType: image.type,
            data: toBase64(bytes),
            name: imageName,
          },
          appearance: 'file',
        })
      }
      return candidates
    },
  }
}

function matches(query: string, label: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return needle === '' || label.toLocaleLowerCase().includes(needle)
}

function preview(text: string): string {
  const value = text.replace(/\s+/gu, ' ').trim()
  return value.length <= 100 ? value : `${value.slice(0, 99)}…`
}

async function digest(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function extension(type: ContextImageMediaType): string {
  if (type === 'image/jpeg') return 'jpg'
  return type.slice('image/'.length)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
