import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

// Execute the real pure helpers that decide whether the app may claim the user
// has no data. No database, configuration or desktop runtime is touched.
function loadHelpers() {
  const source = readFileSync(new URL('../src/lib/sixu/data-guard-pure.ts', import.meta.url), 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code
  const module = { exports: {} }
  new Function('module', 'exports', code)(module, module.exports)
  return module.exports
}

const helpers = loadHelpers()

test('只有确认对话和文章都为空时，才允许判断为空库', () => {
  assert.equal(helpers.isLibraryEmpty([], []), true)
  assert.equal(helpers.isLibraryEmpty([{ id: 1 }], []), false)
  assert.equal(helpers.isLibraryEmpty([], [{ isFile: true, name: 'a.md' }]), false)
  assert.equal(helpers.isLibraryEmpty([], [{ isFile: false, children: [{ isFile: true }] }]), false)
})

test('读取失败或未知状态不能被当成空库', () => {
  assert.equal(helpers.isLibraryEmpty(undefined, []), false)
  assert.equal(helpers.isLibraryEmpty([], undefined), false)
  assert.equal(helpers.isLibraryEmpty(null, null), false)
})

test('文章数量统计会遍历嵌套目录', () => {
  assert.equal(helpers.countArticleFiles([
    { isFile: true },
    { isFile: false, children: [{ isFile: true }, { isFile: false, children: [{ isFile: true }] }] },
  ]), 3)
  assert.equal(helpers.countArticleFiles(undefined), 0)
})

test('恢复说明只列出真实存在的数量，不夸大', () => {
  assert.equal(
    helpers.describeImportResult({ source: 'C:/a', conversations: 2, articleFiles: 1, completedAt: 1, backupDirectory: null }),
    '已从旧数据目录恢复2 个历史对话、1 篇文章，请检查是否完整。',
  )
  assert.equal(
    helpers.describeImportResult({ source: 'C:/a', conversations: 0, articleFiles: 0, completedAt: 1, backupDirectory: null }),
    '已从旧数据目录恢复本地数据，请检查是否完整。',
  )
})

test('数据目录说明包含来源类型、数量和更新时间的概览', () => {
  const text = helpers.describeDataProfile({
    path: 'C:/x', kind: 'package', noteDbBytes: 1024, articleFiles: 1, articleBytes: 835,
    conversations: 2, notes: 0, hasApiKey: true, updatedAt: 1, isCurrent: false,
  })
  assert.match(text, /工具\/开发方式启动/)
  assert.match(text, /2 个历史对话/)
  assert.match(text, /1 篇文章/)
  assert.match(text, /含模型密钥/)
  assert.match(text, /最后更新/)
})

test('字节和时间格式化对空值安全', () => {
  assert.equal(helpers.formatBytes(0), '0 B')
  assert.equal(helpers.formatBytes(2048), '2.0 KB')
  assert.equal(helpers.formatProfileTime(0), '时间未知')
})

test('导入失败与成功的结果可以被区分', () => {
  assert.equal(helpers.isImportFailure({ source: 'C:/a', error: '坏了', completedAt: 1 }), true)
  assert.equal(helpers.isImportFailure({ source: 'C:/a', conversations: 2, articleFiles: 1, completedAt: 1, backupDirectory: null }), false)
  assert.equal(helpers.isImportFailure(null), false)
})

test('配置损坏提示包含备份路径，并指向备份恢复入口', () => {
  const text = helpers.describeStoreRecovery({ backupPath: 'C:/x/store.json.corrupt-1', detectedAt: 1 })
  assert.match(text, /store\.json 损坏/)
  assert.match(text, /C:\/x\/store\.json\.corrupt-1/)
  assert.match(text, /备份/)
})
