mod ai;
mod backup;
mod db;
mod platform;
mod runner;

use std::{env, path::PathBuf, sync::Mutex};
use tauri::Manager;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct AppPaths {
    pub root: PathBuf,
    pub database: PathBuf,
    pub attachments: PathBuf,
    pub platforms: PathBuf,
    pub backups: PathBuf,
}

impl AppPaths {
    pub fn new() -> Result<Self, String> {
        let root = env::var_os("PROOFLINE_DATA_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or(
                dirs::data_local_dir()
                    .ok_or_else(|| "无法确定 Windows 本地数据目录".to_string())?
                    .join("Xiti"),
            );
        let backups = env::var_os("PROOFLINE_BACKUP_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                dirs::document_dir()
                    .unwrap_or_else(|| root.clone())
                    .join("析题")
                    .join("备份")
            });
        Ok(Self {
            database: root.join("xiti.sqlite"),
            attachments: root.join("attachments"),
            platforms: root.join("platforms"),
            root,
            backups,
        })
    }

    pub fn ensure(&self) -> Result<(), String> {
        for directory in [
            &self.root,
            &self.attachments,
            &self.platforms,
            &self.backups,
        ] {
            std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[test]
    fn explicit_test_paths_do_not_change_default_directory_contract() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("data");
        let backups = temp.path().join("backups");
        env::set_var("PROOFLINE_DATA_DIR", &data);
        env::set_var("PROOFLINE_BACKUP_DIR", &backups);
        let paths = AppPaths::new().unwrap();
        env::remove_var("PROOFLINE_DATA_DIR");
        env::remove_var("PROOFLINE_BACKUP_DIR");
        assert_eq!(paths.root, data);
        assert_eq!(paths.backups, backups);
        assert_eq!(paths.database, paths.root.join("xiti.sqlite"));
    }
}

pub struct AppState {
    pub paths: AppPaths,
    pub ai_request: Mutex<Option<(Uuid, CancellationToken)>>,
    pub platform_import: Mutex<Option<(Uuid, CancellationToken)>>,
}

pub fn run() {
    let paths = AppPaths::new().expect("无法初始化 Proofline 数据目录");
    db::initialize(&paths).expect("无法初始化 Proofline 数据库");

    tauri::Builder::default()
        .manage(AppState {
            paths,
            ai_request: Mutex::new(None),
            platform_import: Mutex::new(None),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            platform::open_platform,
            platform::arrange_platform,
            platform::get_platform_current_url,
            platform::open_external,
            platform::clear_platform_profile,
            platform::fetch_public_problem,
            platform::fetch_public_problem_range,
            platform::cancel_public_problem_range,
            backup::load_app_data,
            backup::save_app_data,
            backup::apply_database_migrations,
            backup::get_data_directory,
            backup::open_data_directory,
            backup::create_backup,
            backup::restore_backup,
            backup::export_data,
            backup::import_data,
            backup::store_attachment,
            backup::delete_attachment,
            backup::delete_all_user_data,
            db::search_knowledge,
            ai::save_ai_credential,
            ai::delete_ai_credential,
            ai::has_ai_credential,
            ai::test_ai_connection,
            ai::request_ai_hint,
            ai::cancel_ai_request,
            runner::run_cpp_code,
        ])
        .run(tauri::generate_context!())
        .expect("Proofline 桌面应用运行失败");
}
