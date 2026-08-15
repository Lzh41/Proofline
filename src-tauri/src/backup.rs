use crate::{db, AppState};
use chrono::{DateTime, Datelike, Local};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Seek, Write},
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;
use zip::{write::FileOptions, CompressionMethod, ZipArchive, ZipWriter};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format: &'static str,
    pub version: u32,
    pub created_at: String,
    pub app_version: &'static str,
    pub includes_attachments: bool,
    pub includes_credentials: bool,
    pub includes_platform_profiles: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRecord {
    pub id: String,
    pub relative_path: String,
    pub original_name: String,
    pub byte_size: usize,
    pub sha256: String,
}

#[tauri::command]
pub fn load_app_data(state: State<'_, AppState>) -> Result<Option<Value>, String> {
    db::load_snapshot(&state.paths.database)
}

#[tauri::command]
pub fn save_app_data(state: State<'_, AppState>, snapshot: Value) -> Result<(), String> {
    db::save_snapshot(&state.paths.database, &snapshot)
}

#[tauri::command]
pub fn apply_database_migrations(state: State<'_, AppState>) -> Result<(), String> {
    db::apply_migrations(&state.paths.database)
}

#[tauri::command]
pub fn get_data_directory(state: State<'_, AppState>) -> String {
    state.paths.root.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn open_data_directory(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    app.opener()
        .open_path(state.paths.root.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_backup(
    state: State<'_, AppState>,
    snapshot: Option<Value>,
) -> Result<String, String> {
    if let Some(snapshot) = snapshot {
        db::save_snapshot(&state.paths.database, &snapshot)?;
    }
    db::checkpoint(&state.paths.database)?;
    fs::create_dir_all(&state.paths.backups).map_err(|error| error.to_string())?;
    let now = Local::now();
    let file_name = format!(
        "xiti-backup-{}.xiti-backup.zip",
        now.format("%Y%m%d-%H%M%S")
    );
    let destination = state.paths.backups.join(file_name);
    write_backup_archive(&state.paths, &destination, &now)?;
    prune_backups(&state.paths.backups)?;
    Ok(destination.to_string_lossy().into_owned())
}

fn write_backup_archive(
    paths: &crate::AppPaths,
    destination: &Path,
    created_at: &DateTime<Local>,
) -> Result<(), String> {
    let file = File::create(destination).map_err(|error| error.to_string())?;
    let mut writer = ZipWriter::new(file);
    let options = FileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600);
    let manifest = BackupManifest {
        format: "xiti-backup",
        version: 1,
        created_at: created_at.to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION"),
        includes_attachments: true,
        includes_credentials: false,
        includes_platform_profiles: false,
    };
    writer
        .start_file("manifest.json", options)
        .map_err(|error| error.to_string())?;
    writer
        .write_all(
            serde_json::to_string_pretty(&manifest)
                .map_err(|error| error.to_string())?
                .as_bytes(),
        )
        .map_err(|error| error.to_string())?;
    writer
        .start_file("xiti.sqlite", options)
        .map_err(|error| error.to_string())?;
    let mut database = File::open(&paths.database).map_err(|error| error.to_string())?;
    std::io::copy(&mut database, &mut writer).map_err(|error| error.to_string())?;
    write_attachment_entries(&mut writer, &paths.attachments, options)?;
    writer.finish().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn restore_backup(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<Option<Value>, String> {
    let source = match path {
        Some(path) => PathBuf::from(path),
        None => latest_backup(&state.paths.backups)?
            .ok_or_else(|| "默认备份目录中没有可恢复的备份".to_string())?,
    };
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if !name.ends_with(".xiti-backup.zip") {
        return Err("请选择 .xiti-backup.zip 备份文件".to_string());
    }
    restore_backup_from_path(&state.paths, &source)
}

fn restore_backup_from_path(
    paths: &crate::AppPaths,
    source: &Path,
) -> Result<Option<Value>, String> {
    let file = File::open(source).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let manifest: BackupManifestInput = {
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|_| "备份缺少 manifest.json".to_string())?;
        let mut raw = String::new();
        entry
            .read_to_string(&mut raw)
            .map_err(|error| error.to_string())?;
        serde_json::from_str(&raw).map_err(|_| "备份清单格式无效".to_string())?
    };
    if manifest.format != "xiti-backup" || manifest.version != 1 {
        return Err("不支持此备份格式或版本".to_string());
    }
    let mut entry = archive
        .by_name("xiti.sqlite")
        .map_err(|_| "备份缺少数据库文件".to_string())?;
    let temp = tempfile::NamedTempFile::new_in(&paths.root).map_err(|error| error.to_string())?;
    let (mut output, temp_path) = temp.keep().map_err(|error| error.error.to_string())?;
    std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
    output.flush().map_err(|error| error.to_string())?;
    drop(output);
    drop(entry);
    verify_database(&temp_path)?;

    let extracted_attachments = if manifest.includes_attachments {
        let directory = tempfile::tempdir_in(&paths.root).map_err(|error| error.to_string())?;
        let destination = directory.path().join("attachments");
        fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
        extract_attachment_entries(&mut archive, &destination)?;
        Some((directory, destination))
    } else {
        None
    };

    let database_rollback = paths.root.join("xiti.sqlite.restore-rollback");
    let attachments_rollback = paths.root.join("attachments.restore-rollback");
    let _ = fs::remove_file(&database_rollback);
    remove_directory_with_retry(&attachments_rollback)?;
    let had_database = paths.database.exists();
    let had_attachments = paths.attachments.exists();
    let restore_attachments = extracted_attachments.is_some();
    let _ = fs::remove_file(paths.database.with_extension("sqlite-wal"));
    let _ = fs::remove_file(paths.database.with_extension("sqlite-shm"));
    if had_database {
        fs::rename(&paths.database, &database_rollback).map_err(|error| error.to_string())?;
    }
    if restore_attachments && had_attachments {
        if let Err(error) = fs::rename(&paths.attachments, &attachments_rollback) {
            if had_database {
                let _ = fs::rename(&database_rollback, &paths.database);
            }
            let _ = fs::remove_file(&temp_path);
            return Err(format!("准备恢复附件失败：{error}"));
        }
    }

    let install_result = (|| -> Result<Option<Value>, String> {
        fs::rename(&temp_path, &paths.database)
            .map_err(|error| format!("恢复数据库失败：{error}"))?;
        if let Some((_directory, extracted_path)) = extracted_attachments.as_ref() {
            fs::rename(extracted_path, &paths.attachments)
                .map_err(|error| format!("恢复附件失败：{error}"))?;
        }
        db::apply_migrations(&paths.database).map_err(|error| format!("备份迁移失败：{error}"))?;
        db::load_snapshot(&paths.database).map_err(|error| format!("读取恢复数据失败：{error}"))
    })();

    match install_result {
        Ok(snapshot) => {
            let _ = fs::remove_file(database_rollback);
            let _ = remove_directory_with_retry(&attachments_rollback);
            Ok(snapshot)
        }
        Err(error) => {
            let rollback_result = rollback_restored_data(
                paths,
                &database_rollback,
                &attachments_rollback,
                had_database,
                had_attachments,
                restore_attachments,
            );
            let _ = fs::remove_file(&temp_path);
            match rollback_result {
                Ok(()) => Err(format!("{error}，已回滚原数据")),
                Err(rollback_error) => {
                    Err(format!("{error}；回滚原数据时又发生错误：{rollback_error}"))
                }
            }
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifestInput {
    format: String,
    version: u32,
    #[serde(default)]
    includes_attachments: bool,
}

const MAX_BACKUP_ATTACHMENT_FILES: usize = 10_000;
const MAX_BACKUP_ATTACHMENT_BYTES: u64 = 512 * 1024 * 1024;

fn write_attachment_entries(
    writer: &mut ZipWriter<File>,
    attachments: &Path,
    options: FileOptions,
) -> Result<(), String> {
    let mut files = Vec::new();
    collect_attachment_files(attachments, attachments, &mut files)?;
    for path in files {
        let relative = path
            .strip_prefix(attachments)
            .map_err(|_| "附件路径不在附件目录中".to_string())?;
        let archive_path = safe_attachment_archive_path(relative)?;
        writer
            .start_file(format!("attachments/{archive_path}"), options)
            .map_err(|error| error.to_string())?;
        let mut input = File::open(&path).map_err(|error| error.to_string())?;
        std::io::copy(&mut input, writer).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn collect_attachment_files(
    root: &Path,
    directory: &Path,
    output: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let path = entry.path();
        if file_type.is_symlink() {
            return Err(format!(
                "附件目录包含不允许备份的符号链接：{}",
                path.display()
            ));
        }
        if file_type.is_dir() {
            collect_attachment_files(root, &path, output)?;
        } else if file_type.is_file() {
            path.strip_prefix(root)
                .map_err(|_| "附件路径不在附件目录中".to_string())?;
            output.push(path);
        }
    }
    Ok(())
}

fn safe_attachment_archive_path(relative: &Path) -> Result<String, String> {
    let mut segments = Vec::new();
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err("附件路径包含不安全的目录组件".to_string());
        };
        let value = segment
            .to_str()
            .filter(|value| !value.is_empty() && !value.contains(':'))
            .ok_or_else(|| "附件路径包含不支持的文件名".to_string())?;
        segments.push(value);
    }
    if segments.is_empty() {
        return Err("附件路径不能为空".to_string());
    }
    Ok(segments.join("/"))
}

fn extract_attachment_entries<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    destination: &Path,
) -> Result<(), String> {
    let mut file_count = 0_usize;
    let mut total_bytes = 0_u64;
    let mut extracted_paths = HashSet::new();

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = entry.name().to_string();
        if name != "attachments/" && !name.starts_with("attachments/") {
            continue;
        }
        if name.contains('\\')
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(format!("备份包含不安全的附件条目：{name}"));
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| format!("备份包含路径穿越条目：{name}"))?
            .to_path_buf();
        let relative = enclosed
            .strip_prefix("attachments")
            .map_err(|_| format!("备份附件路径无效：{name}"))?;
        if relative.as_os_str().is_empty() {
            continue;
        }
        let normalized = safe_attachment_archive_path(relative)?;
        let duplicate_key = normalized.to_ascii_lowercase();
        if !extracted_paths.insert(duplicate_key) {
            return Err(format!("备份包含重复的附件路径：{name}"));
        }
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            continue;
        }

        file_count += 1;
        total_bytes = total_bytes
            .checked_add(entry.size())
            .ok_or_else(|| "备份附件总大小溢出".to_string())?;
        if file_count > MAX_BACKUP_ATTACHMENT_FILES || total_bytes > MAX_BACKUP_ATTACHMENT_BYTES {
            return Err("备份附件超过 10000 个或解压后总大小超过 512 MB".to_string());
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = File::create(&target).map_err(|error| error.to_string())?;
        let written = std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        if written != entry.size() {
            return Err(format!("备份附件大小不一致：{name}"));
        }
        output.flush().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn rollback_restored_data(
    paths: &crate::AppPaths,
    database_rollback: &Path,
    attachments_rollback: &Path,
    had_database: bool,
    had_attachments: bool,
    restore_attachments: bool,
) -> Result<(), String> {
    let _ = fs::remove_file(paths.database.with_extension("sqlite-wal"));
    let _ = fs::remove_file(paths.database.with_extension("sqlite-shm"));
    if paths.database.exists() {
        fs::remove_file(&paths.database).map_err(|error| error.to_string())?;
    }
    if had_database {
        if !database_rollback.exists() {
            return Err("数据库回滚文件丢失".to_string());
        }
        fs::rename(database_rollback, &paths.database).map_err(|error| error.to_string())?;
    }

    if restore_attachments {
        remove_directory_with_retry(&paths.attachments)?;
        if had_attachments {
            if !attachments_rollback.exists() {
                return Err("附件回滚目录丢失".to_string());
            }
            fs::rename(attachments_rollback, &paths.attachments)
                .map_err(|error| error.to_string())?;
        } else {
            fs::create_dir_all(&paths.attachments).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn export_data(
    state: State<'_, AppState>,
    snapshot: Option<Value>,
    path: Option<String>,
) -> Result<String, String> {
    let snapshot = match snapshot {
        Some(snapshot) => {
            db::save_snapshot(&state.paths.database, &snapshot)?;
            snapshot
        }
        None => db::load_snapshot(&state.paths.database)?.unwrap_or(Value::Null),
    };
    let destination = match path {
        Some(path) => PathBuf::from(path),
        None => {
            let directory = state
                .paths
                .backups
                .parent()
                .unwrap_or(&state.paths.root)
                .join("导出");
            directory.join(format!(
                "xiti-export-{}.json",
                Local::now().format("%Y%m%d-%H%M%S")
            ))
        }
    };
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_vec_pretty(&snapshot).map_err(|error| error.to_string())?;
    fs::write(&destination, raw).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn import_data(_state: State<'_, AppState>, path: Option<String>) -> Result<Value, String> {
    let path = path.ok_or_else(|| "请先选择要导入的 JSON 文件".to_string())?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > 25 * 1024 * 1024 {
        return Err("JSON 导入文件不能超过 25 MB".to_string());
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let snapshot = value.get("snapshot").cloned().unwrap_or(value);
    if !snapshot.is_object() || !snapshot.get("schemaVersion").is_some() {
        return Err("导入文件必须是 Proofline 导出的 JSON 对象".to_string());
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn store_attachment(
    state: State<'_, AppState>,
    problem_id: Option<String>,
    file_name: String,
    content_type: Option<String>,
    data: Vec<u8>,
) -> Result<AttachmentRecord, String> {
    if data.len() > 20 * 1024 * 1024 {
        return Err("单个附件不能超过 20 MB".to_string());
    }
    let original_name = Path::new(&file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "附件名称无效".to_string())?
        .to_string();
    let safe_name: String = original_name
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .take(120)
        .collect();
    let id = Uuid::new_v4().to_string();
    let relative_path = format!("attachments/{id}-{safe_name}");
    let absolute_path = state.paths.root.join(&relative_path);
    fs::write(&absolute_path, &data).map_err(|error| error.to_string())?;
    let sha256 = format!("{:x}", Sha256::digest(&data));
    let connection = db::open_database(&state.paths.database)?;
    if let Err(error) = connection.execute(
        "INSERT INTO attachments(id, problem_id, relative_path, original_name, content_type, byte_size, sha256, created_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            problem_id,
            relative_path,
            original_name,
            content_type,
            data.len() as i64,
            sha256,
            db::now_millis()
        ],
    ) {
        let _ = fs::remove_file(&absolute_path);
        return Err(error.to_string());
    }
    Ok(AttachmentRecord {
        id,
        relative_path,
        original_name,
        byte_size: data.len(),
        sha256,
    })
}

#[tauri::command]
pub fn delete_attachment(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let connection = db::open_database(&state.paths.database)?;
    let relative_path: String = connection
        .query_row(
            "SELECT relative_path FROM attachments WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|_| "未找到该附件".to_string())?;
    let relative = Path::new(&relative_path);
    if relative.is_absolute()
        || !relative.starts_with("attachments")
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("附件路径不安全，已拒绝删除".to_string());
    }
    let absolute_path = state.paths.root.join(&relative_path);
    if absolute_path.exists() {
        fs::remove_file(&absolute_path).map_err(|error| error.to_string())?;
    }
    connection
        .execute("DELETE FROM attachments WHERE id = ?1", [&id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Clears only user-controlled local state. The capability file exposes this command to the
/// `main` window only; remote platform webviews never receive a matching capability.
#[tauri::command]
pub fn delete_all_user_data(
    app: AppHandle,
    state: State<'_, AppState>,
    include_backups: bool,
) -> Result<(), String> {
    for source in ["leetcode-cn", "leetcode", "nowcoder"] {
        if let Some(window) = app.get_webview_window(&format!("platform-{source}")) {
            let _ = window.close();
        }
    }
    crate::ai::delete_stored_credential()?;
    reset_local_paths(&state.paths, include_backups)
}

fn reset_local_paths(paths: &crate::AppPaths, include_backups: bool) -> Result<(), String> {
    remove_directory_with_retry(&paths.root)?;
    if include_backups {
        remove_directory_with_retry(&paths.backups)?;
    }
    db::initialize(paths)
}

fn remove_directory_with_retry(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let mut last_error = None;
    for _ in 0..10 {
        match fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = Some(error);
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }
    Err(format!(
        "无法删除数据目录 {}：{}",
        path.display(),
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "未知错误".to_string())
    ))
}

fn verify_database(path: &Path) -> Result<(), String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    let result: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if result != "ok" {
        return Err(format!("备份数据库完整性校验失败：{result}"));
    }
    Ok(())
}

fn prune_backups(directory: &Path) -> Result<(), String> {
    let mut entries: Vec<_> = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.ends_with(".xiti-backup.zip"))
        })
        .collect();
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));

    let mut kept_days = HashSet::new();
    let mut kept_weeks = HashSet::new();
    let mut keep_paths = HashSet::new();
    for entry in &entries {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let date = name
            .get(12..20)
            .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y%m%d").ok());
        if let Some(date) = date {
            if kept_days.len() < 7 && kept_days.insert(date) {
                keep_paths.insert(entry.path());
                continue;
            }
            let week = (date.iso_week().year(), date.iso_week().week());
            if kept_weeks.len() < 4 && kept_weeks.insert(week) {
                keep_paths.insert(entry.path());
            }
        }
    }
    for entry in entries {
        if !keep_paths.contains(&entry.path()) {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn latest_backup(directory: &Path) -> Result<Option<PathBuf>, String> {
    if !directory.exists() {
        return Ok(None);
    }
    let mut entries: Vec<_> = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.ends_with(".xiti-backup.zip"))
        })
        .collect();
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
    Ok(entries.first().map(|entry| entry.path()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_paths(temp: &tempfile::TempDir) -> crate::AppPaths {
        let root = temp.path().join("local").join("Xiti");
        crate::AppPaths {
            database: root.join("xiti.sqlite"),
            attachments: root.join("attachments"),
            platforms: root.join("platforms"),
            root,
            backups: temp.path().join("documents").join("析题").join("备份"),
        }
    }

    #[test]
    fn reset_preserves_or_removes_backups_by_explicit_choice() {
        let temp = tempfile::tempdir().unwrap();
        let paths = test_paths(&temp);
        db::initialize(&paths).unwrap();
        fs::write(paths.attachments.join("temporary.txt"), b"test").unwrap();
        fs::write(paths.backups.join("kept.xiti-backup.zip"), b"test").unwrap();

        reset_local_paths(&paths, false).unwrap();
        assert!(paths.database.exists());
        assert!(!paths.attachments.join("temporary.txt").exists());
        assert!(paths.backups.join("kept.xiti-backup.zip").exists());

        reset_local_paths(&paths, true).unwrap();
        assert!(paths.database.exists());
        assert!(!paths.backups.join("kept.xiti-backup.zip").exists());
    }

    #[test]
    fn backup_round_trip_replaces_database_and_attachments() {
        let temp = tempfile::tempdir().unwrap();
        let paths = test_paths(&temp);
        db::initialize(&paths).unwrap();
        let original = json!({"marker": "original", "problems": []});
        db::save_snapshot(&paths.database, &original).unwrap();
        let nested = paths.attachments.join("notes");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("proof.txt"), b"original attachment").unwrap();

        let archive_path = paths.backups.join("round-trip.xiti-backup.zip");
        write_backup_archive(&paths, &archive_path, &Local::now()).unwrap();
        let file = File::open(&archive_path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        assert!(archive.by_name("attachments/notes/proof.txt").is_ok());
        drop(archive);

        db::save_snapshot(
            &paths.database,
            &json!({"marker": "changed", "problems": []}),
        )
        .unwrap();
        fs::remove_dir_all(&paths.attachments).unwrap();
        fs::create_dir_all(&paths.attachments).unwrap();
        fs::write(paths.attachments.join("stale.txt"), b"stale").unwrap();

        let restored = restore_backup_from_path(&paths, &archive_path)
            .unwrap()
            .unwrap();
        assert_eq!(restored, original);
        assert_eq!(
            fs::read(paths.attachments.join("notes").join("proof.txt")).unwrap(),
            b"original attachment"
        );
        assert!(!paths.attachments.join("stale.txt").exists());
    }

    #[test]
    fn restore_rejects_attachment_path_traversal_without_touching_live_data() {
        let temp = tempfile::tempdir().unwrap();
        let paths = test_paths(&temp);
        db::initialize(&paths).unwrap();
        let original = json!({"marker": "safe", "problems": []});
        db::save_snapshot(&paths.database, &original).unwrap();
        fs::write(paths.attachments.join("kept.txt"), b"keep me").unwrap();

        let archive_path = paths.backups.join("unsafe.xiti-backup.zip");
        let file = File::create(&archive_path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = FileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file("manifest.json", options).unwrap();
        writer
            .write_all(br#"{"format":"xiti-backup","version":1,"includesAttachments":true}"#)
            .unwrap();
        writer.start_file("xiti.sqlite", options).unwrap();
        writer
            .write_all(&fs::read(&paths.database).unwrap())
            .unwrap();
        writer
            .start_file("attachments/../../escaped.txt", options)
            .unwrap();
        writer.write_all(b"unsafe").unwrap();
        writer.finish().unwrap();

        let error = restore_backup_from_path(&paths, &archive_path).unwrap_err();
        assert!(error.contains("路径") || error.contains("不安全"));
        assert_eq!(
            db::load_snapshot(&paths.database).unwrap().unwrap(),
            original
        );
        assert_eq!(
            fs::read(paths.attachments.join("kept.txt")).unwrap(),
            b"keep me"
        );
        assert!(!temp.path().join("escaped.txt").exists());
    }

    #[test]
    fn restore_rolls_back_database_and_attachments_when_loaded_snapshot_is_invalid() {
        let temp = tempfile::tempdir().unwrap();
        let paths = test_paths(&temp);
        db::initialize(&paths).unwrap();
        let original = json!({"marker": "before-restore", "problems": []});
        db::save_snapshot(&paths.database, &original).unwrap();
        fs::write(paths.attachments.join("kept.txt"), b"keep me").unwrap();

        let broken_root = temp.path().join("broken");
        let broken_paths = crate::AppPaths {
            database: broken_root.join("xiti.sqlite"),
            attachments: broken_root.join("attachments"),
            platforms: broken_root.join("platforms"),
            root: broken_root.clone(),
            backups: paths.backups.clone(),
        };
        fs::create_dir_all(&broken_paths.attachments).unwrap();
        let connection = Connection::open(&broken_paths.database).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (
                   version INTEGER PRIMARY KEY,
                   name TEXT NOT NULL,
                   applied_at INTEGER NOT NULL
                 );
                 INSERT INTO schema_migrations(version, name, applied_at)
                 VALUES(1, 'broken', 0);",
            )
            .unwrap();
        drop(connection);
        fs::write(
            broken_paths.attachments.join("replacement.txt"),
            b"replacement",
        )
        .unwrap();
        let archive_path = paths.backups.join("rollback.xiti-backup.zip");
        write_backup_archive(&broken_paths, &archive_path, &Local::now()).unwrap();

        let error = restore_backup_from_path(&paths, &archive_path).unwrap_err();
        assert!(error.contains("已回滚原数据"));
        assert_eq!(
            db::load_snapshot(&paths.database).unwrap().unwrap(),
            original
        );
        assert_eq!(
            fs::read(paths.attachments.join("kept.txt")).unwrap(),
            b"keep me"
        );
        assert!(!paths.attachments.join("replacement.txt").exists());
    }
}
