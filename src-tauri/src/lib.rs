pub mod ai;
pub mod error;
pub mod fs_ops;
pub mod pty;
pub mod settings;
pub mod watcher;

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::Manager;

use crate::error::{AppError, AppResult};

static WINDOW_SEQ: AtomicU64 = AtomicU64::new(1);

/// A second window is a new webview on the same app, not a fork of pane state.
/// Each one boots independently from settings, the same as launching Tuwuh again.
#[tauri::command]
fn new_window(app: tauri::AppHandle) -> AppResult<()> {
    let n = WINDOW_SEQ.fetch_add(1, Ordering::Relaxed);
    tauri::WebviewWindowBuilder::new(
        &app,
        format!("w{n}"),
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Tuwuh")
    .inner_size(1280.0, 800.0)
    .min_inner_size(720.0, 480.0)
    .resizable(true)
    .decorations(false)
    .shadow(true)
    .build()
    .map_err(|e| AppError::Io(format!("window: {e}")))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::Terminals::default())
        .manage(watcher::Watchers::default())
        .invoke_handler(tauri::generate_handler![
            fs_ops::list_dir,
            fs_ops::stat_path,
            fs_ops::read_text_file,
            fs_ops::write_text_file,
            fs_ops::create_dir,
            fs_ops::create_file,
            fs_ops::rename_path,
            fs_ops::copy_path,
            fs_ops::move_path,
            fs_ops::trash_path,
            fs_ops::delete_permanent,
            fs_ops::home_dir,
            fs_ops::places,
            fs_ops::search_files,
            fs_ops::dir_size,
            fs_ops::read_preview,
            fs_ops::open_path,
            fs_ops::duplicate_path,
            fs_ops::create_symlink,
            fs_ops::chmod_path,
            fs_ops::free_space,
            fs_ops::list_mounts,
            fs_ops::list_trash,
            fs_ops::restore_trash,
            fs_ops::empty_trash,
            fs_ops::purge_trash,
            fs_ops::compress_paths,
            fs_ops::extract_archive,
            new_window,
            pty::spawn_terminal,
            pty::write_terminal,
            pty::resize_terminal,
            pty::close_terminal,
            watcher::watch_dir,
            watcher::unwatch_dir,
            watcher::retain_watches,
            settings::get_settings,
            settings::save_settings,
            settings::set_provider_key,
            settings::has_provider_key,
            settings::delete_provider_key,
            ai::ai_chat,
            ai::provider_status,
        ])
        .on_window_event(|window, event| {
            // Shells outlive the window unless they are killed here, leaving
            // orphaned processes after every close. Only the last window may
            // do this: a second Ctrl+N window sharing the process must not
            // reap the first window's terminals on close.
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if !window.app_handle().webview_windows().is_empty() {
                    return;
                }
                if let Some(terminals) = window.app_handle().try_state::<pty::Terminals>() {
                    pty::kill_all(&terminals);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("tuwuh failed to start");
}
