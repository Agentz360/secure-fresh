# Encoding Support Design for Fresh Editor

## 1. Analysis of Existing CR/LF Support

The CR/LF implementation in fresh provides an excellent architectural template for encoding support. Here's a summary of the key patterns:

### 1.1 Core Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LOAD PHASE                                  │
├─────────────────────────────────────────────────────────────────────┤
│  File (bytes) → detect_line_ending(first 8KB) → LineEnding enum    │
│  Content bytes preserved as-is (NOT normalized)                     │
│  Format stored in: line_ending + original_line_ending              │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        EDITING PHASE                                │
├─────────────────────────────────────────────────────────────────────┤
│  New lines inserted use current line_ending format                  │
│  Cursor movements treat CRLF as single logical unit                 │
│  Clipboard: normalize → convert to buffer format                    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SAVE PHASE                                  │
├─────────────────────────────────────────────────────────────────────┤
│  if line_ending == original_line_ending:                           │
│      Use Copy operations (zero-copy from original file)            │
│  else:                                                              │
│      Load chunks → convert_line_endings_to() → Insert operations   │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Design Decisions in CR/LF Support

| Decision | Rationale |
|----------|-----------|
| **Preserve original bytes on load** | Enables Copy optimization when format unchanged |
| **Track `original_line_ending`** | Detect user-initiated format changes |
| **8KB sample for detection** | Balance accuracy vs. performance for large files |
| **Two-pass conversion** | Any-format → LF → target-format simplifies logic |
| **CRLF as cursor unit** | User never positions cursor between \r and \n |
| **Majority voting** | Handles mixed line endings gracefully |

### 1.3 Large File Support Integration

- Detection uses first 8KB only (efficient for multi-GB files)
- Content stored as `BufferData::Unloaded` with file reference
- Chunks loaded on-demand in 1MB pieces (64KB aligned)
- Conversion applied per-chunk during streaming save

---

## 2. Encoding Support Requirements

### 2.1 Core Requirements

1. **Auto-detect encoding on load** (UTF-8, UTF-16 LE/BE, Latin-1, etc.)
2. **Convert to canonical internal format** (UTF-8) for editing
3. **Preserve original encoding metadata** for save
4. **Convert back to original encoding on save** (unless user changed it)
5. **Support large files** with lazy loading
6. **Handle BOM** (Byte Order Mark) for UTF-8/UTF-16
7. **Handle invalid byte sequences** gracefully

### 2.2 Key Differences from CR/LF

| Aspect | CR/LF | Encoding |
|--------|-------|----------|
| Internal representation | Bytes preserved | Must convert to UTF-8 |
| Byte interpretation | Only \r\n\r affected | All bytes affected |
| Chunk boundaries | Safe (ASCII chars) | Unsafe (multi-byte chars may split) |
| Detection complexity | Simple pattern matching | Heuristic + BOM + charset detection |
| Invalid sequences | N/A (any bytes valid) | Must handle/replace invalid |
| Size change | Small (CRLF ↔ LF) | Can be significant (UTF-16 → UTF-8) |

---

## 3. Design Alternatives

### Alternative A: Normalize on Load (Recommended)

**Approach**: Convert all content to UTF-8 on load, track original encoding, convert back on save.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LOAD PHASE                                  │
├─────────────────────────────────────────────────────────────────────┤
│  File (bytes) → detect_encoding(sample) → Encoding enum            │
│  Content converted to UTF-8 immediately                             │
│  Original encoding stored in: encoding + original_encoding          │
│  BOM presence tracked: has_bom: bool                                │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        EDITING PHASE                                │
├─────────────────────────────────────────────────────────────────────┤
│  All editing in UTF-8 (native Rust string handling)                │
│  Clipboard always UTF-8 (no conversion needed)                      │
│  Line ending handling unchanged (operates on UTF-8)                 │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SAVE PHASE                                  │
├─────────────────────────────────────────────────────────────────────┤
│  if encoding == original_encoding && !content_modified:            │
│      Bytes match original → use Copy operations                     │
│  else:                                                              │
│      Convert UTF-8 → target encoding                                │
│      Add BOM if has_bom && encoding supports BOM                    │
└─────────────────────────────────────────────────────────────────────┘
```

**Data Structures**:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Encoding {
    #[default]
    Utf8,
    Utf8Bom,       // UTF-8 with BOM
    Utf16Le,       // UTF-16 Little Endian (Windows default)
    Utf16Be,       // UTF-16 Big Endian
    Latin1,        // ISO-8859-1
    Windows1252,   // Windows codepage 1252
    // Additional encodings as needed
}

pub struct TextBuffer {
    // ... existing fields ...

    /// Current encoding for the buffer
    encoding: Encoding,

    /// Original encoding when file was loaded
    original_encoding: Encoding,

    /// Whether original file had a BOM
    has_bom: bool,
}
```

