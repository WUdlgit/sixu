import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

function loadVectorStore(configured) {
  let state
  let processed = 0
  let checked = 0
  const toasts = []
  const mocks = {
    zustand: { create: initialize => (state = initialize(value => Object.assign(state, value), () => state)) },
    '@/lib/rag': {
      initVectorDb: async () => {}, initBM25Search: async () => {},
      checkEmbeddingModelAvailable: async () => { checked++; return configured },
      processMarkdownFile: async () => { processed++; return true },
    },
    '@/lib/ai/embedding': {
      getEmbeddingModelInfo: async () => configured ? { model: 'test' } : null,
      checkRerankModelAvailable: async () => false,
    },
    '@tauri-apps/plugin-store': { Store: { load: async () => ({ get: async key => key === 'autoVectorEnabled' ? true : undefined }) } },
    '@/hooks/use-toast': { toast: value => { toasts.push(value) } },
    '@/db/vector': { getVectorIndexStats: async () => ({ documentCount: 0 }) },
    '@/stores/ragSettings': { __esModule: true, default: { getState: () => ({ initSettings: async () => {} }) } },
  }
  const source = readFileSync(new URL('../src/stores/vector.ts', import.meta.url), 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`)
    return mocks[name]
  }, module, module.exports)
  return { state, toasts, processed: () => processed, checked: () => checked }
}

test('未配置嵌入模型：启动和后台保存不弹错，不请求文档向量', async () => {
  const fixture = loadVectorStore(false)
  await fixture.state.initVectorDb()
  assert.equal(fixture.checked(), 1)
  assert.equal(await fixture.state.processDocument('文章.md', '正文'), false)
  assert.equal(fixture.processed(), 0)
  assert.equal(fixture.toasts.length, 0)
})

test('主动建立索引时仍提示缺少模型', async () => {
  const fixture = loadVectorStore(false)
  await fixture.state.processAllDocuments()
  assert.equal(fixture.toasts.length, 1)
  assert.match(fixture.toasts[0].description, /未配置嵌入模型/)
})

test('已配置模型仍可执行文档索引并报告成功', async () => {
  const fixture = loadVectorStore(true)
  assert.equal(await fixture.state.processDocument('文章.md', '正文'), true)
  assert.equal(fixture.processed(), 1)
})
