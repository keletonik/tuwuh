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

## 2026-09-06: lastPaths is two slots, not a screenshot of both panes

Persisting `[paneA.cwd, paneB.cwd]` on every navigation while B is idle at
home overwrites a saved dual-pane path. Update only the slot that moved.
