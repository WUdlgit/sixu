import { Store } from '@tauri-apps/plugin-store'
import { documentDir, join } from '@tauri-apps/api/path'

const DEFAULT_BACKUP_FOLDER = '思序备份'
const INITIALIZED_KEY = 'sixuDefaultBackupInitialized'

/**
 * Turn on one automatic local backup on first launch. The backup directory is a
 * normal, user-visible Documents folder, so it survives data-directory changes
 * caused by different launch contexts (for example packaged tool shells).
 */
export async function ensureDefaultLocalBackup(): Promise<void> {
  try {
    const store = await Store.load('store.json')
    if (await store.get<boolean>(INITIALIZED_KEY)) return
    const directory = await store.get<string>('managedBackupDirectory')
    if (typeof directory === 'string' && directory.trim() !== '') {
      // A backup directory is already configured; only record that the default
      // bootstrap has been handled, never replace the user's choice.
      await store.set(INITIALIZED_KEY, true)
      await store.save()
      return
    }
    const documents = await documentDir()
    // Resolving the Documents folder can fail transiently. Do not mark the
    // bootstrap as done in that case, otherwise the retry never happens.
    if (!documents) return
    const target = await join(documents, DEFAULT_BACKUP_FOLDER)
    await store.set('managedBackupDirectory', target)
    await store.set('managedBackupSchedule', 'daily')
    await store.set('managedBackupRetention', 10)
    await store.set(INITIALIZED_KEY, true)
    await store.save()
    window.dispatchEvent(new Event('notegen-managed-backup-settings-changed'))
  } catch (error) {
    console.warn('Failed to enable the default local backup:', error)
  }
}
