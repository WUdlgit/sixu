use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const PROFILE_DIR_NAME: &str = "com.sixu.desktop";
const IMPORT_REQUEST_FILE: &str = "sixu-import-request.json";
const IMPORT_RESULT_FILE: &str = "sixu-import-result.json";
const CORRUPT_STORE_NOTICE: &str = "sixu-store-recovery.json";
const SNAPSHOT_FILE: &str = "note.db.import";

// A profile is "populated" only when it can be proven from the files on disk.
// File sizes alone are misleading: a freshly initialised database is already
// several hundred kilobytes while containing no conversations or notes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataProfileInfo {
    pub path: String,
    pub kind: String,
    pub note_db_bytes: u64,
    pub article_files: u64,
    pub article_bytes: u64,
    pub conversations: i64,
    pub notes: i64,
    pub has_api_key: bool,
    pub updated_at: u64,
    pub is_current: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataProfileReport {
    pub current: String,
    pub current_populated: bool,
    pub candidates: Vec<DataProfileInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportRequest {
    source: String,
    requested_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub source: String,
    pub conversations: i64,
    pub article_files: u64,
    pub completed_at: u64,
    pub backup_directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportFailure {
    source: String,
    error: String,
    completed_at: u64,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn user_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn candidate_profile_dirs() -> Vec<(PathBuf, &'static str)> {
    let Some(home) = user_home() else {
        return Vec::new();
    };
    let mut dirs = vec![(home.join("AppData").join("Roaming").join(PROFILE_DIR_NAME), "appdata")];
    let packages = home.join("AppData").join("Local").join("Packages");
    if let Ok(entries) = fs::read_dir(&packages) {
        for entry in entries.flatten() {
            let dir = entry
                .path()
                .join("LocalCache")
                .join("Roaming")
                .join(PROFILE_DIR_NAME);
            if dir.is_dir() {
                dirs.push((dir, "package"));
            }
        }
    }
    dirs
}

fn walk_article_stats(directory: &Path) -> (u64, u64, u64) {
    let mut files = 0u64;
    let mut bytes = 0u64;
    let mut updated = 0u64;
    let mut stack = vec![directory.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if metadata.is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                stack.push(entry.path());
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            files += 1;
            bytes += metadata.len();
            if let Ok(modified) = metadata.modified() {
                if let Ok(since) = modified.duration_since(UNIX_EPOCH) {
                    updated = updated.max(since.as_millis() as u64);
                }
            }
        }
    }
    (files, bytes, updated)
}

fn store_has_api_key(directory: &Path) -> bool {
    let Ok(content) = fs::read_to_string(directory.join("store.json")) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };
    value
        .get("aiModelList")
        .and_then(|list| list.as_array())
        .is_some_and(|list| {
            list.iter().any(|item| {
                item.get("apiKey")
                    .and_then(|key| key.as_str())
                    .is_some_and(|key| !key.trim().is_empty())
            })
        })
}

fn latest_modified(directory: &Path) -> u64 {
    let mut latest = 0u64;
    for name in ["note.db", "note.db-wal", "store.json"] {
        if let Ok(metadata) = fs::metadata(directory.join(name)) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(since) = modified.duration_since(UNIX_EPOCH) {
                    latest = latest.max(since.as_millis() as u64);
                }
            }
        }
    }
    latest
}

async fn count_library(database: &Path) -> (i64, i64) {
    if !database.exists() {
        return (-1, -1);
    }
    let options = SqliteConnectOptions::new()
        .filename(database)
        .read_only(true);
    let mut connection = match SqliteConnection::connect_with(&options).await {
        Ok(connection) => connection,
        Err(_) => return (-1, -1),
    };
    let conversations = sqlx::query_scalar::<_, i64>("select count(*) from conversations")
        .fetch_one(&mut connection)
        .await
        .unwrap_or(-1);
    let notes = sqlx::query_scalar::<_, i64>("select count(*) from notes")
        .fetch_one(&mut connection)
        .await
        .unwrap_or(-1);
    let _ = connection.close().await;
    (conversations, notes)
}

