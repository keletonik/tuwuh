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
use std::process::Command;

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
    let lower = name.to_ascii_lowercase();
    let (stem, ext) = {
        const COMPOUND: &[&str] = &["tar.gz", "tar.xz", "tar.bz2", "tar.zst", "tgz"];
        if let Some(rest) = COMPOUND.iter().copied().find(|e| lower.ends_with(&format!(".{e}"))) {
            let cut = name.len() - rest.len() - 1;
            (name[..cut].to_owned(), Some(rest.to_owned()))
        } else {
            let path = Path::new(name);
            (
                path.file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| name.to_owned()),
                path.extension().map(|e| e.to_string_lossy().into_owned()),
            )
        }
    };

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

/// Open a path with the desktop's default handler (`xdg-open`). Directories,
/// binaries and office documents all go this way; the editor is a separate,
/// explicit choice in the UI.
#[tauri::command]
pub fn open_path(path: String) -> AppResult<()> {
    let p = checked(&path)?;
    if !p.exists() {
        return Err(AppError::NotFound(path));
    }
    Command::new("xdg-open")
        .arg(&p)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| AppError::Io(format!("xdg-open {path}: {e}")))?;
    Ok(())
}

/// Duplicate into the same directory. Relies on `unique_destination` so a
/// second copy becomes `name (2).ext` rather than overwriting.
#[tauri::command]
pub fn duplicate_path(path: String) -> AppResult<String> {
    let p = checked(&path)?;
    let parent = p
        .parent()
        .ok_or_else(|| AppError::InvalidPath(format!("{path} has no parent")))?;
    copy_path(path, parent.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn create_symlink(target: String, link: String) -> AppResult<()> {
    let t = checked(&target)?;
    let l = checked(&link)?;
    if l.exists() {
        return Err(AppError::Exists(link));
    }
    std::os::unix::fs::symlink(&t, &l)
        .map_err(|e| AppError::Io(format!("symlink {link} -> {target}: {e}")))
}

/// Set Unix permission bits. The UI sends the nine `rwx` bits (and optionally
/// setuid/setgid/sticky); file-type bits are left to the kernel.
#[tauri::command]
pub fn chmod_path(path: String, mode: u32) -> AppResult<()> {
    let p = checked(&path)?;
    let mode = mode & 0o7777;
    fs::set_permissions(&p, fs::Permissions::from_mode(mode))
        .map_err(|e| AppError::Io(format!("chmod {path}: {e}")))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeSpace {
    pub path: String,
    pub total: u64,
    pub available: u64,
}

#[tauri::command]
pub fn free_space(path: String) -> AppResult<FreeSpace> {
    let p = checked(&path)?;
    let cstr = std::ffi::CString::new(p.to_string_lossy().as_bytes())
        .map_err(|_| AppError::InvalidPath(path.clone()))?;
    let mut buf = std::mem::MaybeUninit::<libc::statvfs>::zeroed();
    let rc = unsafe { libc::statvfs(cstr.as_ptr(), buf.as_mut_ptr()) };
    if rc != 0 {
        return Err(AppError::Io(format!(
            "statvfs {path}: {}",
            std::io::Error::last_os_error()
        )));
    }
    let s = unsafe { buf.assume_init() };
    let frsize = s.f_frsize as u64;
    Ok(FreeSpace {
        path,
        total: s.f_blocks as u64 * frsize,
        available: s.f_bavail as u64 * frsize,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mount {
    pub path: String,
    pub label: String,
    pub fs: String,
}

/// Removable and extra filesystems. `/` and `$HOME` already live in Places, so
/// this list is the things Dolphin would put under Devices.
#[tauri::command]
pub fn list_mounts() -> AppResult<Vec<Mount>> {
    let text = fs::read_to_string("/proc/mounts").unwrap_or_default();
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let _src = parts.next();
        let dest = match parts.next() {
            Some(d) => d.replace("\\040", " "),
            None => continue,
        };
        let fs = parts.next().unwrap_or("");
        if !dest.starts_with("/run/media/")
            && !dest.starts_with("/media/")
            && !dest.starts_with("/mnt/")
        {
            continue;
        }
        if !seen.insert(dest.clone()) {
            continue;
        }
        let label = dest.rsplit('/').next().unwrap_or(&dest).to_owned();
        out.push(Mount {
            path: dest,
            label,
            fs: fs.to_owned(),
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItemDto {
    pub id: String,
    pub name: String,
    pub original: String,
    pub deleted_at: i64,
}

#[tauri::command]
pub fn list_trash() -> AppResult<Vec<TrashItemDto>> {
    let items = trash::os_limited::list().map_err(|e| AppError::Io(format!("trash list: {e}")))?;
    let mut out: Vec<_> = items
        .into_iter()
        .map(|i| TrashItemDto {
            id: i.id.to_string_lossy().into_owned(),
            name: i.name.to_string_lossy().into_owned(),
            original: i.original_path().to_string_lossy().into_owned(),
            deleted_at: i.time_deleted,
        })
        .collect();
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(out)
}

#[tauri::command]
pub fn restore_trash(ids: Vec<String>) -> AppResult<()> {
    let items = trash::os_limited::list().map_err(|e| AppError::Io(format!("trash list: {e}")))?;
    let pick: Vec<_> = items
        .into_iter()
        .filter(|i| ids.iter().any(|id| i.id.to_string_lossy() == *id))
        .collect();
    if pick.is_empty() {
        return Err(AppError::NotFound("no matching trash items".into()));
    }
    trash::os_limited::restore_all(pick).map_err(|e| AppError::Io(format!("restore: {e}")))
}

#[tauri::command]
pub fn empty_trash() -> AppResult<()> {
    let items = trash::os_limited::list().map_err(|e| AppError::Io(format!("trash list: {e}")))?;
    trash::os_limited::purge_all(items).map_err(|e| AppError::Io(format!("empty trash: {e}")))
}

#[tauri::command]
pub fn purge_trash(ids: Vec<String>) -> AppResult<()> {
    let items = trash::os_limited::list().map_err(|e| AppError::Io(format!("trash list: {e}")))?;
    let pick: Vec<_> = items
        .into_iter()
        .filter(|i| ids.iter().any(|id| i.id.to_string_lossy() == *id))
        .collect();
    if pick.is_empty() {
        return Err(AppError::NotFound("no matching trash items".into()));
    }
    trash::os_limited::purge_all(pick).map_err(|e| AppError::Io(format!("purge trash: {e}")))
}

fn run_checked(mut cmd: Command, label: &str) -> AppResult<()> {
    let status = cmd
        .status()
        .map_err(|e| AppError::Io(format!("{label}: {e}")))?;
    if !status.success() {
        return Err(AppError::Io(format!(
            "{label} exited {}",
            status.code().unwrap_or(-1)
        )));
    }
    Ok(())
}

/// Compress the given paths into `dest`. Items must share a parent, matching
/// the usual "compress this selection" action. `.tar.gz` is the default; `.zip`
/// and `.tar` are accepted when the destination name asks for them.
#[tauri::command]
pub fn compress_paths(paths: Vec<String>, dest: String) -> AppResult<String> {
    if paths.is_empty() {
        return Err(AppError::InvalidPath("nothing to compress".into()));
    }
    let dest_p = checked(&dest)?;
    let dest_parent = dest_p
        .parent()
        .ok_or_else(|| AppError::InvalidPath(dest.clone()))?;
    let dest_name = dest_p
        .file_name()
        .ok_or_else(|| AppError::InvalidPath(dest.clone()))?
        .to_string_lossy()
        .into_owned();
    let final_dest = unique_destination(dest_parent, &dest_name);

    let mut names = Vec::new();
    let mut common_parent: Option<PathBuf> = None;
    for p in &paths {
        let pb = checked(p)?;
        let par = pb
            .parent()
            .ok_or_else(|| AppError::InvalidPath(p.clone()))?
            .to_path_buf();
        match &common_parent {
            None => common_parent = Some(par),
            Some(c) if c == &par => {}
            Some(_) => {
                return Err(AppError::InvalidPath(
                    "compress items from one folder at a time".into(),
                ));
            }
        }
        names.push(
            pb.file_name()
                .ok_or_else(|| AppError::InvalidPath(p.clone()))?
                .to_string_lossy()
                .into_owned(),
        );
    }
    let cwd = common_parent.unwrap();
    let dest_s = final_dest.to_string_lossy().into_owned();
    let lower = dest_s.to_ascii_lowercase();

    if lower.ends_with(".zip") {
        run_checked(
            {
                let mut c = Command::new("zip");
                c.current_dir(&cwd)
                    .arg("-r")
                    .arg("-q")
                    .arg(&final_dest)
                    .args(&names);
                c
            },
            "zip",
        )?;
    } else if lower.ends_with(".tar") {
        run_checked(
            {
                let mut c = Command::new("tar");
                c.current_dir(&cwd)
                    .arg("-cf")
                    .arg(&final_dest)
                    .args(&names);
                c
            },
            "tar",
        )?;
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        run_checked(
            {
                let mut c = Command::new("tar");
                c.current_dir(&cwd)
                    .arg("-czf")
                    .arg(&final_dest)
                    .args(&names);
                c
            },
            "tar",
        )?;
    } else {
        return Err(AppError::InvalidPath(
            "compress to .tar.gz, .tgz, .tar or .zip".into(),
        ));
    }
    Ok(dest_s)
}

#[tauri::command]
pub fn extract_archive(path: String, dest_dir: String) -> AppResult<()> {
    let src = checked(&path)?;
    let dest = checked(&dest_dir)?;
    if !src.is_file() {
        return Err(AppError::InvalidPath(format!("{path} is not a file")));
    }
    fs::create_dir_all(&dest).map_err(|e| AppError::Io(format!("{}: {e}", dest.display())))?;
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if name.ends_with(".zip") {
        run_checked(
            {
                let mut c = Command::new("unzip");
                c.arg("-q").arg("-o").arg(&src).arg("-d").arg(&dest);
                c
            },
            "unzip",
        )
    } else if name.ends_with(".tar.gz")
        || name.ends_with(".tgz")
        || name.ends_with(".tar")
        || name.ends_with(".tar.xz")
        || name.ends_with(".tar.bz2")
        || name.ends_with(".tar.zst")
    {
        run_checked(
            {
                let mut c = Command::new("tar");
                c.arg("-xf").arg(&src).arg("-C").arg(&dest);
                c
            },
            "tar",
        )
    } else {
        Err(AppError::InvalidPath(format!(
            "{path} is not a .zip, .tar, .tar.gz, .tgz, .tar.xz, .tar.bz2 or .tar.zst archive"
        )))
    }
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
        let gz = unique_destination(&dir, "pack.tar.gz");
        assert!(gz.ends_with("pack.tar.gz"));
        fs::write(&gz, b"x").unwrap();
        let gz2 = unique_destination(&dir, "pack.tar.gz");
        assert!(
            gz2.ends_with("pack (2).tar.gz"),
            "compound extension must stay intact, got {gz2:?}"
        );
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

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tuwuh-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_path_rejects_relative_and_missing() {
        assert!(open_path("relative".into()).is_err());
        assert!(open_path("/no/such/tuwuh/path/for/open".into()).is_err());
    }

    #[test]
    fn duplicate_leaves_the_original_and_sidesteps_the_name() {
        let dir = scratch("dup");
        let f = dir.join("note.txt");
        fs::write(&f, b"hello").unwrap();
        let copy = duplicate_path(f.to_string_lossy().into_owned()).unwrap();
        assert!(copy.ends_with("note (2).txt"), "got {copy}");
        assert_eq!(fs::read_to_string(&f).unwrap(), "hello");
        assert_eq!(fs::read_to_string(&copy).unwrap(), "hello");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn symlink_points_at_the_target_and_refuses_a_collision() {
        let dir = scratch("link");
        let target = dir.join("real.txt");
        let link = dir.join("alias.txt");
        fs::write(&target, b"x").unwrap();
        create_symlink(
            target.to_string_lossy().into_owned(),
            link.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert!(link.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(fs::read_link(&link).unwrap(), target);
        let again = create_symlink(
            target.to_string_lossy().into_owned(),
            link.to_string_lossy().into_owned(),
        );
        assert!(again.is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn chmod_sets_the_nine_bits() {
        let dir = scratch("chmod");
        let f = dir.join("a.txt");
        fs::write(&f, b"x").unwrap();
        chmod_path(f.to_string_lossy().into_owned(), 0o640).unwrap();
        assert_eq!(fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o640);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn free_space_reports_a_live_filesystem() {
        let info = free_space("/tmp".into()).unwrap();
        assert!(info.total > 0, "total was 0");
        assert!(info.available <= info.total);
    }

    #[test]
    fn compress_and_extract_round_trip_tar_gz() {
        let dir = scratch("arch");
        let a = dir.join("a.txt");
        let b = dir.join("b.txt");
        fs::write(&a, b"alpha").unwrap();
        fs::write(&b, b"beta").unwrap();
        let dest = dir.join("pack.tar.gz");
        let made = compress_paths(
            vec![
                a.to_string_lossy().into_owned(),
                b.to_string_lossy().into_owned(),
            ],
            dest.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert!(Path::new(&made).is_file());
        let out = dir.join("out");
        extract_archive(made, out.to_string_lossy().into_owned()).unwrap();
        assert_eq!(fs::read_to_string(out.join("a.txt")).unwrap(), "alpha");
        assert_eq!(fs::read_to_string(out.join("b.txt")).unwrap(), "beta");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extract_rejects_an_unknown_format() {
        let dir = scratch("badarch");
        let f = dir.join("notes.txt");
        fs::write(&f, b"not an archive").unwrap();
        let r = extract_archive(
            f.to_string_lossy().into_owned(),
            dir.to_string_lossy().into_owned(),
        );
        assert!(r.is_err(), "a text file must not be handed to tar");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn compress_refuses_an_empty_selection_and_a_mixed_parent() {
        assert!(compress_paths(vec![], "/tmp/x.tar.gz".into()).is_err());
        let a = scratch("mix-a");
        let b = scratch("mix-b");
        fs::write(a.join("f"), b"x").unwrap();
        fs::write(b.join("g"), b"y").unwrap();
        let r = compress_paths(
            vec![
                a.join("f").to_string_lossy().into_owned(),
                b.join("g").to_string_lossy().into_owned(),
            ],
            a.join("x.tar.gz").to_string_lossy().into_owned(),
        );
        assert!(r.is_err());
        fs::remove_dir_all(&a).unwrap();
        fs::remove_dir_all(&b).unwrap();
    }

    #[test]
    fn trash_round_trip_restore() {
        let dir = scratch("trash");
        let f = dir.join("gone.txt");
        fs::write(&f, b"restore-me").unwrap();
        let path = f.to_string_lossy().into_owned();
        trash_path(vec![path.clone()]).unwrap();
        assert!(!f.exists());
        let listed = list_trash().unwrap();
        let hit = listed
            .iter()
            .find(|i| i.original == path)
            .expect("trashed file must appear in the list");
        restore_trash(vec![hit.id.clone()]).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "restore-me");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_mounts_is_well_formed() {
        let mounts = list_mounts().unwrap();
        for m in mounts {
            assert!(
                m.path.starts_with("/run/media/")
                    || m.path.starts_with("/media/")
                    || m.path.starts_with("/mnt/"),
                "unexpected mount {}",
                m.path
            );
            assert!(!m.label.is_empty());
        }
    }
}
