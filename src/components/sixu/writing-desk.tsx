'use client'

import { useEffect, useState } from 'react'
import { BookOpenText, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import emitter from '@/lib/emitter'
import { buildWritingPrompt, DEFAULT_WRITING_PROFILE, WRITING_ACTIONS, type WritingAction, type WritingProfile } from '@/lib/sixu/writing'
import { loadWritingProfile, saveWritingProfile } from '@/lib/sixu/profile'
import useSettingStore from '@/stores/setting'
import { useSettingsDialogStore } from '@/stores/settings-dialog'

const fields: { key: keyof WritingProfile; label: string; hint: string }[] = [
  { key: 'direction', label: '创作方向', hint: '不必过早细分主题' },
  { key: 'audience', label: '写给谁看', hint: '可以随你的创作逐渐调整' },
  { key: 'style', label: '喜欢的表达', hint: '语气、结构与行文习惯' },
  { key: 'avoid', label: '不希望出现', hint: '例如空话、编造经历和缺少出处的事实' },
  { key: 'sample', label: '风格参考片段', hint: '粘贴自己或喜欢的文章片段，仅作为风格参考' },
]

export function WritingDesk({ compact = false }: { compact?: boolean }) {
  const primaryModel = useSettingStore(state => state.primaryModel)
  const openSettings = useSettingsDialogStore(state => state.openSettings)
  const [draft, setDraft] = useState<WritingProfile>(DEFAULT_WRITING_PROFILE)
  const [topic, setTopic] = useState('')
  const [expanded, setExpanded] = useState(!compact)
  const [editing, setEditing] = useState(false)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    loadWritingProfile().then(value => {
      if (!active) return
      setDraft(value); setReady(true)
    }).catch(() => { if (active) setMessage('写作偏好读取失败，请重新打开此页面。') })
    return () => { active = false }
  }, [])

  async function save() {
    setSaving(true); setMessage('')
    try {
      await saveWritingProfile(draft)
      setEditing(false); setMessage('偏好已保存，后续对话会使用这些设置。')
    } catch { setMessage('保存失败，输入仍保留在这里，请重试。') }
    finally { setSaving(false) }
  }

  async function prepare(action: WritingAction) {
    try {
      const latest = await loadWritingProfile()
      emitter.emit('sixu-writing-prompt', buildWritingPrompt(action, topic, latest))
      setMessage('已放入聊天输入框并保留原有输入，可修改后发送。')
    } catch { setMessage('读取写作偏好失败，未改动输入框。') }
  }

  async function openPreferences() {
    if (editing) { setEditing(false); return }
    try {
      const latest = await loadWritingProfile()
      setDraft(latest); setEditing(true); setExpanded(true)
    } catch { setMessage('写作偏好读取失败，请重试。') }
  }

  return (
    <section aria-label="思序创作台" className={compact ? 'w-full shrink-0 border-b px-3 py-2' : 'w-full space-y-4 rounded-xl border bg-background p-5 text-left'}>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="h-auto gap-2 px-0 text-left" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          <BookOpenText className="size-4" />
          <span>{compact ? '创作流程' : '从一个想法，写出自己的理解'}</span>
        </Button>
        <Button variant="ghost" size="sm" disabled={!ready} onClick={() => void openPreferences()}>
          <SlidersHorizontal className="size-4" /><span>写作偏好</span>
        </Button>
      </div>
      {expanded && <div className="mt-3 space-y-3">
        {!primaryModel && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3 text-xs">
          <span>先配置你自己的模型服务，再开始 AI 创作。</span>
          <Button size="sm" variant="outline" onClick={() => openSettings('ai')}>配置模型</Button>
        </div>}
        <label className="block space-y-2 text-sm">
          <span>这次想写什么？<span className="ml-2 text-xs text-muted-foreground">可以先留空</span></span>
          <Input value={topic} onChange={e => setTopic(e.target.value)} placeholder="一个困惑、一段经历，或者尚未想清楚的观点" />
        </label>
        {editing ? <div className="space-y-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">这些偏好长期保存。样例可以帮 AI 理解表达方式，其中的经历不会作为你的经历使用。</p>
          {fields.map(field => <label key={field.key} className="block space-y-1 text-sm">
            <span>{field.label}</span>
            <Textarea value={draft[field.key]} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })} placeholder={field.hint} rows={field.key === 'sample' ? 4 : 2} />
          </label>)}
          <div className="flex gap-2"><Button size="sm" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '确认保存'}</Button><Button variant="outline" size="sm" disabled={saving} onClick={() => setEditing(false)}>取消</Button></div>
        </div> : <>
          <div className="grid grid-cols-1 gap-2 @sm:grid-cols-2 sm:grid-cols-2">
            {WRITING_ACTIONS.map(action => <Button key={action.id} variant="outline" disabled={!ready} onClick={() => void prepare(action.id)} className="h-auto min-h-12 items-start whitespace-normal py-2 text-left">
              <span className="flex min-w-0 flex-col gap-1"><span>{action.title}</span>{!compact && <span className="text-xs font-normal text-muted-foreground">{action.description}</span>}</span>
            </Button>)}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">选题 → 讨论 → 你确认大纲 → 写作 → 审阅修改。按钮只准备消息，不会自动发送或改写文件。</p>
        </>}
      </div>}
      {message && <p role="status" className="mt-2 text-xs text-muted-foreground">{message}</p>}
    </section>
  )
}