async fn profile_info(directory: &Path, kind: &str, is_current: bool) -> DataProfileInfo {
    let database = directory.join("note.db");
    let note_db_bytes = fs::metadata(&database).map(|metadata| metadata.len()).unwrap_or(0);
    let (article_files, article_bytes, article_updated) =
        walk_article_stats(&directory.join("article"));
    let (conversations, notes) = count_library(&database).await;
    DataProfileInfo {
        path: directory.to_string_lossy().to_string(),
        kind: kind.to_string(),
        note_db_bytes,
        article_files,
        article_bytes,
        conversations,
        notes,
        has_api_key: store_has_api_key(directory),
        updated_at: latest_modified(directory).max(article_updated),
        is_current,
    }
}

fn profile_has_data(profile: &DataProfileInfo) -> bool {
    profile.conversations > 0 || profile.notes > 0 || profile.article_files > 0
}

fn same_directory(left: &Path, right: &Path) -> bool {
    let canonical_left = fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let canonical_right = fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    canonical_left == canonical_right
}

fn is_known_profile_path(path: &Path) -> bool {
    let Some(home) = user_home() else {
        return false;
    };
    let Ok(canonical) = fs::canonicalize(path) else {
        return false;
    };
    let is_profile_name = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(PROFILE_DIR_NAME));
    if !is_profile_name {
        return false;
    }
    let app_data_roots = [
        home.join("AppData").join("Roaming"),
        home.join("AppData").join("Local").join("Packages"),
    ];
    app_data_roots.iter().any(|root| {
        let canonical_root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        canonical.starts_with(canonical_root)
    })
}

fn app_data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))
}

/// The store plugin silently starts from an empty store when store.json cannot
/// be parsed, and the settings store then writes defaults back. Keep a copy of
/// the damaged file and surface a notice instead of losing it without a trace.
pub fn protect_corrupt_store(app: &AppHandle) {
    let Ok(current) = app_data_directory(app) else {
        return;
    };
    let store_path = current.join("store.json");
    let Ok(content) = fs::read(&store_path) else {
        return;
    };
    if content.len() < 2 || serde_json::from_slice::<serde_json::Value>(&content).is_ok() {
        return;
    }
    let backup = current.join(format!("store.json.corrupt-{}", now_millis()));
    if fs::copy(&store_path, &backup).is_err() {
        return;
    }
    let notice = serde_json::json!({
        "backupPath": backup.to_string_lossy(),
        "detectedAt": now_millis(),
    });
    let _ = fs::write(current.join(CORRUPT_STORE_NOTICE), notice.to_string());
}

#[tauri::command]
pub fn sixu_read_store_recovery(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let current = app_data_directory(&app)?;
    let path = current.join(CORRUPT_STORE_NOTICE);
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("无法读取配置恢复记录：{error}"))?;
    Ok(serde_json::from_str::<serde_json::Value>(&content).ok())
}

#[tauri::command]
pub fn sixu_clear_store_recovery(app: AppHandle) -> Result<(), String> {
    let current = app_data_directory(&app)?;
    let path = current.join(CORRUPT_STORE_NOTICE);
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("无法清理配置恢复记录：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn sixu_scan_data_profiles(app: AppHandle) -> Result<DataProfileReport, String> {
    let current = app_data_directory(&app)?;
    let current_profile = profile_info(&current, "current", true).await;
    let mut candidates = Vec::new();
    for (directory, kind) in candidate_profile_dirs() {
        if !directory.is_dir() || same_directory(&directory, &current) {
            continue;
        }
        let profile = profile_info(&directory, kind, false).await;
        if profile_has_data(&profile) {
            candidates.push(profile);
        }
    }
    candidates.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(DataProfileReport {
        current: current.to_string_lossy().to_string(),
        current_populated: profile_has_data(&current_profile),
        candidates,
    })
}

/// Queue a one-time import that runs in the native setup hook before the next
/// start opens the database. The database is never replaced while it is open.
#[tauri::command]
pub fn sixu_schedule_data_profile_import(app: AppHandle, source: String) -> Result<(), String> {
    let current = app_data_directory(&app)?;
    let source_path = PathBuf::from(&source);
    if !source_path.is_dir() {
        return Err("要导入的数据目录不存在".to_string());
    }
    if same_directory(&source_path, &current) {
        return Err("不能把当前数据目录导入到自身".to_string());
    }
    if !is_known_profile_path(&source_path) {
        return Err("只允许导入思序自己的数据目录".to_string());
    }
    if !source_path.join("note.db").is_file() {
        return Err("该目录里没有思序数据库".to_string());
    }
    fs::create_dir_all(&current).map_err(|error| format!("无法创建数据目录：{error}"))?;
    let request = ImportRequest {
        source: source_path.to_string_lossy().to_string(),
        requested_at: now_millis(),
    };
    let content = serde_json::to_vec(&request).map_err(|error| format!("无法写入导入请求：{error}"))?;
    fs::write(current.join(IMPORT_REQUEST_FILE), content)
        .map_err(|error| format!("无法写入导入请求：{error}"))?;
    Ok(())
}

#[tauri::command]
pub fn sixu_read_import_result(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let current = app_data_directory(&app)?;
    let path = current.join(IMPORT_RESULT_FILE);
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("无法读取导入结果：{error}"))?;
    Ok(serde_json::from_str::<serde_json::Value>(&content).ok())
}

