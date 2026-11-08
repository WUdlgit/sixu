import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { transformSync } from 'esbuild'
import vm from 'node:vm'

// Execute the real layout and its startup effect, replacing only native/app
// dependencies. No user database, notes, configuration or network is touched.
function layoutFixture(failAt = 'settings') {
  const effects = [], slots = []
  const stages = []
  let cursor = 0
  const noop = () => {}
  const load = stage => async () => {
    stages.push(stage)
    if (stage === failAt) throw new Error('injected local read failure')
  }
  const state = new Proxy({ activeShortcuts: [], recordToolbarConfig: [],
    initSettingData: load('settings'), initConversations: load('history'), loadFileTree: load('notes'),
  }, { get: (target, key) => key in target ? target[key] : noop })
  const store = selector => selector ? selector(state) : state
  store.getState = () => state
  const hooks = {
    useEffect: callback => effects.push(callback),
    useRef: value => ({ current: value }),
    useState: value => {
      const index = cursor++
      if (!(index in slots)) slots[index] = value
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
    },
  }
  const jsx = (type, props) => ({ type, props })
  const mocks = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    '@/stores/setting': { __esModule: true, default: store },
    '@/stores/shortcut': { __esModule: true, default: store },
    '@/stores/chat': { __esModule: true, default: store },
    '@/stores/article': { __esModule: true, default: store },
    '@/db': { initAllDatabases: load('database') },
    '@/hooks/useI18n': { useI18n: () => ({ currentLocale: 'zh' }) },
    '@/hooks/use-toast': { useToast: () => ({ toast: noop }) },
    'next-intl': { useTranslations: () => noop },
    'next/navigation': { useRouter: () => ({}), usePathname: () => '/core/main', useSearchParams: () => ({}) },
    '@/lib/event-report': { reportAppStart: async () => {} },
    '@/lib/sixu/startup-diagnostics': { recordStartupEvent: noop },
  }
  const generic = new Proxy({ __esModule: true, default: store }, { get: (target, key) => key in target ? target[key] : store })
  const source = readFileSync(new URL('../src/app/core/layout.tsx', import.meta.url), 'utf8')
  const code = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => mocks[name] || generic, module, module.exports)
  const render = () => { cursor = 0; return module.exports.default({ children: 'PRIVATE_DATA_PANELS' }) }
  return { effects, render, stages }
}

function contains(node, text) {
  if (typeof node === 'string') return node.includes(text)
  if (Array.isArray(node)) return node.some(child => contains(child, text))
  return node && typeof node === 'object' && contains(node.props?.children, text)
}

test('启动尚未完成时，不挂载会误报空笔记、空历史和未配置模型的面板', () => {
  const fixture = layoutFixture()
  assert.equal(contains(fixture.render(), 'PRIVATE_DATA_PANELS'), false)
})

test('配置读取失败时，显示加载失败与重试入口，而不是空数据面板', async () => {
  const fixture = layoutFixture()
  fixture.render()
  const effect = fixture.effects.find(callback => callback.toString().includes('initializeApp'))
  assert.ok(effect, 'real startup effect must be exercised')
  const originalError = console.error
  console.error = () => {}
  let cleanup
  try {
    cleanup = effect()
    await new Promise(resolve => setImmediate(resolve))
    const tree = fixture.render()
    assert.equal(contains(tree, 'PRIVATE_DATA_PANELS'), false)
    assert.ok(contains(tree, '本地数据加载失败'))
    assert.ok(contains(tree, '重新加载'))
  } finally { cleanup?.(); console.error = originalError }
})

for (const [stage, label] of [['database', '打开本地数据库'], ['history', '读取历史对话'], ['notes', '读取笔记']]) {
  test(`${stage} 读取失败时标明失败步骤，并阻止后续空面板`, async () => {
    const fixture = layoutFixture(stage)
    fixture.render()
    const cleanup = fixture.effects.find(callback => callback.toString().includes('initializeApp'))()
    try {
      await new Promise(resolve => setImmediate(resolve))
      const tree = fixture.render()
      assert.equal(contains(tree, 'PRIVATE_DATA_PANELS'), false)
      assert.ok(contains(tree, '本地数据加载失败'))
      assert.ok(contains(tree, label))
      assert.equal(fixture.stages.at(-1), stage)
    } finally { cleanup?.() }
  })
}

