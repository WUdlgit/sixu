import { invoke } from '@tauri-apps/api/core'
import type { DataImportOutcome, DataProfileReport, StoreRecoveryNotice } from './data-guard-pure'

export type {
  ArticleTreeEntry,
  DataImportFailure,
  DataImportOutcome,
  DataImportResult,
  DataProfileInfo,
  DataProfileKind,
  DataProfileReport,
  StoreRecoveryNotice,
} from './data-guard-pure'
export {
  countArticleFiles,
  describeDataProfile,
  describeImportResult,
  describeStoreRecovery,
  formatBytes,
  formatProfileTime,
  isImportFailure,
  isLibraryEmpty,
  profileKindLabel,
} from './data-guard-pure'

export function scanDataProfiles(): Promise<DataProfileReport> {
  return invoke<DataProfileReport>('sixu_scan_data_profiles')
}

/** Queues the import and returns immediately; the copy happens on next start. */
export function scheduleDataProfileImport(source: string): Promise<void> {
  return invoke('sixu_schedule_data_profile_import', { source })
}

export function readDataImportResult(): Promise<DataImportOutcome | null> {
  return invoke<DataImportOutcome | null>('sixu_read_import_result')
}

export function clearDataImportResult(): Promise<void> {
  return invoke('sixu_clear_import_result')
}

export function readStoreRecovery(): Promise<StoreRecoveryNotice | null> {
  return invoke<StoreRecoveryNotice | null>('sixu_read_store_recovery')
}

export function clearStoreRecovery(): Promise<void> {
  return invoke('sixu_clear_store_recovery')
}