#[tauri::command]
pub fn sixu_clear_import_result(app: AppHandle) -> Result<(), String> {
    let current = app_data_directory(&app)?;
    let path = current.join(IMPORT_RESULT_FILE);
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("无法清理导入结果：{error}"))?;
    }
    Ok(())
}

fn copy_directory(source: &Path, target: &Path, overwrite: bool) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(target).map_err(|error| format!("无法创建目录 {}：{error}", target.display()))?;
    for entry in fs::read_dir(source).map_err(|error| format!("无法读取目录 {}：{error}", source.display()))? {
        let entry = entry.map_err(|error| format!("无法读取目录项：{error}"))?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| format!("无法检查 {}：{error}", entry.path().display()))?;
        if metadata.is_symlink() {
            continue;
        }
        let destination = target.join(entry.file_name());
        if metadata.is_dir() {
            copy_directory(&entry.path(), &destination, overwrite)?;
        } else if metadata.is_file() && (overwrite || !destination.exists()) {
            fs::copy(entry.path(), &destination)
                .map_err(|error| format!("无法复制 {}：{error}", entry.path().display()))?;
        }
    }
    Ok(())
}

async fn snapshot_database(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| format!("无法替换临时快照：{error}"))?;
    }
    let options = SqliteConnectOptions::new().filename(source).read_only(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| format!("无法打开旧数据库：{error}"))?;
    let destination_sql = destination.to_string_lossy().replace('\'', "''");
    let result = sqlx::query(&format!("VACUUM INTO '{destination_sql}'"))
        .execute(&mut connection)
        .await;
    let closed = connection.close().await;
    result.map_err(|error| format!("无法创建数据库快照：{error}"))?;
    closed.map_err(|error| format!("无法关闭旧数据库：{error}"))?;
    Ok(())
}

// An imported store may still point its workspace at the old profile. The
// default workspace of the imported article tree is the current profile, so
// rewrite a workspace path that lived inside the imported directory.
fn normalize_imported_store(store_path: &Path, source: &Path) {
    let Ok(content) = fs::read_to_string(store_path) else {
        return;
    };
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return;
    };
    let source_key = fs::canonicalize(source)
        .unwrap_or_else(|_| source.to_path_buf())
        .to_string_lossy()
        .to_lowercase();
    let workspace = value
        .get("workspacePath")
        .and_then(|path| path.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    if workspace.is_empty() || !workspace.to_lowercase().starts_with(&source_key) {
        return;
    }
    if let Some(object) = value.as_object_mut() {
        object.insert("workspacePath".to_string(), serde_json::Value::String(String::new()));
        object.remove("workspaceHistory");
    }
    if let Ok(bytes) = serde_json::to_vec(&value) {
        let _ = fs::write(store_path, bytes);
    }
}

