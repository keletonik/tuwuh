//! Real filesystem access.
//!
//! The browser prototype this replaced kept every file in a `Record<string, Node>`
//! and cloned the whole tree on each mutation. That cannot model a disk, so
//! nothing here holds state: each command touches the filesystem and returns.
//! Listing is lazy and per directory; freshness comes from the watcher in
//! `watcher.rs`, not from a cached mirror.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Broad file class, used for icon choice and grouping in the UI.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Folder,
    Code,
    Document,
    Spreadsheet,
    Presentation,
    Pdf,
    Image,
    Video,
    Audio,
    Archive,
    Executable,
    Font,
    Config,
    Database,
    Disk,
    Book,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    /// "dir" | "file". A symlink reports the kind of its target when it
    /// resolves, so a link to a directory is navigable, and "file" when broken.
    pub kind: &'static str,
    pub size: u64,
    /// Seconds since the Unix epoch. 0 when the platform withholds it.
    pub mtime: u64,
    pub mode: u32,
    pub is_hidden: bool,
    pub is_symlink: bool,
    pub symlink_target: Option<String>,
    pub is_readonly: bool,
    pub mime: Option<String>,
    pub category: Category,
    /// Directory child count, filled only by `stat_path`; listing a large tree
    /// must not stat every grandchild.
    pub child_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub text: String,
    pub truncated: bool,
    pub size: u64,
    /// False when the bytes are not valid UTF-8, in which case `text` is empty
    /// and the UI must offer a binary view rather than a corrupted one.
    pub is_utf8: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub label: String,
    pub path: String,
    pub icon: &'static str,
}

/// Cap for `read_text_file` so opening a multi-gigabyte log cannot take the
/// window down. The editor asks for a larger slice explicitly.
pub const DEFAULT_READ_LIMIT: u64 = 8 * 1024 * 1024;

/// Reject empty and relative paths before they reach the filesystem. Every
/// command takes an absolute path; the frontend never sends a relative one, so
/// a relative path here means a bug or a caller we did not write.
fn checked(path: &str) -> AppResult<PathBuf> {
    if path.is_empty() {
        return Err(AppError::InvalidPath("empty path".into()));
    }
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(AppError::InvalidPath(format!("not absolute: {path}")));
    }
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(AppError::InvalidPath(format!("contains '..': {path}")));
    }
    Ok(p)
}

fn category_for(path: &Path, is_dir: bool, mode: u32) -> Category {
    if is_dir {
        return Category::Folder;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "py" | "go" | "c" | "h" | "cpp"
        | "hpp" | "cc" | "java" | "kt" | "swift" | "rb" | "php" | "cs" | "sh" | "bash" | "zsh"
        | "fish" | "lua" | "vim" | "sql" | "html" | "css" | "scss" | "sass" | "less" | "vue"
        | "svelte" | "dart" | "scala" | "clj" | "ex" | "exs" | "erl" | "hs" | "ml" | "nim"
        | "zig" | "pl" | "r" | "jl" | "asm" | "s" => Category::Code,

        "json" | "yaml" | "yml" | "toml" | "ini" | "conf" | "cfg" | "env" | "properties"
        | "xml" | "plist" | "desktop" | "service" | "rules" => Category::Config,

        "md" | "markdown" | "txt" | "rst" | "org" | "adoc" | "tex" | "doc" | "docx" | "odt"
        | "rtf" => Category::Document,

        "xls" | "xlsx" | "ods" | "csv" | "tsv" => Category::Spreadsheet,
        "ppt" | "pptx" | "odp" => Category::Presentation,
        "pdf" => Category::Pdf,
        "epub" | "mobi" | "azw3" | "djvu" => Category::Book,

        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "tiff" | "tif"
        | "avif" | "heic" | "raw" | "cr2" | "nef" | "psd" | "xcf" => Category::Image,

        "mp4" | "mkv" | "webm" | "avi" | "mov" | "wmv" | "flv" | "m4v" | "mpg" | "mpeg"
        | "ogv" => Category::Video,

        "mp3" | "flac" | "wav" | "ogg" | "opus" | "m4a" | "aac" | "wma" | "aiff" | "mid"
        | "midi" => Category::Audio,

        "zip" | "tar" | "gz" | "bz2" | "xz" | "zst" | "7z" | "rar" | "tgz" | "txz" | "tbz"
        | "lz4" | "lzma" | "cab" | "deb" | "rpm" | "pkg" | "apk" | "jar" | "war" => {
            Category::Archive
        }

        "iso" | "img" | "vhd" | "vhdx" | "qcow2" | "vmdk" | "dmg" => Category::Disk,
        "db" | "sqlite" | "sqlite3" | "mdb" | "accdb" | "parquet" => Category::Database,
        "ttf" | "otf" | "woff" | "woff2" | "eot" | "pfb" => Category::Font,
        "so" | "dll" | "dylib" | "o" | "a" | "ko" | "elf" | "bin" | "appimage" => {
            Category::Executable
        }

        _ => {
            // No extension to go on: the executable bit is the next best signal.
            if mode & 0o111 != 0 {
                Category::Executable
            } else {
                Category::Other
            }
        }
    }
}

