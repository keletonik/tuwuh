# Tuwuh

A desktop file manager for Linux with a real code editor and a real terminal
built in. Native binary, not a browser tab: it reads and writes the actual
filesystem through a Rust backend.

## What it does

**File management.** Places sidebar from the XDG user directories, bookmarks,
trash, devices, breadcrumbs with an editable location bar (Ctrl L), back and
forward history, folder tabs, four view modes (details, icons, compact, tree
with in-place expand), sorting by name, size, modified time or category,
hidden-file toggle, dual pane (F3), search, filter (Ctrl I), type-ahead,
drag and drop, and a context menu with copy, cut, paste, rename, duplicate,
symlink, compress, extract, copy location, copy/move to the other pane, trash
and permanent delete. Deletions go to the XDG trash by default. Properties
(Alt Enter) can change Unix permission bits. Ctrl Z undoes the last trash,
rename or create.

**Categorised icons.** Every file is classified in the backend by extension, and
by the executable bit when there is no extension, into one of seventeen
categories. Each category has its own glyph and its own colour, so the grid
reads without relying on hue alone. Symbolic links carry a badge, because acting
on a link when you meant its target is a mistake worth preventing.

**Code editor.** Monaco, the editor that powers VS Code, embedded as a
collapsible pane that opens when you open a text file. Syntax highlighting,
inline suggestions, auto-indent, bracket matching and colourisation, the command
palette, and per-file tabs with an unsaved indicator. Saving writes to a
temporary file and renames it, so an interrupted save cannot leave a truncated
file behind, and the original permission bits are preserved.

**Terminal.** A real pseudo-terminal running your login shell, in a collapsible
pane, opening in whichever folder the pane is showing. Dock it at the bottom,
the right or the top, and open several tabs. xterm.js is only the renderer;
job control, curses programs and shell completion all work because there is a
real shell on the other end.

**AI providers.** Settings for Anthropic, OpenAI, xAI, OpenRouter, Hugging Face
(Inference Providers router) and a local Ollama or other OpenAI-compatible
server. Each vendor has its own default model and remembers the last id you
picked. Keys are stored in the OS keyring and never in the settings file or the
webview: requests are made from the Rust side, and there is deliberately no
command that reads a key back. The assistant panel sees the listing of the
current folder and can propose file operations, which appear as buttons you
press. It never performs one on its own, and that confirmation cannot be turned
off.

**Menus.** Press Alt for File, View, Go and Terminal. Dock the terminal top,
right or bottom, and open several tabs.

## What it does not do yet

- Archive browsing as a filesystem, or remote protocols (no KIO equivalent).
- Thumbnails for video or PDF. Images preview in the info panel; everything else
  shows metadata only.
- Baloo tags, ratings, Git status, or KDE service menus.
- Any visual design pass. The layout is functional and the palette is carried
  over, but the interface has not been designed, only built.

## Requirements

Arch or another Linux with `webkit2gtk-4.1`, `gtk3`, `libappindicator-gtk3` and
`librsvg`. Building needs Rust, Node and npm.

## Build

```sh
npm install
npm run dist          # release bundle in src-tauri/target/release
```

For development, `npm run app` starts Vite and the desktop window together.

Checks:

```sh
npm run typecheck                 # frontend
cd src-tauri && cargo test --lib  # backend
```

## Layout

```
src/            React frontend
  lib/api.ts    the only boundary between the UI and the backend
  lib/store.ts  pane state, a cache over the filesystem and never the truth
src-tauri/src/
  fs_ops.rs     filesystem commands
  pty.rs        pseudo-terminals
  settings.rs   preferences, and keyring-backed provider keys
  ai.rs         provider calls, made server-side so keys stay out of the webview
  watcher.rs    inotify watches for the directories currently on screen
```

## Licence

MIT. See `LICENSE`.
