# dsh-context-picker

An extensible inline context picker for DeepSeek Harness. Type `@` in the composer to pick clipboard text, clipboard images, recent DSH messages, or contexts contributed by another plugin such as the active `dsh-file-manager` Monaco selection.

The result is an atomic reference chip that can be mixed with normal prose. This is an additive standalone DSH Bundle: it neither patches Harness source nor replaces the built-in file/session reference source.

## Development

```powershell
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm test
pnpm dev
```

Clipboard data can originate in another process or application because the Web client uses the operating-system Clipboard API. Browser security still controls access. Merely opening the menu does not upload clipboard data: a candidate stays in browser memory until the user picks it.

Context-source plugins implement the public `dsh-context-picker/provider` contract and optionally register with `ctx.contextPicker`. They do not depend on composer internals, durable reference grammar, storage, or model-message assembly. See the [architecture and Provider contract](docs/architecture.md) and the [Chinese guide](README.zh.md).

## License

MIT
