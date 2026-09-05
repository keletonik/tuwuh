# Lessons

## 2026-09-06: settings fields must exist on both sides of the IPC boundary

A frontend-only `terminalDock` field on `ViewSettings` looked like the feature
existed. `save_settings` deserialises into the Rust struct and writes that
back, so unknown JSON keys were dropped and the choice never survived a
restart. The settings screen then looked broken.

Every persisted preference needs the field in `src/lib/api.ts` and
`src-tauri/src/settings.rs`, a `serde` default so older files still load, and
a round-trip test. A TypeScript type is not persistence.
