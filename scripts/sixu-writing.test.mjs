import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWritingPrompt, DEFAULT_WRITING_PROFILE, normalizeWritingProfile } from '../src/lib/sixu/writing.ts'

test('未选题时，大纲操作不能假定用户已选题', () => {
  const prompt = buildWritingPrompt('outline', '   ', DEFAULT_WRITING_PROFILE)
  assert.match(prompt, /没有确定具体题目/)
  assert.match(prompt, /先问我选哪个题目/)
  assert.match(prompt, /不要生成正文或写入文件/)
})

test('全文和逐节入口都要求确认大纲，逐节不会自动写完', () => {
  const draft = buildWritingPrompt('draft', '学习与行动', DEFAULT_WRITING_PROFILE)
  const section = buildWritingPrompt('section', '学习与行动', DEFAULT_WRITING_PROFILE)
  assert.match(draft, /否则先让我确认大纲/)
  assert.match(section, /本次只写下一节/)
  assert.match(section, /不自动继续/)
})

test('用户偏好和样例进入请求，但不把样例中的经历归给用户', () => {
  const profile = { ...DEFAULT_WRITING_PROFILE, audience: '大学生', sample: '示例作者做了十年研究。' }
  const prompt = buildWritingPrompt('interview', '我的困惑', profile)
  assert.match(prompt, /大学生/)
  assert.match(prompt, /示例作者做了十年研究/)
  assert.match(prompt, /不将其中经历当作用户经历/)
  assert.match(prompt, /一次只问一个问题/)
})

test('旧的或部分偏好可读取；用户主动清空的字段不被默认值覆盖', () => {
  assert.deepEqual(normalizeWritingProfile(null), DEFAULT_WRITING_PROFILE)
  const profile = normalizeWritingProfile({ style: '', sample: 123, direction: '读书' })
  assert.equal(profile.style, '')
  assert.equal(profile.direction, '读书')
  assert.equal(profile.sample, '')
})
