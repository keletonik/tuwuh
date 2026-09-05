# Lessons

## 2026-09-06: settings fields must exist on both sides of the IPC boundary

A frontend-only `terminalDock` field on `ViewSettings` looked like the feature
existed. `save_settings` deserialises into the Rust struct and writes that
back, so unknown JSON keys were dropped and the choice never survived a
restart. The settings screen then looked broken.

Every persisted preference needs the field in `src/lib/api.ts` and
`src-tauri/src/settings.rs`, a `serde` default so older files still load, and
a round-trip test. A TypeScript type is not persistence.

## 2026-09-06: write desktop files as raw bytes

`~/.local/share/applications/tuwuh.desktop` was installed through a colourising
pager, so every line started with an ESC sequence. `desktop-file-validate`
rejected the file and the launcher never registered. Copy from
`packaging/tuwuh.desktop` with a plain write, then validate.

## 2026-09-06: per-provider maps must be read on the backend

Storing `models` and `baseUrls` in the UI is not enough. `ai_chat` loads
settings from disk and used a single `base_url` plus `ai.model`. An Ollama
override then followed the next vendor. Resolve model and endpoint from the
per-provider maps, and never apply a leftover global URL after a switch.

## 2026-09-06: do not git-checkout to undo a mutation test

`git checkout -- src/fs_ops.rs` after a mutation test restored the last commit
and wiped every uncommitted command in that file. Copy the working file aside
first and copy it back. A checkout is for committed history, not a scratch pad.

## 2026-09-06: GTK decorations on Wayland are not a titlebar

`decorations: true` in Tauri still produced a window with no min/max/close and
no resize edges on Plasma 6 Wayland. Draw the chrome in the webview, keep a
1px frame, and call `startDragging` / `startResizeDragging`. `window.close()`
in the webview is not enough; use the Tauri window API.

## 2026-09-06: a 140px min column overflows the pane

Details view used `minmax(140px, 1fr)` plus three fixed columns. Dual pane
plus Places plus info is narrower than that, so the list grew a horizontal
scrollbar and the name column vanished. Name must be `minmax(0, 1fr)` with
`overflow-x: hidden`, and extra columns hide under a container query.

A second `.fm-menu { position: relative }` overwrote the context menu's
`position: fixed`. Context menus and the Alt bar cannot share a class.

## 2026-09-06: lastPaths is two slots, not a screenshot of both panes

Persisting `[paneA.cwd, paneB.cwd]` on every navigation while B is idle at
home overwrites a saved dual-pane path. Update only the slot that moved.