fn entry_from(path: &Path, follow: bool) -> AppResult<Entry> {
    let link_meta = fs::symlink_metadata(path)
        .map_err(|e| AppError::Io(format!("{}: {e}", path.display())))?;
    let is_symlink = link_meta.file_type().is_symlink();

    // A symlink is described by its target where the target resolves, so the UI
    // can navigate a linked directory. A broken link falls back to the link's
    // own metadata rather than erroring the whole listing.
    let meta = if is_symlink && follow {
        fs::metadata(path).unwrap_or_else(|_| link_meta.clone())
    } else {
        link_meta.clone()
    };

    let symlink_target = if is_symlink {
        fs::read_link(path)
            .ok()
            .map(|t| t.to_string_lossy().into_owned())
    } else {
        None
    };

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    let is_dir = meta.is_dir();
    let mode = meta.permissions().mode();

    Ok(Entry {
        path: path.to_string_lossy().into_owned(),
        is_hidden: name.starts_with('.'),
        name,
        kind: if is_dir { "dir" } else { "file" },
        size: if is_dir { 0 } else { meta.size() },
        mtime: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
        mode,
        is_symlink,
        symlink_target,
        is_readonly: meta.permissions().readonly(),
        mime: if is_dir {
            None
        } else {
            mime_guess::from_path(path)
                .first()
                .map(|m| m.essence_str().to_owned())
        },
        category: category_for(path, is_dir, mode),
        child_count: None,
    })
}

