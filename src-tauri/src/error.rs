//! One error type across every command.
//!
//! Tauri needs a command's error to be `Serialize`, and the UI needs to tell a
//! missing file from a permission problem so it can offer the right recovery.
//! A stringly-typed error would collapse that distinction, so the kind is
//! carried as a tag and the detail as a message.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Io(String),

    #[error("invalid path: {0}")]
    InvalidPath(String),

    #[error("already exists: {0}")]
    Exists(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("permission denied: {0}")]
    Denied(String),

    #[error("{0}")]
    Terminal(String),

    #[error("{0}")]
    Settings(String),

    #[error("{0}")]
    Provider(String),
}

pub type AppResult<T> = Result<T, AppError>;

#[derive(Serialize)]
struct Wire {
    kind: &'static str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let message = self.to_string();

        // An OS error arrives as a formatted string, so the kind is recovered
        // from the text. Without this every failure would reach the UI as a
        // generic "io", and a read-only file would look the same as a deleted
        // one.
        let kind = match self {
            AppError::Io(m) => {
                let lower = m.to_lowercase();
                if lower.contains("permission denied") {
                    "denied"
                } else if lower.contains("no such file") || lower.contains("not found") {
                    "notFound"
                } else if lower.contains("directory not empty") {
                    "notEmpty"
                } else {
                    "io"
                }
            }
            AppError::InvalidPath(_) => "invalidPath",
            AppError::Exists(_) => "exists",
            AppError::NotFound(_) => "notFound",
            AppError::Denied(_) => "denied",
            AppError::Terminal(_) => "terminal",
            AppError::Settings(_) => "settings",
            AppError::Provider(_) => "provider",
        };

        Wire { kind, message }.serialize(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind_of(e: AppError) -> String {
        let v = serde_json::to_value(e).unwrap();
        v["kind"].as_str().unwrap().to_owned()
    }

    #[test]
    fn os_errors_keep_their_distinction() {
        assert_eq!(kind_of(AppError::Io("/x: Permission denied (os error 13)".into())), "denied");
        assert_eq!(kind_of(AppError::Io("/x: No such file or directory".into())), "notFound");
        assert_eq!(kind_of(AppError::Io("/x: something else".into())), "io");
    }

    #[test]
    fn tagged_variants_serialise_by_variant() {
        assert_eq!(kind_of(AppError::Exists("/x".into())), "exists");
        assert_eq!(kind_of(AppError::InvalidPath("/x".into())), "invalidPath");
        assert_eq!(kind_of(AppError::Provider("429".into())), "provider");
    }

    #[test]
    fn the_message_survives_serialisation() {
        let v = serde_json::to_value(AppError::Exists("/tmp/a".into())).unwrap();
        assert_eq!(v["message"].as_str().unwrap(), "already exists: /tmp/a");
    }
}
