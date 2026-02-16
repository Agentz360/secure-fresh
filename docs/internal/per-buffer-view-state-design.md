# Design: Keyed Per-Buffer Per-View State

## Status

Core architecture: **Implemented** (February 14-15, 2026)
Plugin API & migration: **Implemented** (February 15, 2026)
Content-dependent state invalidation: **Not started**

## What Was Done

The core per-buffer-per-view state system is fully in place:

- **`BufferViewState` struct** (`view/split.rs`) — holds `cursors`, `viewport`, `view_mode`, `compose_width`, `compose_column_guides`, `view_transform`, `plugin_state`, and related fields per buffer per split.
- **`SplitViewState` refactored** — buffer-specific fields replaced with `active_buffer: BufferId` and `keyed_states: HashMap<BufferId, BufferViewState>`. Accessors `active_state()` / `active_state_mut()` plus helpers (`buffer_state`, `ensure_buffer_state`, `remove_buffer_state`, `switch_buffer`). `Deref`/`DerefMut` impls proxy to the active state for backward compatibility.
- **Cursor migration** — `EditorState.cursors` removed. Cursors live exclusively in `BufferViewState`; editing operations access them through the split view state. All cursor sync calls (`save_current_split_view_state` / `restore_current_split_view_state`) eliminated.
- **`ComposeState` removed from `EditorState`** — `view_mode`, `compose_width`, and related fields now live only in `BufferViewState`.
- **Workspace persistence** — `workspace.rs` stores per-file state (`view_mode`, `compose_width`, cursor, scroll, `plugin_state`) in `file_states: HashMap<PathBuf, SerializedFileState>` within each `SerializedSplitViewState`.

### Plugin state API

- **`plugin_state: HashMap<String, serde_json::Value>`** added to `BufferViewState` — plugins can store arbitrary per-buffer-per-split state.
- **`PluginCommand::SetViewState`** — JS plugins send state changes via the command channel; the handler persists values in `BufferViewState.plugin_state`.
- **`EditorStateSnapshot.plugin_view_states`** — write-through cache in the snapshot allows immediate read-back within the same hook execution. The snapshot is populated from `BufferViewState.plugin_state` on each frame (using `or_insert` to preserve JS-side writes that haven't round-tripped yet). When the active split changes, the cache is fully repopulated.
- **`JsEditorApi::set_view_state` / `get_view_state`** — `setViewState(bufferId, key, value)` writes through to the snapshot AND sends a command for Rust-side persistence. `getViewState(bufferId, key)` reads from the snapshot. Passing `null`/`undefined` as the value deletes the key.
- **TypeScript declarations** — `setViewState` and `getViewState` added to `EditorAPI` in `fresh.d.ts`.
- **Persistence** — `SerializedFileState.plugin_state` round-trips through workspace save/restore, so plugin state survives editor restarts.

### markdown_compose plugin migration

- **`composeBuffers` removed** — compose activation is tracked by `view_mode` in `BufferViewState` (via `editor.getBufferInfo().view_mode === "compose"`). A local `isComposing()` helper replaces all `composeBuffers.has()` checks.
- **`tableColumnWidths` migrated** — replaced with `editor.setViewState(bufferId, "table-widths", ...)` / `editor.getViewState(bufferId, "table-widths")`. Table widths now persist across sessions and are independent per split. Helper functions `getTableWidths()`, `setTableWidths()`, `clearTableWidths()` handle Map↔Object conversion for JSON serialization.
- **`lastCursorLine` migrated** — replaced with `editor.setViewState(bufferId, "last-cursor-line", line)` / `editor.getViewState(bufferId, "last-cursor-line")`.
- **`enableMarkdownCompose` made idempotent** — safe to call when already in compose mode, enabling session restore without the old `composeBuffers` guard.
- **`processBuffer` inlined** — its sole caller was `enableMarkdownCompose`; the `refreshLines` call is now inline.

## Remaining Work

### Content-dependent state invalidation

When a buffer is edited from one split, other splits viewing the same buffer should invalidate content-dependent plugin state (e.g., `tableColumnWidths`). Plugins can listen for `buffer_changed` events and mark cached state stale. This needs implementation and testing.

## Open Questions

- **Undo interaction**: View mode changes are not undoable (undo only covers buffer content). Recommendation: keep it this way, revisit if users report it as a problem.

- **Same buffer, multiple splits**: Content is shared but view state is per-split. The `buffer_changed` hook for invalidating content-dependent plugin state needs testing once content-dependent state invalidation is implemented.