**Pros**:
- Simple editing model (everything is UTF-8)
- Rust string handling works natively
- Line ending code unchanged
- Consistent cursor/grapheme behavior
- Existing search/replace works without modification

**Cons**:
- Cannot use Copy optimization for chunks (bytes changed)
- Memory usage may increase (UTF-8 can be larger than original)
- Load time increased for conversion
- Original byte positions lost (affects some advanced features)

**Large File Handling**:
```rust
// For large files, convert chunks on-demand
fn load_large_file(path: &Path, file_size: usize) -> Result<Self> {
    // Detect encoding from first 8KB
    let sample = fs.read_range(path, 0, 8192)?;
    let encoding = detect_encoding(&sample);

    // For UTF-8 files: keep as Unloaded (lazy load)
    // For other encodings: must load and convert immediately
    //   OR use a transcoding layer (see Alternative B)

    if encoding == Encoding::Utf8 {
        // Can use lazy loading
        create_unloaded_buffer(path, file_size, encoding)
    } else {
        // Must convert - load fully or use streaming conversion
        load_and_convert_streaming(path, encoding)
    }
}
```

---

### Alternative B: Lazy Transcoding Layer

**Approach**: Keep original bytes, transcode on-demand when reading content for display/editing.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BUFFER STRUCTURE                                 │
├─────────────────────────────────────────────────────────────────────┤
│  StringBuffer contains original bytes (any encoding)                │
│  PieceTree tracks byte offsets in original encoding                │
│  Transcoding layer converts to UTF-8 for display/editing           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    ACCESS PATTERN                                   │
├─────────────────────────────────────────────────────────────────────┤
│  get_text_range(offset, len):                                       │
│    1. Read raw bytes from piece tree                                │
│    2. Adjust bounds to encoding-safe boundaries                     │
│    3. Transcode to UTF-8                                            │
│    4. Return UTF-8 string                                           │
│                                                                     │
│  insert(offset, text):                                              │
│    1. Encode text from UTF-8 to buffer's encoding                   │
│    2. Insert encoded bytes into piece tree                          │
│    3. Update byte offsets                                           │
└─────────────────────────────────────────────────────────────────────┘
```

**Pros**:
- Copy optimization preserved for unchanged regions
- Memory matches original file size
- Lazy loading fully supported
- Can handle very large files efficiently

**Cons**:
- Complex implementation (every buffer access needs transcoding)
- Performance overhead on every read
- Chunk boundary handling is error-prone (multi-byte chars)
- Cursor position mapping between byte offset and character offset
- Search/replace needs to work in original encoding or transcode
- New inserts are in different encoding than original (mixed buffer)

**Chunk Boundary Problem**:
```
UTF-16LE: [0x48, 0x00, 0x65, 0x00, 0x6C, 0x00, ...]  "Hello..."
                                         ↑
                                    Chunk boundary here

Problem: If chunk boundary falls between 0x6C and 0x00,
         the 'l' character is split across chunks!

Solution: Encoding-aware chunk alignment
  - For UTF-16: align to 2-byte boundaries
  - For UTF-8: scan back to find valid start byte
```

---

### Alternative C: Hybrid Approach

**Approach**: Normalize on load for small/medium files, use lazy transcoding for large files only.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SIZE-BASED STRATEGY                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  if file_size < LARGE_FILE_THRESHOLD (100MB):                      │
│      → Full normalization to UTF-8 (Alternative A)                  │
│      → Simple, fast, consistent                                     │
│                                                                     │
│  else:                                                              │
│      → Lazy transcoding (Alternative B)                             │
│      → Memory efficient, but complex                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Pros**:
- Best of both worlds for common cases
- 99% of files get simple UTF-8 model
- Large files still supported efficiently

**Cons**:
- Two code paths to maintain
- Inconsistent behavior between small and large files
- Edge cases at threshold boundary

---

### Alternative D: UTF-8 Only with Conversion Warning

**Approach**: Always work in UTF-8, warn user on non-UTF-8 files, offer one-time conversion.

```
┌─────────────────────────────────────────────────────────────────────┐
│                      LOAD BEHAVIOR                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  if encoding == UTF-8:                                              │
│      → Load normally                                                │
│                                                                     │
│  else:                                                              │
│      → Show warning: "File is encoded as Latin-1. Convert to       │
│        UTF-8 for editing? Original encoding will be preserved      │
│        on save unless you choose otherwise."                        │
│      → User can: [Convert & Edit] [Open Read-Only] [Cancel]        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Pros**:
- Simplest implementation
- Makes encoding visible to user
- Encourages UTF-8 adoption
- No hidden conversion surprises