#[tauri::command]
pub fn list_dir(path: String, show_hidden: bool) -> AppResult<Vec<Entry>> {
    let dir = checked(&path)?;
    let read = fs::read_dir(&dir).map_err(|e| AppError::Io(format!("{path}: {e}")))?;

    let mut out = Vec::new();
    for item in read {
        // One unreadable child must not fail the whole listing: a directory
        // with a dangling mount or a permission hole still has to render.
        let Ok(item) = item else { continue };
        let p = item.path();
        let hidden = p
            .file_name()
            .map(|n| n.to_string_lossy().starts_with('.'))
            .unwrap_or(false);
        if hidden && !show_hidden {
            continue;
        }
        if let Ok(e) = entry_from(&p, true) {
            out.push(e);
        }
    }

    // Directories first, then case-insensitive by name. The UI re-sorts for
    // other columns; this is the order a fresh listing arrives in.
    out.sort_by(|a, b| match (a.kind, b.kind) {
        ("dir", "file") => std::cmp::Ordering::Less,
        ("file", "dir") => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[tauri::command]
pub fn stat_path(path: String) -> AppResult<Entry> {
    let p = checked(&path)?;
    let mut e = entry_from(&p, true)?;
    if e.kind == "dir" {
        e.child_count = fs::read_dir(&p).ok().map(|r| r.flatten().count());
    }
    Ok(e)
}

#[tauri::command]
pub fn read_text_file(path: String, max_bytes: Option<u64>) -> AppResult<TextFile> {
    let p = checked(&path)?;
    let meta = fs::metadata(&p).map_err(|e| AppError::Io(format!("{path}: {e}")))?;
    if meta.is_dir() {
        return Err(AppError::InvalidPath(format!("{path} is a directory")));
    }

    let limit = max_bytes.unwrap_or(DEFAULT_READ_LIMIT);
    let size = meta.size();
    let mut file = fs::File::open(&p).map_err(|e| AppError::Io(format!("{path}: {e}")))?;
    let mut buf = Vec::with_capacity(size.min(limit) as usize);
    file.by_ref()
        .take(limit)
        .read_to_end(&mut buf)
        .map_err(|e| AppError::Io(format!("{path}: {e}")))?;

    match String::from_utf8(buf) {
        Ok(text) => Ok(TextFile {
            text,
            truncated: size > limit,
            size,
            is_utf8: true,
        }),
        // Binary, or a truncated multi-byte sequence at the cut point. Either
        // way the editor must not be handed lossy text and told it is the file.
        Err(_) => Ok(TextFile {
            text: String::new(),
            truncated: size > limit,
            size,
            is_utf8: false,
        }),
    }
}

/// Write via a sibling temp file and rename, so an interrupted save leaves the
/// previous file intact instead of a half-written one.
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> AppResult<()> {
    let p = checked(&path)?;
    let parent = p
        .parent()
        .ok_or_else(|| AppError::InvalidPath(format!("{path} has no parent")))?;

    let mode = fs::metadata(&p).ok().map(|m| m.permissions().mode());

    let tmp = parent.join(format!(
        ".{}.tuwuh-tmp",
        p.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "unnamed".into())
    ));

    fs::write(&tmp, content.as_bytes()).map_err(|e| AppError::Io(format!("{path}: {e}")))?;
    // Carry the original permission bits across; a rename would otherwise reset
    // an executable script to the default mask.
    if let Some(m) = mode {
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(m));
    }
    fs::rename(&tmp, &p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        AppError::Io(format!("{path}: {e}"))
    })
}

#[tauri::command]
pub fn create_dir(path: String) -> AppResult<()> {
    let p = checked(&path)?;
    if p.exists() {
        return Err(AppError::Exists(path));
    }
    fs::create_dir_all(&p).map_err(|e| AppError::Io(format!("{path}: {e}")))
}

#[tauri::command]
pub fn create_file(path: String) -> AppResult<()> {
    let p = checked(&path)?;
    if p.exists() {
        return Err(AppError::Exists(path));
    }
    fs::write(&p, b"").map_err(|e| AppError::Io(format!("{path}: {e}")))
}

#[tauri::command]
pub fn rename_path(from: String, to: String) -> AppResult<()> {
    let a = checked(&from)?;
    let b = checked(&to)?;
    if b.exists() {
        return Err(AppError::Exists(to));
    }
    fs::rename(&a, &b).map_err(|e| AppError::Io(format!("{from} -> {to}: {e}")))
}

