'use client'

import { useEffect, useState } from 'react'
import { relaunch } from '@tauri-apps/plugin-process'
import { Button } from '@/components/ui/button'
import useArticleStore from '@/stores/article'
import useChatStore from '@/stores/chat'
import {
  clearDataImportResult,
  clearStoreRecovery,
  describeDataProfile,
  describeImportResult,
  describeStoreRecovery,
  formatProfileTime,
  isImportFailure,
  isLibraryEmpty,
  readDataImportResult,
  readStoreRecovery,
  scanDataProfiles,
  scheduleDataProfileImport,
  type DataImportOutcome,
  type DataProfileInfo,
  type StoreRecoveryNotice,
} from '@/lib/sixu/data-guard'

const DISMISS_KEY = 'sixu-data-recovery-dismissed-v1'

// Shows only when the library is provably empty but another local profile holds
// data. It never hides or replaces the normal empty state on its own.
export function DataRecoveryBanner() {
  const conversations = useChatStore(state => state.conversations)
  const fileTree = useArticleStore(state => state.fileTree)
  const [candidates, setCandidates] = useState<DataProfileInfo[]>([])
  const [imported, setImported] = useState<DataImportOutcome | null>(null)
  const [storeRecovery, setStoreRecovery] = useState<StoreRecoveryNotice | null>(null)
  const [notice, setNotice] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [importing, setImporting] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const result = await readDataImportResult()
        if (!active) return
        if (result) {
          setImported(result)
          return
        }
        const recovery = await readStoreRecovery()
        if (!active) return
        if (recovery) {
          setStoreRecovery(recovery)
          return
        }
        try {
          if (window.localStorage.getItem(DISMISS_KEY)) return
        } catch {
          // A blocked localStorage must not hide a genuine recovery offer.
        }
        if (!isLibraryEmpty(conversations, fileTree)) return
        const report = await scanDataProfiles()
        if (!active) return
        setCandidates(report.candidates.filter(candidate => candidate.path !== report.current))
      } catch (error) {
        console.warn('Failed to check other local data profiles:', error)
      }
    })()
    return () => { active = false }
  }, [])

  function dismiss() {
    setHidden(true)
    try { window.localStorage.setItem(DISMISS_KEY, '1') } catch { /* memory only */ }
  }

  async function dismissImportNotice() {
    setHidden(true)
    try { await clearDataImportResult() } catch { /* keep the file, harmless */ }
  }

  async function dismissStoreRecovery() {
    setHidden(true)
    try { await clearStoreRecovery() } catch { /* keep the file, harmless */ }
  }

  async function confirmImport(profile: DataProfileInfo) {
    setImporting(true)
    setNotice('')
    try {
      await scheduleDataProfileImport(profile.path)
      await relaunch()
    } catch (error) {
      setImporting(false)
      setConfirming(false)
      setNotice(String(error instanceof Error ? error.message : error))
    }
  }

  if (hidden) return null

  if (imported) {
    return (
      <section role={isImportFailure(imported) ? 'alert' : 'status'} className="fixed left-1/2 top-12 z-[60] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 rounded-lg border bg-background/95 p-4 shadow-lg">
        {isImportFailure(imported) ? (
          <>
            <p className="text-sm">旧数据导入没有完成：{imported.error}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">数据来源：{imported.source}</p>
          </>
        ) : (
          <>
            <p className="text-sm">{describeImportResult(imported)}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">数据来源：{imported.source}</p>
            {imported.backupDirectory && (
              <p className="mt-1 break-all text-xs text-muted-foreground">导入前的本地备份：{imported.backupDirectory}</p>
            )}
          </>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" onClick={() => void dismissImportNotice()}>知道了</Button>
        </div>
      </section>
    )
  }

  if (storeRecovery) {
    return (
      <section role="alert" className="fixed left-1/2 top-12 z-[60] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 rounded-lg border border-amber-500/50 bg-background/95 p-4 shadow-lg">
        <p className="text-sm">{describeStoreRecovery(storeRecovery)}</p>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" onClick={() => void dismissStoreRecovery()}>知道了</Button>
        </div>
      </section>
    )
  }

  if (candidates.length === 0) return null

  return (
    <section role="alert" className="fixed left-1/2 top-12 z-[60] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 rounded-lg border border-amber-500/50 bg-background/98 p-4 shadow-lg">
      <h2 className="text-sm font-semibold">当前数据目录是空的，但发现了另一份本地数据</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        思序这次没有读到笔记和历史对话，但本机还保存着另一份思序数据。可能是用不同方式启动应用时写到了不同目录。
      </p>
      <ul className="mt-2 space-y-1">
        {candidates.map(profile => (
          <li key={profile.path} className="rounded-md border p-2 text-xs">
            <p>{describeDataProfile(profile)}</p>
            <p className="mt-1 break-all text-muted-foreground">{profile.path}</p>
            <p className="mt-1 text-muted-foreground">最后更新：{formatProfileTime(profile.updatedAt)}</p>
          </li>
        ))}
      </ul>
      {confirming ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">导入会用选中的数据替换当前空数据目录，并在导入前自动备份；思序随后会重启。</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={importing} onClick={() => setConfirming(false)}>取消</Button>
            <Button size="sm" disabled={importing} onClick={() => void confirmImport(candidates[0])}>
              {importing ? '正在准备重启…' : '确认导入并重启'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={dismiss}>暂时不用</Button>
          <Button size="sm" onClick={() => setConfirming(true)}>从旧数据目录导入</Button>
        </div>
      )}
      {notice && <p className="mt-2 text-xs text-red-500">{notice}</p>}
    </section>
  )
}