**Cons**:
- Poor UX for legacy codebases with many non-UTF-8 files
- Extra confirmation step
- May frustrate users who "just want to edit"

---

## 4. Comparison Matrix

| Criterion | Alt A (Normalize) | Alt B (Lazy Transcode) | Alt C (Hybrid) | Alt D (UTF-8 Only) |
|-----------|-------------------|------------------------|----------------|-------------------|
| **Implementation Complexity** | Medium | High | High | Low |
| **Memory Efficiency** | Lower | Best | Good | Lower |
| **Large File Support** | Limited* | Excellent | Excellent | Limited* |
| **Edit Performance** | Best | Lower | Mixed | Best |
| **Code Maintainability** | Good | Complex | Complex | Simple |
| **Copy Optimization** | No | Yes | Partial | No |
| **User Experience** | Transparent | Transparent | Transparent | Explicit |
| **Correctness Risk** | Low | High | Medium | Low |

\* Can still work with streaming conversion

---

## 5. Encoding Detection Strategy

Regardless of which alternative is chosen, encoding detection is common:

```rust
pub fn detect_encoding(bytes: &[u8]) -> (Encoding, bool /* has_bom */) {
    // 1. Check for BOM (highest priority)
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (Encoding::Utf8Bom, true);
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return (Encoding::Utf16Le, true);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return (Encoding::Utf16Be, true);
    }

    // 2. Try UTF-8 validation (fast path for most files)
    if std::str::from_utf8(bytes).is_ok() {
        return (Encoding::Utf8, false);
    }

    // 3. Statistical detection for legacy encodings
    //    - Check for null bytes (UTF-16 indicator)
    //    - Character frequency analysis
    //    - Use chardet/encoding_rs heuristics

    // 4. Default to Latin-1 (always valid, byte = codepoint)
    (Encoding::Latin1, false)
}
```

**Crate Recommendations**:
- `encoding_rs`: Fast, production-ready encoding conversion
- `chardetng`: Charset detection (mozilla's algorithm)

---

## 6. Recommended Approach

**Primary Recommendation: Alternative A (Normalize on Load)** with streaming support for large files.

**Rationale**:
1. **Consistency with CR/LF model**: Similar detect → track → convert architecture
2. **Simpler editing model**: All code works with UTF-8
3. **Lower bug risk**: No transcoding layer complexity
4. **Good enough for most users**: Large non-UTF-8 files are rare
5. **Clear path to enhancement**: Can add lazy transcoding later if needed

**Suggested Implementation Order**:
1. Add `Encoding` enum and buffer fields
2. Implement `detect_encoding()` with BOM and UTF-8 validation
3. Add encoding conversion on load (small files first)
4. Add status bar display and SetEncoding command (mirror SetLineEnding)
5. Implement save conversion
6. Add streaming conversion for large files
7. Consider lazy transcoding for UTF-16 large files if demand exists

---

## 7. Integration Points

### 7.1 Files to Modify

| File | Changes |
|------|---------|
| `buffer.rs` | Add Encoding enum, fields, detect/convert functions |
| `piece_tree.rs` | Potentially: encoding-aware chunk splitting |
| `input.rs` | Add SetEncoding prompt (like SetLineEnding) |
| `status_bar.rs` | Display encoding in status bar |
| `clipboard.rs` | Already UTF-8, minimal changes |
| `filesystem.rs` | Possibly: encoding-aware read functions |

### 7.2 Compatibility with Existing Features

| Feature | Impact |
|---------|--------|
| Line endings | Works on UTF-8 → no change |
| Search/Replace | Works on UTF-8 → no change |
| Syntax highlighting | Works on UTF-8 → no change |
| LSP | Already UTF-8 → no change |
| Clipboard | Already UTF-8 → no change |
| Undo/Redo | Works on UTF-8 pieces → no change |
| Recovery | May need encoding metadata in recovery file |

---

## 8. Open Questions

1. **Invalid byte sequences**: Replace with U+FFFD or preserve as escaped hex?
2. **Mixed encoding detection**: What if file has multiple encodings?
3. **Encoding change confirmation**: Warn user when changing encoding on save?
4. **Default for new files**: Always UTF-8 or follow system locale?
5. **Encoding in status bar**: Always show, or only for non-UTF-8?
