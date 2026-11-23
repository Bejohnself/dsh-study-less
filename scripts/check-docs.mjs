#!/usr/bin/env node
// 文档锚点：文档与代码漂移时失败，而不是等人发现。
// 用法：仓库根目录 `node scripts/check-docs.mjs`；缺文件就跳过该项，不报假失败。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
// 上限只在 AGENTS.md 的「文档上限」一节声明一处，脚本照读；没写就用下面的默认值。
const DEFAULT_LIMITS = { 'AGENTS.md': 80, 'DESIGN.md': 90, 'ARCHITECTURE.md': 120 }
const LIMITS = { ...DEFAULT_LIMITS }
for (const [file, max] of declaredLimits()) LIMITS[file] = max
// 只校验这两份文档里带路径的节；其余段落是叙述，不校验。
const SECTIONS = { 'AGENTS.md': '目录地图', 'ARCHITECTURE.md': '模块' }
const SRC_DIRS = ['src', 'app', 'test', 'tests', 'scripts']
const SRC_EXT = /\.(c|m)?[jt]sx?$|\.(py|go|rs|java|kt)$/
const MAX_FILE_LINES = 800
const SKIP_DIRS = new Set(['node_modules', '.git', '.tmp', 'dist', 'build', 'coverage'])

let failed = false

// ── 文档行数上限：超了要求做减法，不是继续加节 ──
for (const [file, max] of Object.entries(LIMITS)) {
  const path = join(root, file)
  if (!existsSync(path)) continue
  const lines = lineCount(path)
  if (lines > max) {
    console.error(`${file}: ${lines} 行，超过上限 ${max}`)
    failed = true
  }
}

// ── 路径存在性：反引号里的仓库相对路径必须真实存在 ──
for (const [file, keyword] of Object.entries(SECTIONS)) {
  const path = join(root, file)
  if (!existsSync(path)) continue
  for (const span of codeSpansInSection(readFileSync(path, 'utf8'), keyword)) {
    // 只认路径：形如 a/b 或是同级 .md。命令、通配、占位符一律跳过。
    if (!/^[\w.@-]+(\/[\w.@-]+)*\/?$/.test(span)) continue
    const target = span.replace(/\/$/, '')
    if (!target.includes('/') && !target.endsWith('.md')) continue
    if (existsSync(join(root, target))) continue
    console.error(`${file} 的「${keyword}」一节引用了不存在的路径：${span}`)
    failed = true
  }
}

// ── 单文件行数：800 行是硬上限，超了按职责拆 ──
for (const dir of SRC_DIRS) {
  const path = join(root, dir)
  if (!existsSync(path)) continue
  for (const file of walk(path)) {
    if (!SRC_EXT.test(file)) continue
    const lines = lineCount(file)
    if (lines > MAX_FILE_LINES) {
      console.error(`${relative(root, file)}: ${lines} 行，超过单文件 ${MAX_FILE_LINES} 行，按职责拆`)
      failed = true
    }
  }
}

process.exit(failed ? 1 : 0)

// 读 AGENTS.md「文档上限」一节里的 `X.md` + 数字；缺失或读不到就回默认值。
function declaredLimits() {
  const path = join(root, 'AGENTS.md')
  if (!existsSync(path)) return []
  const found = []
  let inside = false
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.startsWith('#')) {
      inside = line.includes('文档上限')
      continue
    }
    if (!inside) continue
    for (const match of line.matchAll(/`([\w.-]+\.md)`\s*(\d+)/g)) found.push([match[1], Number(match[2])])
  }
  return found
}

function lineCount(path) {
  return readFileSync(path, 'utf8').replace(/\n$/, '').split('\n').length
}

// 收集某节（标题含 keyword）里的反引号内容，遇到下一个标题就停。
function codeSpansInSection(text, keyword) {
  const spans = []
  let inside = false
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) {
      inside = line.includes(keyword)
      continue
    }
    if (!inside) continue
    for (const match of line.matchAll(/`([^`]+)`/g)) spans.push(match[1])
  }
  return spans
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name))
    } else {
      yield join(dir, entry.name)
    }
  }
}