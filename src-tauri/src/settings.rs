//! Persisted preferences, and the API keys kept out of them.
//!
//! Settings live in a plain JSON file under XDG config. Provider keys do not:
//! they go to the OS keyring, and the frontend can ask whether a key is present
//! but can never read one back. That is the whole reason the AI calls are made
//! in `ai.rs` on the Rust side instead of from the webview.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};

const KEYRING_SERVICE: &str = "tuwuh";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
    Xai,
    Openrouter,
    /// Hugging Face Inference Providers router (OpenAI-compatible).
    Huggingface,
    /// Local models over an OpenAI-compatible endpoint. No key needed, which is
    /// why key presence is reported per provider rather than globally.
    Ollama,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
            Provider::Xai => "xai",
            Provider::Openrouter => "openrouter",
            Provider::Huggingface => "huggingface",
            Provider::Ollama => "ollama",
        }
    }

    pub fn needs_key(self) -> bool {
        !matches!(self, Provider::Ollama)
    }

    pub fn default_model(self) -> &'static str {
        match self {
            Provider::Anthropic => "claude-sonnet-5",
            Provider::Openai => "gpt-5",
            Provider::Xai => "grok-4",
            Provider::Openrouter => "anthropic/claude-sonnet-5",
            Provider::Huggingface => "Qwen/Qwen2.5-7B-Instruct:fastest",
            Provider::Ollama => "llama3.2",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub provider: Provider,
    pub model: String,
    /// Last-used model id per provider, so switching radio does not keep the
    /// previous vendor's model name and 404.
    #[serde(default)]
    pub models: std::collections::BTreeMap<String, String>,
    /// Last-used endpoint per provider. A single shared URL used to send
    /// Hugging Face traffic to whatever Ollama override was typed last.
    #[serde(default)]
    pub base_urls: std::collections::BTreeMap<String, String>,
    /// Legacy single override. Read only when `base_urls` has no entry for the
    /// active provider, so older settings files still load.
    pub base_url: Option<String>,
    pub max_tokens: u32,
    pub timeout_ms: u64,
    /// When false the assistant may describe an action but never invokes a
    /// filesystem command. Off by default: a model that can delete files on its
    /// own initiative is not something to opt users into silently.
    pub allow_file_actions: bool,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: Provider::Anthropic,
            model: Provider::Anthropic.default_model().to_owned(),
            models: BTreeMap::new(),
            base_urls: BTreeMap::new(),
            base_url: None,
            max_tokens: 2048,
            timeout_ms: 60_000,
            allow_file_actions: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    pub font_family: String,
    pub font_size: u16,
    pub tab_size: u16,
    pub insert_spaces: bool,
    pub word_wrap: bool,
    pub minimap: bool,
    pub line_numbers: bool,
    pub format_on_save: bool,
    /// Monaco's inline suggestion pass, which is what the request meant by
    /// predictive syntax.
    pub inline_suggestions: bool,
    pub bracket_pair_colorization: bool,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            font_family: "JetBrains Mono, Fira Code, monospace".into(),
            font_size: 13,
            tab_size: 2,
            insert_spaces: true,
            word_wrap: false,
            minimap: true,
            line_numbers: true,
            format_on_save: false,
            inline_suggestions: true,
            bracket_pair_colorization: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewSettings {
    pub show_hidden: bool,
    pub view_mode: String,
    pub sort_by: String,
    pub sort_desc: bool,
    pub dual_pane: bool,
    pub icon_pack: String,
    pub theme: String,
    pub confirm_delete: bool,
    pub single_click_open: bool,
    /// "top", "right" or "bottom". Anything else is treated as bottom by the UI.
    #[serde(default = "default_terminal_dock")]
    pub terminal_dock: String,
    #[serde(default = "default_true")]
    pub restore_last: bool,
    #[serde(default = "default_true")]
    pub folders_first: bool,
    #[serde(default = "default_icon_size")]
    pub icon_size: u16,
    #[serde(default)]
    pub start_path: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_terminal_dock() -> String {
    "bottom".into()
}

fn default_icon_size() -> u16 {
    34
}

impl Default for ViewSettings {
    fn default() -> Self {
        Self {
            show_hidden: false,
            view_mode: "details".into(),
            sort_by: "name".into(),
            sort_desc: false,
            dual_pane: false,
            icon_pack: "categorical".into(),
            theme: "forest".into(),
            confirm_delete: true,
            single_click_open: false,
            terminal_dock: default_terminal_dock(),
            restore_last: true,
            folders_first: true,
            icon_size: default_icon_size(),
            start_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub ai: AiSettings,
    #[serde(default)]
    pub editor: EditorSettings,
    #[serde(default)]
    pub view: ViewSettings,
    #[serde(default)]
    pub bookmarks: Vec<String>,
    #[serde(default)]
    pub terminal_shell: Option<String>,
    /// Last directory shown in each pane, used when restoreLast is on.
    #[serde(default)]
    pub last_paths: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ai: AiSettings::default(),
            editor: EditorSettings::default(),
            view: ViewSettings::default(),
            bookmarks: Vec::new(),
            terminal_shell: None,
            last_paths: Vec::new(),
        }
    }
}

fn config_dir() -> AppResult<PathBuf> {
    let base = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| AppError::Settings("neither XDG_CONFIG_HOME nor HOME is set".into()))?;
    Ok(base.join("tuwuh"))
}

fn config_file() -> AppResult<PathBuf> {
    Ok(config_dir()?.join("settings.json"))
}

#[tauri::command]
pub fn get_settings() -> AppResult<Settings> {
    let path = config_file()?;
    // A missing file is the first run, not a failure.
    let Ok(raw) = fs::read_to_string(&path) else {
        return Ok(Settings::default());
    };
    // A corrupt file must not lock the user out of their own settings screen,
    // so it degrades to defaults rather than erroring.
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> AppResult<()> {
    let dir = config_dir()?;
    fs::create_dir_all(&dir).map_err(|e| AppError::Settings(format!("{}: {e}", dir.display())))?;
    let path = config_file()?;
    let tmp = dir.join("settings.json.tmp");
    let body = serde_json::to_string_pretty(&settings)
        .map_err(|e| AppError::Settings(format!("encode: {e}")))?;
    fs::write(&tmp, body).map_err(|e| AppError::Settings(format!("{}: {e}", tmp.display())))?;
    fs::rename(&tmp, &path).map_err(|e| AppError::Settings(format!("{}: {e}", path.display())))
}

#[tauri::command]
pub fn set_provider_key(provider: Provider, key: String) -> AppResult<()> {
    if key.trim().is_empty() {
        return Err(AppError::Settings("key is empty".into()));
    }
    keyring::Entry::new(KEYRING_SERVICE, provider.as_str())
        .and_then(|e| e.set_password(key.trim()))
        .map_err(|e| AppError::Settings(format!("keyring: {e}")))
}

/// Presence only. There is deliberately no command that returns a key: the
/// webview has no reason to hold one, so it is never given the chance to leak
/// one through a log, a crash report or a devtools session.
#[tauri::command]
pub fn has_provider_key(provider: Provider) -> bool {
    read_provider_key(provider).is_ok()
}

#[tauri::command]
pub fn delete_provider_key(provider: Provider) -> AppResult<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, provider.as_str())
        .map_err(|e| AppError::Settings(format!("keyring: {e}")))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        // Deleting a key that is not there is the state the caller wanted.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Settings(format!("keyring: {e}"))),
    }
}