test('本地读取全部成功后才挂载面板；后台服务失败不遮住已有数据', async () => {
  const fixture = layoutFixture(null)
  fixture.render()
  const originalError = console.error
  console.error = () => {}
  const cleanup = fixture.effects.find(callback => callback.toString().includes('initializeApp'))()
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(fixture.stages, ['settings', 'database', 'history', 'notes'])
    assert.equal(contains(fixture.render(), 'PRIVATE_DATA_PANELS'), true)
  } finally { cleanup?.(); console.error = originalError }
})

function bootstrapFixture(pathname = '/core/main', storageUnavailable = false) {
  const source = readFileSync(new URL('../src/lib/sixu/startup-diagnostics.ts', import.meta.url), 'utf8')
  const module = { exports: {} }
  new Function('module', 'exports', transformSync(source, { loader: 'ts', format: 'cjs' }).code)(module, module.exports)
  const nodes = new Map(), listeners = {}, stored = new Map(), timers = []
  const element = tagName => ({ tagName, children: [], style: {}, setAttribute() {},
    appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child) },
    remove() { nodes.delete(this.id) },
  })
  const context = {
    window: { addEventListener: (type, callback) => { listeners[type] = callback } },
    document: { body: element('BODY'), createElement: element, getElementById: id => nodes.get(id), querySelector: () => null },
    location: { pathname, reload() {} },
    localStorage: { getItem: key => { if (storageUnavailable) throw new Error('denied'); return stored.get(key) },
      setItem: (key, value) => { if (storageUnavailable) throw new Error('denied'); stored.set(key, value) } },
    setTimeout: callback => { timers.push(callback); return timers.length }, clearTimeout() {},
  }
  vm.runInNewContext(module.exports.STARTUP_BOOTSTRAP, context)
  return { context, nodes, listeners, stored, timers, category: module.exports.startupErrorCategory }
}

test('React 未启动且脚本加载失败时，独立回退界面可用，不依赖应用数据', () => {
  const fixture = bootstrapFixture()
  fixture.listeners.error({ target: { tagName: 'SCRIPT' } })
  const panel = fixture.nodes.get('sixu-startup-fallback')
  assert.ok(panel)
  assert.ok(panel.children.some(child => child.textContent === '重新加载'))
  assert.match([...fixture.stored.values()][0], /script-load/)
})

test('启动超时显示回退界面；稍后成功自动撤下；之后后台错误不覆盖正常界面', () => {
  const fixture = bootstrapFixture()
  fixture.context.window.__sixuStartup.mark('database', 'started')
  fixture.timers[0]()
  assert.ok(fixture.nodes.has('sixu-startup-fallback'))
  assert.match([...fixture.stored.values()][0], /database/)
  fixture.context.window.__sixuStartup.mark('ready', 'completed')
  assert.equal(fixture.nodes.has('sixu-startup-fallback'), false)
  fixture.listeners.error({ target: { tagName: 'SCRIPT' } })
  assert.equal(fixture.nodes.has('sixu-startup-fallback'), false)
})

test('启动记录不保存异常正文、密钥或聊天；记录最多 40 项', () => {
  const fixture = bootstrapFixture()
  fixture.listeners.error({ error: new Error('sk-test-secret private conversation') })
  fixture.listeners.unhandledrejection({ reason: 'sk-test-secret private conversation' })
  for (let i = 0; i < 60; i++) fixture.context.window.__sixuStartup.mark('settings', 'started')
  const report = [...fixture.stored.values()][0]
  assert.doesNotMatch(report, /sk-test-secret|private conversation/)
  assert.equal(JSON.parse(report).length, 40)
  assert.equal(fixture.category(new Error('os error 5: access denied sk-test-secret')), 'access-denied')
})

test('本地诊断存储不可用不妨碍回退；截图、打印、移动页面不安装桌面启动检测', () => {
  const fixture = bootstrapFixture('/core/main', true)
  fixture.timers[0]()
  assert.ok(fixture.nodes.has('sixu-startup-fallback'))
  for (const path of ['/print', '/screenshot', '/editor-window', '/mobile/chat']) {
    assert.equal(bootstrapFixture(path).timers.length, 0)
  }
})

test('等待用户解锁不触发启动失败；解锁后进入配置读取时重新计时', () => {
  const fixture = bootstrapFixture()
  fixture.context.document.querySelector = () => ({})
  fixture.timers[0]()
  assert.equal(fixture.nodes.has('sixu-startup-fallback'), false)
  fixture.context.document.querySelector = () => null
  fixture.context.window.__sixuStartup.mark('settings', 'started')
  fixture.timers.at(-1)()
  assert.ok(fixture.nodes.has('sixu-startup-fallback'))
})
