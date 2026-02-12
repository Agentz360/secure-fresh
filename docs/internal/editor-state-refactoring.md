# EditorState Refactoring Plan

## Status

**Completed**: `ComposeState` extraction (7 fields → sub-struct).

**Remaining**: EditorState still has 18 fields (17 + 1 sub-struct). Three more
sub-structs would bring it down to ~6 top-level fields.

## Current EditorState layout (post-ComposeState)

```
EditorState
├── buffer: Buffer                                  ← core
├── cursors: Cursors                                ← core
├── primary_cursor_line_number: LineNumber           ← core (cursor cache)
├── mode: String                                    ← buffer flags
├── show_cursors: bool                              ← buffer flags
├── editing_disabled: bool                          ← buffer flags
├── highlighter: HighlightEngine                    ← highlighting
├── reference_highlighter: ReferenceHighlighter     ← highlighting
├── reference_highlight_overlay: ReferenceHighlightOverlay ← highlighting
├── bracket_highlight_overlay: BracketHighlightOverlay     ← highlighting
├── semantic_tokens: Option<SemanticTokenStore>      ← highlighting
├── indent_calculator: RefCell<IndentCalculator>     ← highlighting (language-derived)
├── overlays: OverlayManager                        ← decorations
├── marker_list: MarkerList                         ← decorations
├── virtual_texts: VirtualTextManager               ← decorations
├── popups: PopupManager                            ← decorations
├── margins: MarginManager                          ← decorations
├── text_properties: TextPropertyManager            ← decorations
├── buffer_settings: BufferSettings                 ← already extracted
├── compose: ComposeState                           ← already extracted
├── language: String                                ← metadata
└── (no more flat fields)
```

## Proposed extractions

### 1. `DecorationState` — visual annotations

```rust
pub struct DecorationState {
    pub overlays: OverlayManager,
    pub marker_list: MarkerList,
    pub virtual_texts: VirtualTextManager,
    pub popups: PopupManager,
    pub margins: MarginManager,
    pub text_properties: TextPropertyManager,
}
```

**Why these belong together:**
- All are visual annotations layered on top of buffer content.
- `marker_list` is the shared position-tracking substrate: overlays, virtual texts,
  and margins all register markers and adjust together on insert/delete.
- `popups` are anchored to buffer positions and dismissed on focus loss.
- `text_properties` store metadata on text ranges for virtual buffers.

**Coupling to watch for:**
- `apply_insert`/`apply_delete` call `marker_list.adjust_*` and
  `margins.adjust_*` — these must remain callable from EditorState's `apply`.
  Expose `decorations.adjust_for_insert(pos, len)` /
  `decorations.adjust_for_delete(pos, len)` convenience methods.
- Plugin commands create overlays via `overlays.add()` + `marker_list` — callers
  will need `state.decorations.overlays` / `state.decorations.marker_list`.

**Estimated touch count:** ~40 call sites across `state.rs`, `plugin_commands.rs`,
`split_rendering.rs`, `input.rs`, and the `Event::Add*`/`Event::Remove*` arms.

### 2. `HighlightState` — syntax/semantic highlighting

```rust
pub struct HighlightState {
    pub engine: HighlightEngine,
    pub indent_calculator: RefCell<IndentCalculator>,
    pub reference_highlighter: ReferenceHighlighter,
    pub reference_highlight_overlay: ReferenceHighlightOverlay,
    pub bracket_highlight_overlay: BracketHighlightOverlay,
    pub semantic_tokens: Option<SemanticTokenStore>,
}
```

**Why these belong together:**
- All derive from the buffer's language: `engine` does syntax highlighting,
  `indent_calculator` needs grammar info, `reference_highlighter` uses language
  to find word boundaries, and `semantic_tokens` come from the LSP for that language.
- `reference_highlight_overlay` and `bracket_highlight_overlay` are caches that
  debounce re-computation of reference/bracket highlights — closely tied to the
  highlighter.
- When the language changes (file rename, `set_language_from_name`), all of these
  need resetting.

**Coupling to watch for:**
- `apply_insert`/`apply_delete` call `highlighter.invalidate_range()` — expose
  via `highlights.invalidate_range(range)`.
- Rendering reads `highlighter` + `semantic_tokens` together in
  `split_rendering.rs`.
- `indent_calculator` uses `RefCell` for interior mutability; putting it inside the
  sub-struct doesn't change borrow semantics since it's already behind `RefCell`.

**Estimated touch count:** ~25 call sites across `state.rs`, `split_rendering.rs`,
`file_operations.rs`, `lsp_requests.rs`, `prompt_actions.rs`.

### 3. `BufferFlags` — access control flags

```rust
pub struct BufferFlags {
    pub mode: String,
    pub show_cursors: bool,
    pub editing_disabled: bool,
}
```

**Why these belong together:**
- All three control what the user can *do* with the buffer (edit, see cursors,
  modal mode) rather than what the buffer *contains*.
- Set together when creating virtual/composite buffers (e.g.,
  `editing_disabled = true; show_cursors = false; mode = "special"`).
- Checked together in input handling to gate operations.

**This is the smallest extraction** (~10 call sites) and could be done first as a
quick win, or skipped if the overhead isn't justified for 3 fields.

## After all extractions

```
EditorState
├── buffer: Buffer
├── cursors: Cursors
├── primary_cursor_line_number: LineNumber
├── buffer_settings: BufferSettings
├── compose: ComposeState
├── decorations: DecorationState
├── highlights: HighlightState
├── flags: BufferFlags
├── language: String
```

9 top-level fields (5 sub-structs + 4 core fields). Each sub-struct groups
fields by concern and access pattern.

## Execution order

1. **`DecorationState`** — highest field count (6), clearest grouping, biggest
   reduction. Do this first.
2. **`HighlightState`** — second highest (6 fields), well-bounded access pattern.
3. **`BufferFlags`** — smallest (3 fields), optional. Only worth doing if the
   consistency of "everything is grouped" outweighs the churn.

Each extraction is independent and can be done in a single commit following the
same pattern as the `ComposeState` extraction:
- Add struct + Default impl
- Replace fields in EditorState
- Update constructors
- Fix all `state.field` → `state.sub.field` references
- `cargo build` verifies completeness (all renamings are compile errors if missed)

## Non-goals

- **Moving fields to `SplitViewState`**: some fields (e.g., `margins`,
  `debug_highlight_mode`) could arguably be per-split rather than per-buffer.
  That's a semantic change, not just a grouping refactor — punt to a separate
  effort.
- **Reducing `SplitViewState`**: it has its own compose fields that mirror
  `ComposeState`. Deduplication there (e.g., having splits hold an
  `Option<ComposeState>` override) is a separate task.
- **Trait-based abstraction**: no need to add traits for these sub-structs.
  Plain data grouping is sufficient.
