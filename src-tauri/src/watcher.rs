//! Directory watching, so a pane reflects changes made outside the app.
//!
//! Only the directories currently on screen are watched, and never
//! recursively: watching `$HOME` recursively would register tens of thousands
//! of inotify slots and hit the per-user limit. When a pane navigates away its
//! watch is dropped.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChanged {
    pub path: String,
}

#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, RecommendedWatcher>>);

/// A single save can produce several inotify events (write, attrib, close).
/// Re-listing the directory for each one makes the view flicker, so events
/// inside this window collapse into one notification.
const COALESCE: Duration = Duration::from_millis(120);

#[tauri::command]
pub fn watch_dir(app: AppHandle, state: State<'_, Watchers>, path: String) -> AppResult<()> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_dir() {
        return Err(AppError::InvalidPath(format!("{path} is not a directory")));
    }

    let mut map = state.0.lock().unwrap();
    if map.contains_key(&path) {
        return Ok(());
    }

    let emit_path = path.clone();
    let last = Arc::new(Mutex::new(Instant::now() - COALESCE));
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_err() {
            return;
        }
        let mut guard = last.lock().unwrap();
        if guard.elapsed() < COALESCE {
            return;
        }
        *guard = Instant::now();
        drop(guard);
        let _ = app.emit(
            "fs-changed",
            FsChanged {
                path: emit_path.clone(),
            },
        );
    })
    .map_err(|e| AppError::Io(format!("watcher: {e}")))?;

    watcher
        .watch(&p, RecursiveMode::NonRecursive)
        .map_err(|e| AppError::Io(format!("watch {path}: {e}")))?;

    map.insert(path, watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_dir(state: State<'_, Watchers>, path: String) -> AppResult<()> {
    state.0.lock().unwrap().remove(&path);
    Ok(())
}

/// Drop every watch except the ones named. Called when panes navigate, so the
/// inotify slot count tracks what is visible rather than growing all session.
#[tauri::command]
pub fn retain_watches(state: State<'_, Watchers>, keep: Vec<String>) -> AppResult<()> {
    let mut map = state.0.lock().unwrap();
    map.retain(|k, _| keep.contains(k));
    Ok(())
}