pub fn read_provider_key(provider: Provider) -> AppResult<String> {
    keyring::Entry::new(KEYRING_SERVICE, provider.as_str())
        .and_then(|e| e.get_password())
        .map_err(|e| AppError::Settings(format!("no stored key for {}: {e}", provider.as_str())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_ollama_runs_without_a_key() {
        assert!(Provider::Anthropic.needs_key());
        assert!(Provider::Openai.needs_key());
        assert!(Provider::Xai.needs_key());
        assert!(Provider::Openrouter.needs_key());
        assert!(Provider::Huggingface.needs_key());
        assert!(!Provider::Ollama.needs_key());
    }

    #[test]
    fn settings_round_trip_through_json() {
        let s = Settings::default();
        let raw = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.ai.provider, Provider::Anthropic);
        assert_eq!(back.editor.tab_size, 2);
        assert!(!back.view.show_hidden);
        assert_eq!(back.view.terminal_dock, "bottom");
        assert_eq!(back.view.theme, "forest");
        assert!(back.view.folders_first);
        assert_eq!(back.view.icon_size, 34);
        assert!(back.ai.base_urls.is_empty());
    }

    #[test]
    fn a_partial_file_fills_the_rest_from_defaults() {
        // Forward compatibility: an older settings file must still load after a
        // new field is added, rather than resetting everything.
        let back: Settings = serde_json::from_str(r#"{"view":{"showHidden":true,"viewMode":"icons","sortBy":"name","sortDesc":false,"dualPane":false,"iconPack":"categorical","theme":"dark","confirmDelete":true,"singleClickOpen":false}}"#).unwrap();
        assert!(back.view.show_hidden);
        assert_eq!(back.editor.tab_size, 2);
        assert_eq!(back.ai.provider, Provider::Anthropic);
        assert_eq!(back.view.terminal_dock, "bottom");
        assert!(back.view.folders_first);
        assert_eq!(back.view.icon_size, 34);
    }

    #[test]
    fn base_urls_round_trip_per_provider() {
        let mut s = Settings::default();
        s.ai.base_urls.insert("ollama".into(), "http://localhost:11434/v1".into());
        s.ai.base_urls.insert("huggingface".into(), "https://router.huggingface.co/v1".into());
        let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(
            back.ai.base_urls.get("ollama").map(String::as_str),
            Some("http://localhost:11434/v1")
        );
        assert_ne!(
            back.ai.base_urls.get("ollama"),
            back.ai.base_urls.get("huggingface")
        );
    }

    #[test]
    fn file_actions_are_off_unless_asked_for() {
        assert!(!AiSettings::default().allow_file_actions);
    }

    #[test]
    fn every_provider_has_its_own_default_model() {
        assert_eq!(Provider::Anthropic.default_model(), "claude-sonnet-5");
        assert_eq!(Provider::Openai.default_model(), "gpt-5");
        assert_eq!(Provider::Xai.default_model(), "grok-4");
        assert_eq!(Provider::Openrouter.default_model(), "anthropic/claude-sonnet-5");
        assert_eq!(
            Provider::Huggingface.default_model(),
            "Qwen/Qwen2.5-7B-Instruct:fastest"
        );
        assert_eq!(Provider::Ollama.default_model(), "llama3.2");
        assert_ne!(Provider::Anthropic.default_model(), Provider::Openai.default_model());
        assert_ne!(Provider::Huggingface.default_model(), Provider::Ollama.default_model());
    }

    #[test]
    fn terminal_dock_round_trips() {
        let mut s = Settings::default();
        s.view.terminal_dock = "top".into();
        let raw = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.view.terminal_dock, "top");
        s.view.terminal_dock = "right".into();
        let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back.view.terminal_dock, "right");
    }
}