fn copy_tree(from: &Path, to: &Path) -> AppResult<()> {
    let meta = fs::symlink_metadata(from)
        .map_err(|e| AppError::Io(format!("{}: {e}", from.display())))?;

    if meta.file_type().is_symlink() {
        let target =
            fs::read_link(from).map_err(|e| AppError::Io(format!("{}: {e}", from.display())))?;
        // Recreate the link rather than dereferencing it, so copying a tree of
        // links does not silently multiply the data they point at.
        std::os::unix::fs::symlink(target, to)
            .map_err(|e| AppError::Io(format!("{}: {e}", to.display())))?;
        return Ok(());
    }

    if meta.is_dir() {
        fs::create_dir_all(to).map_err(|e| AppError::Io(format!("{}: {e}", to.display())))?;
        for item in
            fs::read_dir(from).map_err(|e| AppError::Io(format!("{}: {e}", from.display())))?
        {
            let item = item.map_err(|e| AppError::Io(format!("{}: {e}", from.display())))?;
            copy_tree(&item.path(), &to.join(item.file_name()))?;
        }
        let _ = fs::set_permissions(to, meta.permissions());
        return Ok(());
    }

    fs::copy(from, to).map_err(|e| AppError::Io(format!("{}: {e}", from.display())))?;
    Ok(())
}

/// Pick `name (2).ext`, `name (3).ext` and so on when the destination is taken,
/// matching what a file manager is expected to do on a same-directory copy.
fn unique_destination(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_owned());
    let ext = path.extension().map(|e| e.to_string_lossy().into_owned());

    for n in 2..10_000 {
        let next = match &ext {
            Some(e) => dir.join(format!("{stem} ({n}).{e}")),
            None => dir.join(format!("{stem} ({n})")),
        };
        if !next.exists() {
            return next;
        }
    }
    dir.join(format!("{stem}.{}", std::process::id()))
}

