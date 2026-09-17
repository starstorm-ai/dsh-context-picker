# dsh-context-picker

DeepSeek Harness 的可扩展上下文选择器。它保留 DSH 原有输入方式，在聊天输入框输入 `@` 即可选择：

- 剪贴板文本
- 剪贴板图片
- 当前 DSH 会话的最近用户／AI 消息
- 其他插件注册的上下文，例如 `dsh-file-manager` 当前 Monaco 选区

选择结果在输入框中显示为原子 ref chip，可以和普通文字混排。插件不修改 DeepSeek Harness 源码，也不替换内置的文件／会话 `@` 引用源。

## 安装与开发

```powershell
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm test
pnpm dev
```

`pnpm dev` 使用仓库内隔离的 `.tmp/dsh-home` 启动 Web Profile。发布构建和测试方式沿用 `dsh-file-manager` 的独立 Bundle 工作流。

## 剪贴板范围

浏览器通过系统 Clipboard API 读取剪贴板，因此能读取在其他进程、其他应用或文件工具中复制的文本和图片。浏览器仍可能要求 HTTPS／本机安全上下文、页面焦点和一次用户授权；操作系统或浏览器拒绝权限时，对应候选不会出现，其他 Provider 不受影响。

候选菜单打开时，剪贴板内容只暂存在浏览器内存。只有用户真正选择候选后，插件才把快照提交给 DSH Host；发送动作会等待该快照持久化完成。

## Provider SDK

第三方 Web 插件只依赖 `dsh-context-picker/provider` 的类型，并把 Provider 注册到 `ctx.contextPicker`：

```ts
import type { ContextPickerProvider } from 'dsh-context-picker/provider'
import type {} from 'dsh-context-picker/client'

const provider: ContextPickerProvider = {
  id: 'my-editor',
  label: 'My Editor selection',
  candidates(sessionId, { query, signal }) {
    signal.throwIfAborted()
    return [{
      key: 'active-selection',
      revision: 'buffer-v42',
      label: 'Current selection',
      content: { type: 'text', text: 'selected text', language: 'typescript' },
      appearance: 'file',
    }]
  },
}

ctx.inject(['contextPicker'], (scope) => {
  scope.effect(() => scope.contextPicker.registerProvider(provider))
})
```

Provider 只负责给出不可变候选，不需要知道输入框、ref URI、Host 存储或模型消息格式。完整边界和生命周期见[架构说明](docs/architecture.md)。

## 数据与限额

- 文本默认每个快照最多 256 KiB UTF-8。
- 一条直接用户消息默认最多展开 12 个不同 ref。
- 最近消息默认显示 12 条，只包括直接用户消息和 AI 消息，不包括插件合成上下文。
- 图片复用 DSH `ctx.attachments` 的格式校验、规范化、内容寻址存储和消息总量限制。
- 快照位于 `$DSH_HOME/context-picker/v1/snapshots`，ID 是规范化快照的 SHA-256。

配置项位于 `cordis.patch.yml`，也可在 DSH Bundle 配置中覆盖。

## License

MIT
