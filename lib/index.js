/**
 * dsh-preset-bridge — 模式目录桥接（0.2.x 补回 0.1.x 的 ~/.dsh/.agent-presets 发现通道）。
 *
 * 0.2.0 的 agentPresets 注册表不再扫描目录（官方文档：「注册表不扫描目录，也不接受
 * preset 路径」），模式只能以 @deepseek-ai/dsh-agent-preset 行声明进组合。本插件在
 * 激活时扫描预设目录，把每个 agent.cordis.yml + preset.yml 注册进注册表：
 *
 *   - 语义对齐 0.1.x 的 @deepseek-ai/dsh-agent-presets：id=目录名，preset.yml 只承载
 *     展示文本（name/description/order），坏预设降级为列表里的 broken 项而不是抛崩。
 *   - 预设内相对行名（./xxx.mjs?v=1）在注册前改写为绝对 file: URL——0.2.0 挂载按
 *     声明处 baseUrl 解析相对名，预设目录不在其上；查询串（缓存戳）原样保留。
 *   - !!js 节点构造成 { __jsExpr } 惰性节点（entryListSchema 同构），激活期由 Loader
 *     求值，解析期不求值。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import z from '@deepseek-ai/schemastery'

const COMPOSITION_FILE = 'agent.cordis.yml'
const METADATA_FILE = 'preset.yml'

/** entry-list YAML 方言：!!js 标量按 cordis-plugin-include 的同构规则惰性化。 */
const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (obj) => obj !== null && typeof obj === 'object' && '__jsExpr' in obj,
  represent: (data) => data['__jsExpr'],
})
const entryListSchema = yaml.JSON_SCHEMA.extend(jsExprType)

function defaultRoot() {
  const env = process.env.DSH_HOME
  return env && env.trim() ? resolve(env.trim()) : join(homedir(), '.dsh')
}

/* 文件日志：桌面端 host 的 ctx.logger 不落盘，排障期写自己的日志。 */
const LOG_FILE = join(defaultRoot(), 'preset-bridge.log')
function log(level, message) {
  try {
    mkdirSync(defaultRoot(), { recursive: true })
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [${level}] ${message}\n`, 'utf8')
  } catch { /* 日志失败不影响功能 */ }
}

/** 递归把相对行名改写为绝对 file: URL（保留 ?缓存戳）。 */
function absolutizeRows(rows, dir) {
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const name = row.name
    if (typeof name === 'string' && (name.startsWith('./') || name.startsWith('../'))) {
      const q = name.indexOf('?')
      const spec = q === -1 ? name : name.slice(0, q)
      const query = q === -1 ? '' : name.slice(q)
      if (!isAbsolute(spec)) row.name = pathToFileURL(resolve(dir, spec)).href + query
    }
    if (row.group === true && Array.isArray(row.config)) absolutizeRows(row.config, dir)
  }
  return rows
}

/**
 * 0.2.0 移除了 `@deepseek-ai/dsh-workflow-worker-thread`（0.1.x 的 workflowEngine
 * 提供方，0.1.x 时代预设的 delegation 组普遍自带一行），官方替代是
 * `@deepseek-ai/dsh-workflow-ptc`（同为 spawn 提供方、同组 isolate 语义）。
 * 提供方行缺失/导入失败会让同组 tool-workflow / tool-ralph 永远
 * "waiting for workflowEngine" → 预设被判 broken，模式菜单不显示。
 * 这里原位替换行名（组、isolate、config 形状均不变）。
 */
function replaceWorkflowProvider(rows) {
  let replaced = 0
  const walk = (list) => {
    for (const row of list) {
      if (row === null || typeof row !== 'object') continue
      if (row.name === '@deepseek-ai/dsh-workflow-worker-thread') {
        row.name = '@deepseek-ai/dsh-workflow-ptc'
        replaced++
      }
      if (row.group === true && Array.isArray(row.config)) walk(row.config)
    }
  }
  walk(rows)
  return replaced
}

const name = 'dsh-preset-bridge'
export const inject = ['agentPresets']
export const Config = z.object({
  // 额外扫描目录；缺省只扫 ${DSH_HOME:-~/.dsh}/.agent-presets（与 0.1.x 的 user root 一致）
  roots: z.array(z.string()).default([]),
})

async function registerPreset(ctx, dir) {
  let raw
  try {
    raw = await readFile(join(dir, COMPOSITION_FILE), 'utf8')
  } catch {
    return false // 没有 agent.cordis.yml 的目录不是预设
  }
  const rows = yaml.load(raw, { schema: entryListSchema })
  if (!Array.isArray(rows)) return false
  let meta = {}
  try {
    meta = yaml.load(await readFile(join(dir, METADATA_FILE), 'utf8')) ?? {}
  } catch { /* 展示元数据缺失可容忍：名称/描述/排序均可缺省 */ }
  const replaced = replaceWorkflowProvider(rows)
  if (replaced > 0) log('info', `${basename(dir)}: workflow provider row → dsh-workflow-ptc ×${replaced}`)
  const definition = {
    id: basename(dir),
    ...(typeof meta.name === 'string' && meta.name ? { name: meta.name } : {}),
    ...(typeof meta.description === 'string' && meta.description ? { description: meta.description } : {}),
    ...(Number.isFinite(meta.order) ? { order: meta.order } : {}),
    plugins: absolutizeRows(rows, dir),
  }
  const unregister0 = await ctx.agentPresets.register(definition)
  const unregister = async () => {
    log('info', `unregister requested: ${definition.id}`)
    await unregister0()
    log('info', `unregistered: ${definition.id}`)
  }
  log('info', `preset ${definition.id} registered (${definition.name ?? ''})`)
  return unregister
}

async function apply(ctx, config) {
  log('info', `apply start; DSH_HOME=${process.env.DSH_HOME ?? '(unset)'}; agentPresets=${typeof ctx.agentPresets}`)
  const roots = config.roots.length > 0 ? config.roots : [join(defaultRoot(), '.agent-presets')]
  const unregisters = []
  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
      log('info', `root ${root}: ${entries.length} entries`)
    } catch (error) {
      log('warn', `root not readable, skipped: ${root} (${error?.message ?? error})`)
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      try {
        const unregister = await registerPreset(ctx, join(root, entry.name))
        if (unregister) unregisters.push(unregister)
      } catch (error) {
        // 单个坏预设只告警（注册表会把激活失败记为 broken），不拖垮其余注册
        log('warn', `preset ${entry.name} failed: ${error?.stack ?? error?.message ?? error}`)
      }
    }
  }
  log('info', `apply done; registered ${unregisters.length}`)
  // 卸载/热重载时反注册，避免旧定义残留（register 对重名 id 会抛错）。
  // 注意本 cordis 的 effect(setup) 语义：setup 立即执行，返回值才是清理函数。
  ctx.effect(() => async () => {
    for (const unregister of unregisters.splice(0)) {
      try { await unregister() } catch { /* 幂等 */ }
    }
  }, 'dsh-preset-bridge.dispose')
}

export default { apply, name, inject, Config }
