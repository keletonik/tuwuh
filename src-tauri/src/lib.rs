pub mod ai;
pub mod error;
pub mod fs_ops;
pub mod pty;
pub mod settings;
pub mod watcher;

use tauri::Manager;

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
            // orphaned processes after every close.
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(terminals) = window.app_handle().try_state::<pty::Terminals>() {
                    pty::kill_all(&terminals);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("tuwuh failed to start");
}
