//! A real pseudo-terminal per terminal pane.
//!
//! The browser prototype parsed `ls` and `cd` in TypeScript against its
//! in-memory tree, so anything it did not implement simply did not exist. Here
//! xterm.js is only the renderer: keystrokes go to a real shell on a real pty,
//! and whatever the user's shell can do, the pane can do.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub id: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExit {
    pub id: String,
    pub code: Option<i32>,
}

struct Terminal {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals(Mutex<HashMap<String, Terminal>>);

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// The user's login shell, falling back to bash then sh. A file manager that
/// hard-coded bash would ignore the fact that this box runs zsh.
fn user_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty() && std::path::Path::new(s).exists())
        .unwrap_or_else(|| {
            for candidate in ["/bin/bash", "/bin/sh"] {
                if std::path::Path::new(candidate).exists() {
                    return candidate.to_owned();
                }
            }
            "/bin/sh".to_owned()
        })
}

#[tauri::command]
pub fn spawn_terminal(
    app: AppHandle,
    state: State<'_, Terminals>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> AppResult<String> {
    let dir = std::path::PathBuf::from(&cwd);
    if !dir.is_dir() {
        return Err(AppError::InvalidPath(format!("{cwd} is not a directory")));
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Terminal(format!("openpty: {e}")))?;

    let shell = crate::settings::get_settings()
        .ok()
        .and_then(|s| s.terminal_shell)
        .filter(|s| !s.trim().is_empty() && std::path::Path::new(s.trim()).exists())
        .unwrap_or_else(user_shell);
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(&dir);
    // Without this the shell assumes a dumb terminal and colour, line editing
    // and cursor addressing all degrade.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::Terminal(format!("spawn shell: {e}")))?;
    // The slave handle must be dropped, or the pty never reports EOF when the
    // shell exits and the reader thread hangs for the life of the process.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Terminal(format!("reader: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::Terminal(format!("writer: {e}")))?;

    let id = format!("t{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));

    let emit_id = id.clone();
    let emit_app = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        // A partial UTF-8 sequence can straddle two reads, so bytes are carried
        // over rather than being replaced with U+FFFD mid-character.
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let text = match std::str::from_utf8(&carry) {
                        Ok(s) => {
                            let owned = s.to_owned();
                            carry.clear();
                            owned
                        }
                        Err(e) => {
                            let good = e.valid_up_to();
                            let owned =
                                String::from_utf8_lossy(&carry[..good]).into_owned();
                            carry.drain(..good);
                            // A genuinely invalid sequence would grow the buffer
                            // without bound; only a trailing partial char is worth
                            // holding.
                            if carry.len() > 8 {
                                carry.clear();
                            }
                            owned
                        }
                    };
                    if !text.is_empty() {
                        let _ = emit_app.emit(
                            "terminal-output",
                            TerminalOutput {
                                id: emit_id.clone(),
                                data: text,
                            },
                        );
                    }
                }
                Err(_) => break,
            }
        }
        let _ = emit_app.emit(
            "terminal-exit",
            TerminalExit {
                id: emit_id.clone(),
                code: None,
            },
        );
    });

    state.0.lock().unwrap().insert(
        id.clone(),
        Terminal {
            master: pair.master,
            writer,
            child,
        },
    );
    Ok(id)
}

#[tauri::command]
pub fn write_terminal(state: State<'_, Terminals>, id: String, data: String) -> AppResult<()> {
    let mut map = state.0.lock().unwrap();
    let t = map
        .get_mut(&id)
        .ok_or_else(|| AppError::Terminal(format!("no terminal {id}")))?;
    t.writer
        .write_all(data.as_bytes())
        .map_err(|e| AppError::Terminal(format!("write: {e}")))?;
    t.writer
        .flush()
        .map_err(|e| AppError::Terminal(format!("flush: {e}")))
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, Terminals>,
    id: String,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    let map = state.0.lock().unwrap();
    let t = map
        .get(&id)
        .ok_or_else(|| AppError::Terminal(format!("no terminal {id}")))?;
    // Without this the shell keeps the old geometry and full-screen programs
    // such as vim or htop draw at the wrong size after a pane drag.
    t.master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Terminal(format!("resize: {e}")))
}

#[tauri::command]
pub fn close_terminal(state: State<'_, Terminals>, id: String) -> AppResult<()> {
    if let Some(mut t) = state.0.lock().unwrap().remove(&id) {
        let _ = t.child.kill();
        let _ = t.child.wait();
    }
    Ok(())
}

/// Terminals are OS processes, not view state: closing the window without this
/// would leave orphaned shells behind on every run.
pub fn kill_all(state: &Terminals) {
    let mut map = state.0.lock().unwrap();
    for (_, mut t) in map.drain() {
        let _ = t.child.kill();
        let _ = t.child.wait();
    }
}

pub type SharedTerminals = Arc<Terminals>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_shell_resolves_to_something_executable() {
        let s = user_shell();
        assert!(
            std::path::Path::new(&s).exists(),
            "resolved shell {s} does not exist"
        );
    }

    #[test]
    fn user_shell_ignores_a_bogus_shell_env() {
        // Safety: the test process is single-threaded at this point and the
        // variable is restored immediately.
        let previous = std::env::var("SHELL").ok();
        unsafe { std::env::set_var("SHELL", "/nonexistent/shell") };
        let s = user_shell();
        assert!(std::path::Path::new(&s).exists());
        match previous {
            Some(v) => unsafe { std::env::set_var("SHELL", v) },
            None => unsafe { std::env::remove_var("SHELL") },
        }
    }
}
