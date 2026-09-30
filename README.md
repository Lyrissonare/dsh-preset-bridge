# dsh-preset-bridge — 模式目录桥接

把 0.1.x 惯例的**预设目录**（`~/.dsh/.agent-presets/<id>/`）重新接入 DSH **桌面版 0.2.x** 的模式列表。

> **DSH 桌面版 0.2.0 移除了预设目录扫描**：官方文档明确「注册表不扫描目录，也不接受 preset 路径」。于是升级桌面版后，`router-standard`、`router-spec` 之类以目录形式安装的模式会全部从模式选择器消失（网页版 0.1.x 运行时仍自带扫描，不受影响）。本插件把这条发现通道补回来。

**⚠️ 先读[限制与不保证](#️-限制与不保证生效)** —— 本插件不保证对你的预设生效，且属于过渡期补丁。

---

## 安装

### 推荐方式：把网址发给 AI，由其自行安装

把本仓库地址直接发给 DSH 会话里的 AI（例如桌面端或网页版里说一句）：

> 帮我安装 https://github.com/Lyrissonare/dsh-preset-bridge 这个插件到桌面版 profile，装好后重启验证模式列表。

AI 会自行完成装配、登记 bundles、重启并检查 `~/.dsh/preset-bridge.log` 与模式菜单——这比手动执行命令更能发现环境差异（不同机器上预设引用的包不同，可能需要补兼容映射，AI 可以当场处理）。

### 手动方式

```powershell
D:\DSH\resources\runtime\cli\bin\dsh.cmd plugin --profile desktop add https://github.com/Lyrissonare/dsh-preset-bridge
```

然后**重启桌面端**。验证：新建会话 → 模式选择器应出现 `.agent-presets` 下的各预设；或打开 设置 → Agent 预设 → 自定义。

> 每次修改 `~/.dsh/.agent-presets/` 里的预设后，需要重启桌面端才会重新注册。

## ⚠️ 限制与不保证生效

**使用本插件前请务必理解以下各条。它是一个过渡期补丁，不是官方功能。**

1. **只适用于 0.2.x 桌面版 profile，不要装到 0.1.x 环境。** 网页版 / 0.1.x 运行时自带目录扫描（`dsh-agent-presets` 组件提供同名 `agentPresets` 服务），再注入一个提供方会冲突。本插件声明了 `engines.dsh: >=0.2.0-rc <0.3.0-0`，超出版本应被安装预检干净拒绝。
2. **能被"发现"≠能"健康挂载"。** 本插件把预设注册进注册表，但预设内容自身的 0.2.x 兼容性它管不了。健康的预设出现在模式菜单；挂载失败的预设会显示在 设置 → Agent 预设 → 自定义 里并带「加载失败」徽标及原因（菜单只列健康预设）。
3. **兼容映射是逐个积累的，当前只覆盖已知的坑。** 已处理的唯一一条：`@deepseek-ai/dsh-workflow-worker-thread`（0.1.x 的 workflowEngine 提供方，0.2.0 已删除）→ 原位替换为官方的 `@deepseek-ai/dsh-workflow-ptc`。如果你的预设还引用了其他被 0.2.0 移除的包，仍会挂载失败——需要往 `lib/index.js` 里补对应映射。引用越"纯官方包"的预设，生效概率越高。
4. **引擎行为差异。** worker-thread 与 workflow-ptc 是两种不同的引擎实现（线程池 vs spawn 子进程），工作流类预设的运行细节可能有微妙差异。替换是对齐官方 0.2.x 的推荐做法，但若你的预设依赖 worker-thread 的特定行为，属于已知差异，不承诺一致。
5. **DSH 大版本更新可能使其失效。** 桥接依赖 0.2.0 的内部约定（`agentPresets.register` 的定义形状、挂载审计规则、isolate 语义、`!!js` 方言、`ctx.effect` 语义）。0.3.0+ 这些随时可能变化——声明了版本上界，届时应被预检拒绝而不是静默失效。失效的后果是良性的：预设从菜单消失，应用本身照常工作，`~/.dsh/preset-bridge.log` 会记录原因。
6. **过渡期补丁，随时可能退役。** 上游修复后（routing-suite 发布 0.2.x 适配，或 DSH 官方恢复/官方化目录发现），请直接卸载本插件、卸载方式：桌面端 设置 → 插件 → dsh-preset-bridge → 卸载。预设目录本身始终是唯一事实来源，不受任何影响。
7. **本插件按"现状"提供，不作任何保证。** 见 LICENSE（MIT）。作者不对因使用本插件造成的任何问题负责。

## 与其他预设的兼容性实测

| 预设 | 结果 |
|---|---|
| router-standard / router-spec / router-react（dsh-routing-suite） | ✅ 需 worker-thread → workflow-ptc 映射（插件已内置） |
| liangshen | ✅ 同上 |
| anchored-standard | ✅ 同上 |
| codex-document-mode | ✅ 零修改直接通过（不引用工作流） |

## 排障

- 日志：`~/.dsh/preset-bridge.log`（桌面端 host 的 ctx.logger 不落盘，插件自己写文件）。
- 预设没出现在菜单：先看 设置 → Agent 预设 → 自定义 里是否带「加载失败」徽标及原因；再看 bridge.log。
- 新增/修改预设后必须重启桌面端（预设目录变化不触发热加载）。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: dsh-preset-bridge
  config:
    roots:   # 额外扫描目录；缺省只扫 ${DSH_HOME:-~/.dsh}/.agent-presets
      - D:/somewhere/else/presets
```

## 实现细节（血泪坑，贡献者/魔改前必读）

- **相对行名必须改写为绝对 `file:` URL**：0.2.0 注册表挂载预设时按「声明处 baseUrl」解析 `./xxx.mjs` 相对名，而所有声明都落在注册表自己的包地址上，预设目录里的本地脚本（router-core-v34.mjs 等）会解析失败。挂载前把 `./` 开头的行名（含 `?v=` 缓存戳）重写为 `pathToFileURL` 绝对地址。
- **`@deepseek-ai/dsh-workflow-worker-thread` 已被 0.2.0 移除**：0.1.x 时代预设的 delegation 组普遍自带这一行当 workflowEngine 提供方；0.2.0 只剩接缝包 `dsh-workflow` 和官方提供方 `dsh-workflow-ptc`（provider: spawn，同组 isolate 语义一致）。提供方行导入失败会让同组 tool-workflow / tool-ralph 永远 "waiting for workflowEngine" → 预设被判 broken、模式菜单不显示。插件在注册前原位替换行名（组、isolate、config 形状均不变）。
- **提供方行不能裸插在预设顶层**：预设审计要求服务发布必须落在带 `isolate: { workflowEngine: true }` 的 `cordis:group` 组里，裸行会报 "Preset services require isolate realms"。所以只做「同组原位替换」，不做顶层注入。
- **`!!js` 节点**要构造成 `{ __jsExpr: ... }` 惰性表达式节点（与 cordis-plugin-include 的 entryListSchema 同构），由 Loader 在条目激活时求值；不能在解析期 eval。
- **本 cordis 的 `ctx.effect(setup)` 语义**：setup 立即执行、其返回值才是清理函数（React useEffect 式）。直接把 async 清理函数当 setup 传会导致注册完立刻反注册。
- 预设重名（与内置或彼此撞 id）时注册表会抛错：捕获后告警跳过，不让单个坏预设拖垮其余注册。

## License

[MIT](LICENSE)