async fn import_profile(source: &Path, current: &Path) -> Result<ImportResult, String> {    let timestamp = now_millis();
    let backup_directory = current.join("backups").join(format!("import-before-{timestamp}"));
    fs::create_dir_all(&backup_directory)
        .map_err(|error| format!("无法创建导入前备份目录：{error}"))?;
    for name in ["note.db", "note.db-wal", "note.db-shm", "store.json", "sixu-writing.json"] {
        let path = current.join(name);
        if path.is_file() {
            fs::copy(&path, backup_directory.join(name))
                .map_err(|error| format!("无法备份 {name}：{error}"))?;
        }
    }
    copy_directory(&current.join("article"), &backup_directory.join("article"), true)?;

    let snapshot = current.join(SNAPSHOT_FILE);
    let snapshot_result = snapshot_database(&source.join("note.db"), &snapshot).await;
    if snapshot_result.is_err() {
        // Fallback for a database that cannot be opened read-only (for example a
        // vanished WAL sidecar): copy the raw files. The profile is closed by
        // definition here because the app is in its native setup phase.
        for name in ["note.db", "note.db-wal", "note.db-shm"] {
            let path = source.join(name);
            if path.is_file() {
                fs::copy(&path, current.join(name))
                    .map_err(|error| format!("无法复制 {name}：{error}"))?;
            }
        }
    } else {
        for name in ["note.db-wal", "note.db-shm"] {
            let path = current.join(name);
            if path.exists() {
                fs::remove_file(&path).map_err(|error| format!("无法清理旧数据库状态：{error}"))?;
            }
        }
        fs::rename(&snapshot, current.join("note.db"))
            .map_err(|error| format!("无法替换数据库：{error}"))?;
    }

    for name in ["store.json", "sixu-writing.json"] {
        let path = source.join(name);
        if path.is_file() {
            fs::copy(&path, current.join(name))
                .map_err(|error| format!("无法复制 {name}：{error}"))?;
        }
    }
    normalize_imported_store(&current.join("store.json"), source);
    copy_directory(&source.join("article"), &current.join("article"), false)?;

    let (conversations, _) = count_library(&current.join("note.db")).await;
    let (article_files, _, _) = walk_article_stats(&current.join("article"));
    Ok(ImportResult {
        source: source.to_string_lossy().to_string(),
        conversations,
        article_files,
        completed_at: now_millis(),
        backup_directory: Some(backup_directory.to_string_lossy().to_string()),
    })
}

/// Runs before the webview starts. Importing here guarantees the database is
/// replaced while no SQLite connection is open.
pub fn run_pending_import(app: &AppHandle) {
    let Ok(current) = app_data_directory(app) else {
        return;
    };
    let request_path = current.join(IMPORT_REQUEST_FILE);
    let Ok(content) = fs::read_to_string(&request_path) else {
        return;
    };
    let request = match serde_json::from_str::<ImportRequest>(&content) {
        Ok(request) => request,
        Err(_) => {
            let _ = fs::remove_file(&request_path);
            return;
        }
    };
    let source = PathBuf::from(&request.source);
    let prepared = source.is_dir()
        && source.join("note.db").is_file()
        && !same_directory(&source, &current)
        && is_known_profile_path(&source);
    let outcome = if prepared {
        tauri::async_runtime::block_on(import_profile(&source, &current))
    } else {
        Err("要导入的数据目录已不可用".to_string())
    };
    let written = match outcome {
        Ok(result) => serde_json::to_vec(&result)
            .map_err(|error| format!("无法序列化导入结果：{error}"))
            .and_then(|bytes| fs::write(current.join(IMPORT_RESULT_FILE), bytes).map_err(|error| format!("无法写入导入结果：{error}"))),
        Err(error) => {
            let failure = ImportFailure {
                source: request.source,
                error,
                completed_at: now_millis(),
            };
            serde_json::to_vec(&failure)
                .map_err(|error| format!("无法序列化导入失败：{error}"))
                .and_then(|bytes| fs::write(current.join(IMPORT_RESULT_FILE), bytes).map_err(|error| format!("无法写入导入结果：{error}")))
        }
    };
    if written.is_err() {
        eprintln!("sixu profile import failed: {:?}", written.err());
    }
    let _ = fs::remove_file(&request_path);
}
