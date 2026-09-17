# Architecture

## Ownership boundaries

Context Picker is one installable dual-face DSH plugin with four internal layers:

1. Providers observe their own source and return immutable browser-safe candidates.
2. The Web registry aggregates Providers into one additional `@` trigger source and renders atomic reference chips.
3. The Host snapshot repository validates and content-addresses selected text or images.
4. The Host pre-step resolver expands canonical refs into explicitly untrusted model context.

`dsh-file-manager` owns Monaco state and implements only layer 1. Context Picker never imports File Manager, and File Manager's dependency on the Provider SDK is an optional peer dependency. Cordis optional injection makes either plugin load order valid and keeps File Manager functional when Context Picker is absent.

## Pick lifecycle

```text
Provider candidate
    -> browser-local staged payload
    -> user picks row
    -> async Host capture starts
    -> input contains an atomic local ref chip
    -> submit codec awaits capture
    -> canonical dsh-context:v1:<sha256> mention
    -> Host pre-step loads immutable snapshot
    -> readable direct prompt + separate untrusted context message
```

Discovery never writes Host state. This matters especially for clipboard Providers: permission to preview a menu is not treated as consent to persist every clipboard value. Capture starts only from the synchronous pick handler, while the asynchronous reference codec provides the send-time completion barrier.

## Provider contract

`ContextPickerProvider` has a stable `id`, a menu `label`, optional ordering, and a cancellable `candidates` method. Each candidate contains:

- `key`: stable source identity;
- `revision`: optional immutable source revision;
- `label` and optional description/appearance;
- flat provenance metadata;
- exact text or base64 image content.

The aggregator includes the addressed Session and the full normalized payload in its browser-local SHA-256 staging key. Repeated menu queries reuse the same staged object. Provider errors are isolated per Provider and do not hide healthy sources.

Provider code must snapshot current content rather than return a path that the Host rereads later. This preserves unsaved editor buffers and prevents a time-of-check/time-of-use change between selection and send.

## Durable reference and storage

The canonical URI is `dsh-context:v1:<64 lowercase hex characters>`. The digest covers normalized provider identity, source key/revision, presentation metadata, and stored content. Image bytes first pass through DSH's attachment service; the snapshot then addresses the verified attachment reference.

Records are published atomically as immutable JSON objects below `$DSH_HOME/context-picker/v1/snapshots/<prefix>/`. Reads recompute the digest and reject missing, malformed, or altered records. Repeated identical captures deduplicate.

## Model boundary

Only canonical refs in direct `source.kind === "user"` messages are expanded. The pre-step hook:

- replaces opaque mention syntax with readable `@label` text;
- enforces the distinct-ref and aggregate-image limits;
- emits a separate `source.kind === "context-picker", form === "recall"` user message;
- serializes text inside tag-safe JSON;
- marks every selected item as untrusted, read-only background data;
- emits stored image attachment blocks through the normal DSH image path.

Resolver failures reject the send. A missing snapshot, failed attachment, malformed ref, or exceeded budget is never silently downgraded to plain text.

## File Manager integration

The File Manager adapter records only non-empty Monaco selections. Its snapshot contains the Session, workspace-relative path, language, exact selected text, normalized line/column range, and Monaco model revision. Content changes inside an existing selection republish it, so unsaved edits are represented exactly.

The last selection is retained when the File view unmounts so the user can switch back to Chat and reference it. It is cleared by an empty selection, a file without a usable editor, or Session teardown.