#[tauri::command]
pub fn copy_path(from: String, to_dir: String) -> AppResult<String> {
    let a = checked(&from)?;
    let d = checked(&to_dir)?;
    let name = a
        .file_name()
        .ok_or_else(|| AppError::InvalidPath(from.clone()))?
        .to_string_lossy()
        .into_owned();

    // Copying a directory into itself or into its own subtree would recurse
    // until the disk fills.
    if d.starts_with(&a) {
        return Err(AppError::InvalidPath(format!(
            "cannot copy {from} into itself"
        )));
    }

    let dest = unique_destination(&d, &name);
    copy_tree(&a, &dest)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn move_path(from: String, to_dir: String) -> AppResult<String> {
    let a = checked(&from)?;
    let d = checked(&to_dir)?;
    let name = a
        .file_name()
        .ok_or_else(|| AppError::InvalidPath(from.clone()))?
        .to_string_lossy()
        .into_owned();

    if d.starts_with(&a) {
        return Err(AppError::InvalidPath(format!(
            "cannot move {from} into itself"
        )));
    }

    let dest = unique_destination(&d, &name);
    match fs::rename(&a, &dest) {
        Ok(()) => Ok(dest.to_string_lossy().into_owned()),
        // EXDEV: a rename cannot cross a filesystem boundary, so fall back to
        // copy-then-delete, and keep the source if the copy fails.
        Err(e) if e.raw_os_error() == Some(18) => {
            copy_tree(&a, &dest)?;
            remove_tree(&a)?;
            Ok(dest.to_string_lossy().into_owned())
        }
        Err(e) => Err(AppError::Io(format!("{from} -> {to_dir}: {e}"))),
    }
}

fn remove_tree(p: &Path) -> AppResult<()> {
    let meta =
        fs::symlink_metadata(p).map_err(|e| AppError::Io(format!("{}: {e}", p.display())))?;
    if meta.is_dir() && !meta.file_type().is_symlink() {
        fs::remove_dir_all(p).map_err(|e| AppError::Io(format!("{}: {e}", p.display())))
    } else {
        fs::remove_file(p).map_err(|e| AppError::Io(format!("{}: {e}", p.display())))
    }
}

/// Move to the XDG trash. This is the default destructive action; permanent
/// deletion is a separate command the UI has to ask for explicitly.
#[tauri::command]
pub fn trash_path(paths: Vec<String>) -> AppResult<()> {
    for path in &paths {
        checked(path)?;
    }
    trash::delete_all(&paths).map_err(|e| AppError::Io(format!("trash: {e}")))
}

#[tauri::command]
pub fn delete_permanent(paths: Vec<String>) -> AppResult<()> {
    for path in &paths {
        let p = checked(path)?;
        // Refusing the filesystem root is not paranoia about permissions, it is
        // that no interaction in a file manager should ever mean "erase /".
        if p.parent().is_none() {
            return Err(AppError::InvalidPath("refusing to delete /".into()));
        }
        remove_tree(&p)?;
    }
    Ok(())
}

#[tauri::command]
pub fn home_dir() -> AppResult<String> {
    std::env::var("HOME")
        .map_err(|_| AppError::Io("HOME is not set".into()))
        .map(|h| h.trim_end_matches('/').to_owned())
}

/// Sidebar shortcuts: the XDG user directories that actually exist, plus the
/// root. Missing ones are omitted rather than shown as dead links.
#[tauri::command]
pub fn places() -> AppResult<Vec<Place>> {
    let home = home_dir()?;
    let mut out = vec![Place {
        label: "Home".into(),
        path: home.clone(),
        icon: "home",
    }];

    for (label, sub, icon) in [
        ("Desktop", "Desktop", "monitor"),
        ("Documents", "Documents", "file-text"),
        ("Downloads", "Downloads", "download"),
        ("Music", "Music", "music"),
        ("Pictures", "Pictures", "image"),
        ("Videos", "Videos", "video"),
    ] {
        let p = format!("{home}/{sub}");
        if Path::new(&p).is_dir() {
            out.push(Place {
                label: label.into(),
                path: p,
                icon,
            });
        }
    }

    out.push(Place {
        label: "Root".into(),
        path: "/".into(),
        icon: "hard-drive",
    });
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub entry: Entry,
    pub parent: String,
}

/// Breadth-first name search, bounded on both results and depth so a search
/// started at `/` returns instead of walking the whole disk.
#[tauri::command]
pub fn search_files(
    root: String,
    query: String,
    max_results: Option<usize>,
    max_depth: Option<usize>,
) -> AppResult<Vec<SearchHit>> {
    let start = checked(&root)?;
    let needle = query.to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let cap = max_results.unwrap_or(500);
    let depth_cap = max_depth.unwrap_or(8);

    let mut out = Vec::new();
    let mut queue: std::collections::VecDeque<(PathBuf, usize)> =
        std::collections::VecDeque::from([(start, 0usize)]);

    while let Some((dir, depth)) = queue.pop_front() {
        if out.len() >= cap || depth > depth_cap {
            continue;
        }
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for item in read.flatten() {
            let p = item.path();
            let name = item.file_name().to_string_lossy().into_owned();

            if name.to_lowercase().contains(&needle) {
                if let Ok(e) = entry_from(&p, true) {
                    out.push(SearchHit {
                        entry: e,
                        parent: dir.to_string_lossy().into_owned(),
                    });
                    if out.len() >= cap {
                        return Ok(out);
                    }
                }
            }

            // Skip the trees that dominate a home directory and are almost
            // never the thing being searched for.
            if item.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && !matches!(name.as_str(), "node_modules" | ".git" | "target" | ".cache")
            {
                queue.push_back((p, depth + 1));
            }
        }
    }
    Ok(out)
}

/// Preview cap. Larger than this and the UI offers to open the file in the
/// desktop's default application rather than inlining it.
pub const PREVIEW_LIMIT: u64 = 24 * 1024 * 1024;

/// Read a file as a `data:` URL for inline preview.
///
/// Tauri's asset protocol would do this too, but only with a scope broad enough
/// to cover the whole filesystem, which is most of what a file manager can
/// reach. A command keeps previews behind an explicit, size-capped call.
#[tauri::command]
pub fn read_preview(path: String) -> AppResult<String> {
    use base64::Engine as _;

    let p = checked(&path)?;
    let meta = fs::metadata(&p).map_err(|e| AppError::Io(format!("{path}: {e}")))?;
    if meta.is_dir() {
        return Err(AppError::InvalidPath(format!("{path} is a directory")));
    }
    if meta.size() > PREVIEW_LIMIT {
        return Err(AppError::InvalidPath(format!(
            "{path} is {} bytes, over the {PREVIEW_LIMIT} byte preview limit",
            meta.size()
        )));
    }

    let bytes = fs::read(&p).map_err(|e| AppError::Io(format!("{path}: {e}")))?;
    let mime = mime_guess::from_path(&p)
        .first()
        .map(|m| m.essence_str().to_owned())
        .unwrap_or_else(|| "application/octet-stream".into());
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// Recursive size of a directory. Separate from `stat_path` because it can take
/// seconds on a large tree and the UI asks for it only on demand.
#[tauri::command]
pub fn dir_size(path: String) -> AppResult<u64> {
    let p = checked(&path)?;
    fn walk(p: &Path) -> u64 {
        let Ok(meta) = fs::symlink_metadata(p) else {
            return 0;
        };
        if meta.file_type().is_symlink() {
            return 0;
        }
        if meta.is_file() {
            return meta.size();
        }
        let Ok(read) = fs::read_dir(p) else { return 0 };
        read.flatten().map(|e| walk(&e.path())).sum()
    }
    Ok(walk(&p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_and_traversing_paths() {
        assert!(checked("").is_err());
        assert!(checked("relative/path").is_err());
        assert!(checked("/etc/../etc/passwd").is_err());
        assert!(checked("/tmp").is_ok());
    }

    #[test]
    fn categorises_by_extension_then_by_exec_bit() {
        assert_eq!(category_for(Path::new("/a/b.rs"), false, 0o644), Category::Code);
        assert_eq!(category_for(Path::new("/a/b.png"), false, 0o644), Category::Image);
        assert_eq!(category_for(Path::new("/a/b"), true, 0o755), Category::Folder);
        // No extension: the executable bit decides.
        assert_eq!(category_for(Path::new("/a/run"), false, 0o755), Category::Executable);
        assert_eq!(category_for(Path::new("/a/notes"), false, 0o644), Category::Other);
    }

    #[test]
    fn unique_destination_sidesteps_collisions() {
        let dir = std::env::temp_dir().join(format!("tuwuh-uniq-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let first = unique_destination(&dir, "note.txt");
        assert!(first.ends_with("note.txt"));
        fs::write(&first, b"x").unwrap();
        let second = unique_destination(&dir, "note.txt");
        assert!(second.ends_with("note (2).txt"), "got {second:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_is_atomic_and_keeps_the_mode() {
        let dir = std::env::temp_dir().join(format!("tuwuh-write-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("script.sh");
        fs::write(&f, b"old").unwrap();
        fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();

        write_text_file(f.to_string_lossy().into_owned(), "new".into()).unwrap();

        assert_eq!(fs::read_to_string(&f).unwrap(), "new");
        assert_eq!(fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o755);
        // The temp file must not survive a successful write.
        assert!(!dir.join(".script.sh.tuwuh-tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_to_copy_a_directory_into_itself() {
        let dir = std::env::temp_dir().join(format!("tuwuh-self-{}", std::process::id()));
        let inner = dir.join("inner");
        fs::create_dir_all(&inner).unwrap();
        let r = copy_path(
            dir.to_string_lossy().into_owned(),
            inner.to_string_lossy().into_owned(),
        );
        assert!(r.is_err(), "copying a tree into its own subtree must fail");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn non_utf8_reads_as_binary_not_as_mangled_text() {
        let dir = std::env::temp_dir().join(format!("tuwuh-bin-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("blob");
        fs::write(&f, [0xff, 0xfe, 0x00, 0x01]).unwrap();
        let r = read_text_file(f.to_string_lossy().into_owned(), None).unwrap();
        assert!(!r.is_utf8);
        assert!(r.text.is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }
}
