import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextSnapshotStore } from '../src/host/store.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function attachments(): AttachmentStore {
  const ref: ImageAttachmentRef = {
    attachmentId: 'attachment-test' as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
    name: 'clip.png',
  }
  return {
    imageLimits: {
      maxImageBytes: 1024,
      maxImagesPerMessage: 4,
      maxMessageImageBytes: 4096,
      maxImagePixels: 1024,
      maxImageDimension: 32,
      mediaTypes: ['image/png'],
    },
    saveImage: vi.fn(async () => ref),
  } as unknown as AttachmentStore
}

async function store(maxTextBytes = 1024): Promise<ContextSnapshotStore> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-context-picker-'))
  roots.push(root)
  return new ContextSnapshotStore(root, attachments(), maxTextBytes)
}

describe('ContextSnapshotStore', () => {
  it('deduplicates identical text captures and verifies the durable object', async () => {
    const repository = await store()
    const input = {
      providerId: 'test-provider',
      key: 'selection',
      label: 'Picked text',
      metadata: [{ key: 'path', value: 'src/main.ts' }],
      content: { type: 'text' as const, text: 'const answer = 42', language: 'typescript' },
    }
    const first = await repository.capture(input)
    const second = await repository.capture(input)
    expect(second.ref).toBe(first.ref)
    expect(await repository.read(first.ref)).toEqual(first)
    const serialized = await readFile(join(repository.root, first.ref.slice(0, 2), `${first.ref}.json`), 'utf8')
    expect(serialized).toContain('const answer = 42')
  })

  it('rejects text beyond its UTF-8 budget', async () => {
    const repository = await store(3)
    await expect(repository.capture({
      providerId: 'test-provider',
      key: 'too-large',
      label: 'Too large',
      content: { type: 'text', text: '四个字' },
    })).rejects.toMatchObject({ code: 'CONTEXT_PICKER_TEXT_TOO_LARGE' })
  })

  it('promotes canonical base64 through the attachment service', async () => {
    const attachmentStore = attachments()
    const root = await mkdtemp(join(tmpdir(), 'dsh-context-picker-'))
    roots.push(root)
    const repository = new ContextSnapshotStore(root, attachmentStore, 1024)
    const captured = await repository.capture({
      providerId: 'clipboard',
      key: 'image',
      label: 'Clipboard image',
      content: { type: 'image', mediaType: 'image/png', data: 'YWJj', name: 'clip.png' },
    })
    expect(captured.content.type).toBe('image')
    expect(attachmentStore.saveImage).toHaveBeenCalledOnce()
  })
})
