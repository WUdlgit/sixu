// Pure helpers for the local-data safety screens. Kept free of Tauri imports so
// they can be tested without a desktop runtime.

export type DataProfileKind = 'current' | 'appdata' | 'package' | string

export interface DataProfileInfo {
  path: string
  kind: DataProfileKind
  noteDbBytes: number
  articleFiles: number
  articleBytes: number
  conversations: number
  notes: number
  hasApiKey: boolean
  updatedAt: number
  isCurrent: boolean
}

export interface DataProfileReport {
  current: string
  currentPopulated: boolean
  candidates: DataProfileInfo[]
}

export interface DataImportResult {
  source: string
  conversations: number
  articleFiles: number
  completedAt: number
  backupDirectory: string | null
}

export interface DataImportFailure {
  source: string
  error: string
  completedAt: number
}

export type DataImportOutcome = DataImportResult | DataImportFailure

export function isImportFailure(value: unknown): value is DataImportFailure {
  return Boolean(value) && typeof (value as DataImportFailure).error === 'string'
}

export interface StoreRecoveryNotice {
  backupPath: string
  detectedAt: number
}

export function describeStoreRecovery(notice: StoreRecoveryNotice): string {
  return `检测到配置文件 store.json 损坏，已保留副本：${notice.backupPath}。模型和部分设置可能需要重新配置，也可以在“设置 → 备份”里恢复最近一次备份。`
}

export interface ArticleTreeEntry {
  isFile?: boolean
  children?: ArticleTreeEntry[]
}

export function countArticleFiles(entries: ArticleTreeEntry[] | undefined): number {
  if (!Array.isArray(entries)) return 0
  let count = 0
  const stack = [...entries]
  while (stack.length > 0) {
    const entry = stack.pop()
    if (!entry) continue
    if (entry.isFile) count += 1
    if (Array.isArray(entry.children)) stack.push(...entry.children)
  }
  return count
}

/**
 * An empty library is only reported when both data sources are proven empty.
 * A missing/unknown value must never be mistaken for "the user has no data".
 */
export function isLibraryEmpty(conversations: unknown[] | undefined, entries: ArticleTreeEntry[] | undefined): boolean {
  if (!Array.isArray(conversations)) return false
  if (!Array.isArray(entries)) return false
  return conversations.length === 0 && countArticleFiles(entries) === 0
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function formatProfileTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '时间未知'
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
  } catch {
    return new Date(timestamp).toLocaleString()
  }
}

export function profileKindLabel(kind: DataProfileKind): string {
  if (kind === 'package') return '另一份本地数据（工具/开发方式启动时写入）'
  if (kind === 'appdata') return '另一份本地数据（正常启动时写入）'
  if (kind === 'current') return '当前数据目录'
  return '另一份本地数据'
}

export function describeDataProfile(profile: DataProfileInfo): string {
  const parts: string[] = []
  if (profile.conversations > 0) parts.push(`${profile.conversations} 个历史对话`)
  if (profile.articleFiles > 0) parts.push(`${profile.articleFiles} 篇文章`)
  if (profile.hasApiKey) parts.push('含模型密钥')
  if (parts.length === 0) parts.push('没有可导入的内容')
  return `${profileKindLabel(profile.kind)}：${parts.join('、')}，最后更新 ${formatProfileTime(profile.updatedAt)}`
}

export function describeImportResult(result: DataImportResult): string {
  const parts: string[] = []
  if (result.conversations > 0) parts.push(`${result.conversations} 个历史对话`)
  if (result.articleFiles > 0) parts.push(`${result.articleFiles} 篇文章`)
  const detail = parts.length > 0 ? parts.join('、') : '本地数据'
  return `已从旧数据目录恢复${detail}，请检查是否完整。`
}
