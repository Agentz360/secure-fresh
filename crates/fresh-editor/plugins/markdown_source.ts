/// <reference path="./lib/fresh.d.ts" />
// Markdown Source Mode Plugin
// Provides smart editing features for Markdown files in source (non-compose) mode:
// - Enter: auto-indent matching the previous line's leading whitespace
// - Tab: insert spaces (always spaces, never literal tabs - markdown convention)
// - Shift+Tab: falls through to built-in dedent_selection
//
// This plugin defines a "markdown-source" mode that auto-activates when a
// markdown file is opened in source view. It uses readOnly=false so that
// normal character insertion is unaffected.

const editor = getEditor();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TAB_SIZE = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMarkdownFile(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".markdown") || path.endsWith(".mdx");
}

// ---------------------------------------------------------------------------
// Enter handler: insert newline and match previous line's indentation
// ---------------------------------------------------------------------------

globalThis.md_src_enter = async function (): Promise<void> {
  const bufferId = editor.getActiveBufferId();
  if (!bufferId) {
    editor.executeAction("insert_newline");
    return;
  }

  const cursorPos = editor.getCursorPosition();

  // Read a window of text before the cursor to find the current line.
  // 1024 bytes is plenty for any realistic line length.
  const windowStart = Math.max(0, cursorPos - 1024);
  const textWindow = await editor.getBufferText(bufferId, windowStart, cursorPos);

  // Find the last newline in the window to locate the start of the current line
  const lastNl = textWindow.lastIndexOf("\n");
  const lineText = lastNl >= 0 ? textWindow.substring(lastNl + 1) : textWindow;

  // Extract leading whitespace
  let indent = "";
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (ch === " " || ch === "\t") {
      indent += ch;
    } else {
      break;
    }
  }

  // Insert newline + matching indentation at cursor
  editor.insertAtCursor("\n" + indent);
};

// ---------------------------------------------------------------------------
// Tab handler: insert spaces (configurable, defaults to 4)
// ---------------------------------------------------------------------------

globalThis.md_src_tab = function (): void {
  const spaces = " ".repeat(TAB_SIZE);
  editor.insertAtCursor(spaces);
};

// ---------------------------------------------------------------------------
// Mode definition
// ---------------------------------------------------------------------------

// Define a non-read-only mode so unmapped keys insert normally.
// Enter and Tab are intercepted; Shift+Tab (BackTab) falls through to the
// default keybinding which is already dedent_selection.
editor.defineMode("markdown-source", null, [
  ["Enter", "md_src_enter"],
  ["Tab", "md_src_tab"],
], false);

// ---------------------------------------------------------------------------
// Auto-activation: switch mode when a markdown file is focused
// ---------------------------------------------------------------------------

globalThis.md_src_on_buffer_activated = function (): void {
  const bufferId = editor.getActiveBufferId();
  if (!bufferId) return;

  const info = editor.getBufferInfo(bufferId);
  if (!info) return;

  const currentMode = editor.getEditorMode();

  if (isMarkdownFile(info.path) && info.view_mode === "source") {
    // Only activate if no other mode is already set (e.g., vi-mode)
    if (currentMode == null) {
      editor.setEditorMode("markdown-source");
    }
  } else {
    // Leaving a markdown file or switching to compose mode: deactivate
    if (currentMode === "markdown-source") {
      editor.setEditorMode(null);
    }
  }
};

editor.on("buffer_activated", "md_src_on_buffer_activated");

editor.debug("markdown_source plugin loaded");
