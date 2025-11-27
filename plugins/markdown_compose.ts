// Markdown Compose Mode Plugin
// Provides beautiful, semi-WYSIWYG rendering of Markdown documents
// - Highlighting: automatically enabled for all markdown files
// - Compose mode: explicitly toggled, adds margins, soft-wrapping, different editing

interface MarkdownConfig {
  composeWidth: number;
  maxWidth: number;
  hideLineNumbers: boolean;
}

const config: MarkdownConfig = {
  composeWidth: 80,
  maxWidth: 100,
  hideLineNumbers: true,
};

// Track buffers with highlighting enabled (auto for markdown files)
const highlightingBuffers = new Set<number>();

// Track buffers in compose mode (explicit toggle)
const composeBuffers = new Set<number>();

// Track which buffers need their overlays refreshed (content changed)
const dirtyBuffers = new Set<number>();

// Markdown token types for parsing
enum TokenType {
  Header1,
  Header2,
  Header3,
  Header4,
  Header5,
  Header6,
  ListItem,
  OrderedListItem,
  Checkbox,
  CodeBlockFence,
  CodeBlockContent,
  BlockQuote,
  HorizontalRule,
  Paragraph,
  HardBreak,
  Image,  // Images should have hard breaks (not soft breaks)
  InlineCode,
  Bold,
  Italic,
  Strikethrough,
  Link,
  LinkText,
  LinkUrl,
  Text,
}

interface Token {
  type: TokenType;
  start: number;  // byte offset
  end: number;    // byte offset
  text: string;
  level?: number; // For headers, list indentation
  checked?: boolean; // For checkboxes
}

// Types match the Rust ViewTokenWire structure
interface ViewTokenWire {
  source_offset: number | null;
  kind: ViewTokenWireKind;
}

type ViewTokenWireKind =
  | { Text: string }
  | "Newline"
  | "Space"
  | "Break";

interface LayoutHints {
  compose_width?: number | null;
  column_guides?: number[] | null;
}

// =============================================================================
// Block-based parser for hanging indent support
// =============================================================================

interface ParsedBlock {
  type: 'paragraph' | 'list-item' | 'ordered-list' | 'checkbox' | 'blockquote' |
        'heading' | 'code-fence' | 'code-content' | 'hr' | 'empty' | 'image';
  startByte: number;           // First byte of the line
  endByte: number;             // Byte after last char (before newline)
  leadingIndent: number;       // Spaces before marker/content
  marker: string;              // "- ", "1. ", "> ", "## ", etc.
  markerStartByte: number;     // Where marker begins
  contentStartByte: number;    // Where content begins (after marker)
  content: string;             // The actual text content (after marker)
  hangingIndent: number;       // Continuation indent for wrapped lines
  forceHardBreak: boolean;     // Should this block end with hard newline?
  headingLevel?: number;       // For headings (1-6)
  checked?: boolean;           // For checkboxes
}

/**
 * Parse a markdown document into blocks with structure info for wrapping
 */
function parseMarkdownBlocks(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = text.split('\n');
  let byteOffset = 0;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = byteOffset;
    const lineEnd = byteOffset + line.length;

    // Code block detection
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      blocks.push({
        type: 'code-fence',
        startByte: lineStart,
        endByte: lineEnd,
        leadingIndent: line.length - line.trimStart().length,
        marker: '',
        markerStartByte: lineStart,
        contentStartByte: lineStart,
        content: line,
        hangingIndent: 0,
        forceHardBreak: true,
      });
      byteOffset = lineEnd + 1;
      continue;
    }

    if (inCodeBlock) {
      blocks.push({
        type: 'code-content',
        startByte: lineStart,
        endByte: lineEnd,
        leadingIndent: 0,
        marker: '',
        markerStartByte: lineStart,
        contentStartByte: lineStart,
        content: line,
        hangingIndent: 0,
        forceHardBreak: true,
      });
      byteOffset = lineEnd + 1;
      continue;
    }

    // Empty line
    if (trimmed.length === 0) {
      blocks.push({
        type: 'empty',
        startByte: lineStart,
        endByte: lineEnd,
        leadingIndent: 0,
        marker: '',
        markerStartByte: lineStart,
        contentStartByte: lineStart,
        content: '',
        hangingIndent: 0,
        forceHardBreak: true,
      });
      byteOffset = lineEnd + 1;
      continue;
    }

    // Headers: # Heading
    const headerMatch = line.match(/^(\s*)(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      const leadingIndent = headerMatch[1].length;
      const marker = headerMatch[2] + ' ';
      const content = headerMatch[3];
      blocks.push({
        type: 'heading',
        startByte: lineStart,
        endByte: lineEnd,
        leadingIndent,
        marker,
        markerStartByte: lineStart + leadingIndent,
        contentStartByte: lineStart + leadingIndent + marker.length,
        content,
        hangingIndent: 0,
        forceHardBreak: true,
        headingLevel: headerMatch[2].length,
      });
      byteOffset = lineEnd + 1;
      continue;
    }

    // Horizontal rule
    if (trimmed.match(/^(-{3,}|\*{3,}|_{3,})$/)) {
      blocks.push({
        type: 'hr',
        startByte: lineStart,
        endByte: lineEnd,
        leadingIndent: line.length - line.trimStart().length,
        marker: '',
        markerStartByte: lineStart,
        contentStartByte: lineStart,
        content: line,
        hangingIndent: 0,
        forceHardBreak: true,
      });
      byteOffset = lineEnd + 1;
      continue;
    }

    // Checkbox: - [ ] or - [x]
    const checkboxMatch = line.match(/^(\s*)([-*+])\s+(\[[ x]\])\s+(.*)$/);
    if (checkboxMatch) {
      const leadingIndent = checkboxMatch[1].length;
      const bullet = checkboxMatch[2];
      const checkbox = checkboxMatch[3];
      const marker = bullet + ' ' + checkbox + ' ';
      const content = checkboxMatch[4];
      const checked = checkbox === '[x]';
      blocks.push({
        type: 'checkbox',
        startByte: lineStart,
        endByte: lineEnd,
        leadingIndent,
        marker,
        markerStartByte: lineStart + leadingIndent,
        contentStartByte: lineStart + leadingIndent + marker.length,
        content,
        hangingIndent: leadingIndent + marker.length,
        forceHardBreak: true,
        checked,
      });
      byteOffset = lineEnd + 1;
      continue;
    }

    // Unordered list: - item or * item or + item
    const bulletMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (bulletMatch) {
      const leadingIndent = bulletMatch[1].length;
      const bullet = bulletMatch[2];
      const marker = bullet + ' ';
      const content = bulletMatch[3];
      blocks.push({
        type: 'list-item',
        startByte: lineStart,
        endByte: lineEnd,
        leadingIndent,
        marker,
        markerStartByte: lineStart + leadingIndent,
        contentStartByte: lineStart + leadingIndent + marker.length,
        content,
        hangingIndent: leadingIndent + marker.length,
        forceHardBreak: true,
      });
      byteOffset = lineEnd + 1;
      continue;
    }

    // Ordered list: 1. item
    const orderedMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (orderedMatch) {
      const leadingIndent = orderedMatch[1].length;
      const number = orderedMatch[2];
      const marker = number + ' ';
      const content = orderedMatch[3];
      blocks.push({
        type: 'ordered-list',
        startByte: lineStart,
        endByte: lineEnd,
        leadingIndent,
        marker,
        markerStartByte: lineStart + leadingIndent,
        contentStartByte: lineStart + leadingIndent + marker.length,
        content,
        hangingIndent: leadingIndent + marker.length,
        forceHardBreak: true,
      });
      byteOffset = lineEnd + 1;
      continue;
    }

    // Block quote: > text
    const quoteMatch = line.match(/^(\s*)(>)\s*(.*)$/);
    if (quoteMatch) {
      const leadingIndent = quoteMatch[1].length;
      const marker = '> ';
      const content = quoteMatch[3];
      blocks.push({
        type: 'blockquote',
        startByte: lineStart,
        endByte: lineEnd,
        leadingIndent,
        marker,
        markerStartByte: lineStart + leadingIndent,
        contentStartByte: lineStart + leadingIndent + 2, // "> " is 2 chars
        content,
        hangingIndent: leadingIndent + 2,
        forceHardBreak: true,
      });
      byteOffset = lineEnd + 1;
      continue;
    }

    // Image: ![alt](url)
    if (trimmed.match(/^!\[.*\]\(.*\)$/)) {
      blocks.push({
        type: 'image',
        startByte: lineStart,
        endByte: lineEnd,
        leadingIndent: line.length - line.trimStart().length,
        marker: '',
        markerStartByte: lineStart,
        contentStartByte: lineStart,
        content: line,
        hangingIndent: 0,
        forceHardBreak: true,
      });
      byteOffset = lineEnd + 1;
      continue;
    }

    // Hard break (trailing spaces or backslash)
    const hasHardBreak = line.endsWith('  ') || line.endsWith('\\');

    // Default: paragraph
    const leadingIndent = line.length - line.trimStart().length;
    blocks.push({
      type: 'paragraph',
      startByte: lineStart,
      endByte: lineEnd,
      leadingIndent,
      marker: '',
      markerStartByte: lineStart + leadingIndent,
      contentStartByte: lineStart + leadingIndent,
      content: trimmed,
      hangingIndent: leadingIndent,  // Paragraph continuation aligns with first line
      forceHardBreak: hasHardBreak,
    });
    byteOffset = lineEnd + 1;
  }

  return blocks;
}

// Colors for styling (RGB tuples)
const COLORS = {
  header: [100, 149, 237] as [number, number, number], // Cornflower blue
  code: [152, 195, 121] as [number, number, number],   // Green
  codeBlock: [152, 195, 121] as [number, number, number],
  fence: [80, 80, 80] as [number, number, number],     // Subdued gray for ```
  link: [86, 156, 214] as [number, number, number],    // Light blue
  linkUrl: [80, 80, 80] as [number, number, number],   // Subdued gray
  bold: [255, 255, 220] as [number, number, number],   // Bright for bold text
  boldMarker: [80, 80, 80] as [number, number, number], // Subdued for ** markers
  italic: [198, 180, 221] as [number, number, number], // Light purple for italic
  italicMarker: [80, 80, 80] as [number, number, number], // Subdued for * markers
  quote: [128, 128, 128] as [number, number, number],  // Gray
  checkbox: [152, 195, 121] as [number, number, number], // Green
  listBullet: [86, 156, 214] as [number, number, number], // Light blue
};

// Simple Markdown parser
class MarkdownParser {
  private text: string;
  private tokens: Token[] = [];

  constructor(text: string) {
    this.text = text;
  }

  parse(): Token[] {
    const lines = this.text.split('\n');
    let byteOffset = 0;
    let inCodeBlock = false;
    let codeFenceStart = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = byteOffset;
      const lineEnd = byteOffset + line.length;

      // Code block detection
      if (line.trim().startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeFenceStart = lineStart;
          this.tokens.push({
            type: TokenType.CodeBlockFence,
            start: lineStart,
            end: lineEnd,
            text: line,
          });
        } else {
          this.tokens.push({
            type: TokenType.CodeBlockFence,
            start: lineStart,
            end: lineEnd,
            text: line,
          });
          inCodeBlock = false;
        }
      } else if (inCodeBlock) {
        this.tokens.push({
          type: TokenType.CodeBlockContent,
          start: lineStart,
          end: lineEnd,
          text: line,
        });
      } else {
        // Parse line structure
        this.parseLine(line, lineStart, lineEnd);
      }

      byteOffset = lineEnd + 1; // +1 for newline
    }

    // Parse inline styles after structure
    this.parseInlineStyles();

    return this.tokens;
  }

  private parseLine(line: string, start: number, end: number): void {
    const trimmed = line.trim();

    // Headers
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const type = [
        TokenType.Header1,
        TokenType.Header2,
        TokenType.Header3,
        TokenType.Header4,
        TokenType.Header5,
        TokenType.Header6,
      ][level - 1];
      this.tokens.push({
        type,
        start,
        end,
        text: line,
        level,
      });
      return;
    }

    // Horizontal rule
    if (trimmed.match(/^(-{3,}|\*{3,}|_{3,})$/)) {
      this.tokens.push({
        type: TokenType.HorizontalRule,
        start,
        end,
        text: line,
      });
      return;
    }

    // List items
    const bulletMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      const hasCheckbox = bulletMatch[3].match(/^\[([ x])\]\s+/);

      if (hasCheckbox) {
        this.tokens.push({
          type: TokenType.Checkbox,
          start,
          end,
          text: line,
          level: indent,
          checked: hasCheckbox[1] === 'x',
        });
      } else {
        this.tokens.push({
          type: TokenType.ListItem,
          start,
          end,
          text: line,
          level: indent,
        });
      }
      return;
    }

    // Ordered list
    const orderedMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (orderedMatch) {
      const indent = orderedMatch[1].length;
      this.tokens.push({
        type: TokenType.OrderedListItem,
        start,
        end,
        text: line,
        level: indent,
      });
      return;
    }

    // Block quote
    if (trimmed.startsWith('>')) {
      this.tokens.push({
        type: TokenType.BlockQuote,
        start,
        end,
        text: line,
      });
      return;
    }

    // Hard breaks (two spaces + newline, or backslash + newline)
    if (line.endsWith('  ') || line.endsWith('\\')) {
      this.tokens.push({
        type: TokenType.HardBreak,
        start,
        end,
        text: line,
      });
      return;
    }

    // Images: ![alt](url) - these should have hard breaks to keep each on its own line
    if (trimmed.match(/^!\[.*\]\(.*\)$/)) {
      this.tokens.push({
        type: TokenType.Image,
        start,
        end,
        text: line,
      });
      return;
    }

    // Default: paragraph
    if (trimmed.length > 0) {
      this.tokens.push({
        type: TokenType.Paragraph,
        start,
        end,
        text: line,
      });
    }
  }

  private parseInlineStyles(): void {
    // Parse inline markdown (bold, italic, code, links) within text
    // This is a simplified parser - a full implementation would use a proper MD parser

    for (const token of this.tokens) {
      if (token.type === TokenType.Paragraph ||
          token.type === TokenType.ListItem ||
          token.type === TokenType.OrderedListItem) {
        // Find inline code
        this.findInlineCode(token);
        // Find bold/italic
        this.findEmphasis(token);
        // Find links
        this.findLinks(token);
      }
    }
  }

  private findInlineCode(token: Token): void {
    const regex = /`([^`]+)`/g;
    let match;
    while ((match = regex.exec(token.text)) !== null) {
      this.tokens.push({
        type: TokenType.InlineCode,
        start: token.start + match.index,
        end: token.start + match.index + match[0].length,
        text: match[0],
      });
    }
  }

  private findEmphasis(token: Token): void {
    // Bold: **text** or __text__
    const boldRegex = /(\*\*|__)([^*_]+)\1/g;
    let match;
    while ((match = boldRegex.exec(token.text)) !== null) {
      this.tokens.push({
        type: TokenType.Bold,
        start: token.start + match.index,
        end: token.start + match.index + match[0].length,
        text: match[0],
      });
    }

    // Italic: *text* or _text_
    const italicRegex = /(\*|_)([^*_]+)\1/g;
    while ((match = italicRegex.exec(token.text)) !== null) {
      // Skip if it's part of bold
      const isBold = this.tokens.some(t =>
        t.type === TokenType.Bold &&
        t.start <= token.start + match.index &&
        t.end >= token.start + match.index + match[0].length
      );
      if (!isBold) {
        this.tokens.push({
          type: TokenType.Italic,
          start: token.start + match.index,
          end: token.start + match.index + match[0].length,
          text: match[0],
        });
      }
    }

    // Strikethrough: ~~text~~
    const strikeRegex = /~~([^~]+)~~/g;
    while ((match = strikeRegex.exec(token.text)) !== null) {
      this.tokens.push({
        type: TokenType.Strikethrough,
        start: token.start + match.index,
        end: token.start + match.index + match[0].length,
        text: match[0],
      });
    }
  }

  private findLinks(token: Token): void {
    // Links: [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(token.text)) !== null) {
      const fullStart = token.start + match.index;
      const textStart = fullStart + 1; // After [
      const textEnd = textStart + match[1].length;
      const urlStart = textEnd + 2; // After ](
      const urlEnd = urlStart + match[2].length;

      this.tokens.push({
        type: TokenType.Link,
        start: fullStart,
        end: fullStart + match[0].length,
        text: match[0],
      });

      this.tokens.push({
        type: TokenType.LinkText,
        start: textStart,
        end: textEnd,
        text: match[1],
      });

      this.tokens.push({
        type: TokenType.LinkUrl,
        start: urlStart,
        end: urlEnd,
        text: match[2],
      });
    }
  }
}

// Apply styling overlays based on parsed tokens
function applyMarkdownStyling(bufferId: number, tokens: Token[]): void {
  // Clear existing markdown overlays
  editor.clearNamespace(bufferId, "md");

  for (const token of tokens) {
    let color: [number, number, number] | null = null;
    let underline = false;
    let overlayId = "md";

    switch (token.type) {
      case TokenType.Header1:
      case TokenType.Header2:
      case TokenType.Header3:
      case TokenType.Header4:
      case TokenType.Header5:
      case TokenType.Header6:
        color = COLORS.header;
        underline = true;
        break;

      case TokenType.InlineCode:
        color = COLORS.code;
        break;

      case TokenType.CodeBlockFence:
        color = COLORS.fence;
        break;

      case TokenType.CodeBlockContent:
        color = COLORS.codeBlock;
        break;

      case TokenType.BlockQuote:
        color = COLORS.quote;
        break;

      case TokenType.Bold:
        // Style bold markers (** or __) subdued, content bold
        const boldMatch = token.text.match(/^(\*\*|__)(.*)(\*\*|__)$/);
        if (boldMatch) {
          const markerLen = boldMatch[1].length;
          // Subdued markers
          editor.addOverlay(bufferId, "md",
            token.start, token.start + markerLen,
            COLORS.boldMarker[0], COLORS.boldMarker[1], COLORS.boldMarker[2], false, false, false);
          editor.addOverlay(bufferId, "md",
            token.end - markerLen, token.end,
            COLORS.boldMarker[0], COLORS.boldMarker[1], COLORS.boldMarker[2], false, false, false);
          // Bold content with bold=true
          editor.addOverlay(bufferId, "md",
            token.start + markerLen, token.end - markerLen,
            COLORS.bold[0], COLORS.bold[1], COLORS.bold[2], false, true, false);
        } else {
          color = COLORS.bold;
        }
        break;

      case TokenType.Italic:
        // Style italic markers (* or _) subdued, content italic
        const italicMatch = token.text.match(/^(\*|_)(.*)(\*|_)$/);
        if (italicMatch) {
          const markerLen = 1;
          // Subdued markers
          editor.addOverlay(bufferId, "md",
            token.start, token.start + markerLen,
            COLORS.italicMarker[0], COLORS.italicMarker[1], COLORS.italicMarker[2], false, false, false);
          editor.addOverlay(bufferId, "md",
            token.end - markerLen, token.end,
            COLORS.italicMarker[0], COLORS.italicMarker[1], COLORS.italicMarker[2], false, false, false);
          // Italic content with italic=true
          editor.addOverlay(bufferId, "md",
            token.start + markerLen, token.end - markerLen,
            COLORS.italic[0], COLORS.italic[1], COLORS.italic[2], false, false, true);
        } else {
          color = COLORS.italic;
        }
        break;

      case TokenType.LinkText:
        color = COLORS.link;
        underline = true;
        break;

      case TokenType.LinkUrl:
        color = COLORS.linkUrl;
        break;

      case TokenType.ListItem:
      case TokenType.OrderedListItem:
        // Style just the bullet/number
        const bulletMatch = token.text.match(/^(\s*)([-*+]|\d+\.)/);
        if (bulletMatch) {
          const bulletEnd = token.start + bulletMatch[0].length;
          editor.addOverlay(
            bufferId,
            "md",
            token.start,
            bulletEnd,
            COLORS.listBullet[0],
            COLORS.listBullet[1],
            COLORS.listBullet[2],
            false
          );
        }
        break;

      case TokenType.Checkbox:
        // Style checkbox and bullet
        const checkboxMatch = token.text.match(/^(\s*[-*+]\s+\[[ x]\])/);
        if (checkboxMatch) {
          const checkboxEnd = token.start + checkboxMatch[0].length;
          editor.addOverlay(
            bufferId,
            "md",
            token.start,
            checkboxEnd,
            COLORS.checkbox[0],
            COLORS.checkbox[1],
            COLORS.checkbox[2],
            false
          );
        }
        break;
    }

    if (color) {
      editor.addOverlay(
        bufferId,
        overlayId,
        token.start,
        token.end,
        color[0],
        color[1],
        color[2],
        underline
      );
    }
  }
}

// Highlight a single line for markdown (used with lines_changed event)
function highlightLine(
  bufferId: number,
  lineNumber: number,
  byteStart: number,
  content: string
): void {
  const trimmed = content.trim();
  if (trimmed.length === 0) return;

  // Headers
  const headerMatch = trimmed.match(/^(#{1,6})\s/);
  if (headerMatch) {
    editor.addOverlay(
      bufferId,
      "md",
      byteStart,
      byteStart + content.length,
      COLORS.header[0], COLORS.header[1], COLORS.header[2],
      false, true, false  // bold
    );
    return;
  }

  // Code block fences
  if (trimmed.startsWith('```')) {
    editor.addOverlay(
      bufferId,
      "md",
      byteStart,
      byteStart + content.length,
      COLORS.fence[0], COLORS.fence[1], COLORS.fence[2],
      false
    );
    return;
  }

  // Block quotes
  if (trimmed.startsWith('>')) {
    editor.addOverlay(
      bufferId,
      "md",
      byteStart,
      byteStart + content.length,
      COLORS.quote[0], COLORS.quote[1], COLORS.quote[2],
      false
    );
    return;
  }

  // Horizontal rules
  if (trimmed.match(/^[-*_]{3,}$/)) {
    editor.addOverlay(
      bufferId,
      "md",
      byteStart,
      byteStart + content.length,
      COLORS.quote[0], COLORS.quote[1], COLORS.quote[2],
      false
    );
    return;
  }

  // List items (unordered)
  const listMatch = content.match(/^(\s*)([-*+])\s/);
  if (listMatch) {
    const bulletStart = byteStart + listMatch[1].length;
    const bulletEnd = bulletStart + 1;
    editor.addOverlay(
      bufferId,
      "md",
      bulletStart,
      bulletEnd,
      COLORS.listBullet[0], COLORS.listBullet[1], COLORS.listBullet[2],
      false
    );
  }

  // Ordered list items
  const orderedMatch = content.match(/^(\s*)(\d+\.)\s/);
  if (orderedMatch) {
    const numStart = byteStart + orderedMatch[1].length;
    const numEnd = numStart + orderedMatch[2].length;
    editor.addOverlay(
      bufferId,
      "md",
      numStart,
      numEnd,
      COLORS.listBullet[0], COLORS.listBullet[1], COLORS.listBullet[2],
      false
    );
  }

  // Checkboxes
  const checkMatch = content.match(/^(\s*[-*+]\s+)(\[[ x]\])/);
  if (checkMatch) {
    const checkStart = byteStart + checkMatch[1].length;
    const checkEnd = checkStart + checkMatch[2].length;
    editor.addOverlay(
      bufferId,
      "md",
      checkStart,
      checkEnd,
      COLORS.checkbox[0], COLORS.checkbox[1], COLORS.checkbox[2],
      false
    );
  }

  // Inline elements

  // Inline code: `code`
  const codeRegex = /`([^`]+)`/g;
  let match;
  while ((match = codeRegex.exec(content)) !== null) {
    editor.addOverlay(
      bufferId,
      "md",
      byteStart + match.index,
      byteStart + match.index + match[0].length,
      COLORS.code[0], COLORS.code[1], COLORS.code[2],
      false
    );
  }

  // Bold: **text** or __text__
  const boldRegex = /(\*\*|__)([^*_]+)\1/g;
  while ((match = boldRegex.exec(content)) !== null) {
    const markerLen = match[1].length;
    const fullStart = byteStart + match.index;
    const fullEnd = fullStart + match[0].length;
    // Subdued markers
    editor.addOverlay(
      bufferId,
      "md",
      fullStart, fullStart + markerLen,
      COLORS.boldMarker[0], COLORS.boldMarker[1], COLORS.boldMarker[2],
      false, false, false
    );
    editor.addOverlay(
      bufferId,
      "md",
      fullEnd - markerLen, fullEnd,
      COLORS.boldMarker[0], COLORS.boldMarker[1], COLORS.boldMarker[2],
      false, false, false
    );
    // Bold content
    editor.addOverlay(
      bufferId,
      "md",
      fullStart + markerLen, fullEnd - markerLen,
      COLORS.bold[0], COLORS.bold[1], COLORS.bold[2],
      false, true, false
    );
  }

  // Italic: *text* or _text_ (but not inside bold)
  const italicRegex = /(?<!\*|\w)(\*|_)(?!\*|_)([^*_\n]+)(?<!\*|_)\1(?!\*|\w)/g;
  while ((match = italicRegex.exec(content)) !== null) {
    const fullStart = byteStart + match.index;
    const fullEnd = fullStart + match[0].length;
    // Subdued markers
    editor.addOverlay(
      bufferId,
      "md",
      fullStart, fullStart + 1,
      COLORS.italicMarker[0], COLORS.italicMarker[1], COLORS.italicMarker[2],
      false, false, false
    );
    editor.addOverlay(
      bufferId,
      "md",
      fullEnd - 1, fullEnd,
      COLORS.italicMarker[0], COLORS.italicMarker[1], COLORS.italicMarker[2],
      false, false, false
    );
    // Italic content
    editor.addOverlay(
      bufferId,
      "md",
      fullStart + 1, fullEnd - 1,
      COLORS.italic[0], COLORS.italic[1], COLORS.italic[2],
      false, false, true
    );
  }

  // Links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = linkRegex.exec(content)) !== null) {
    const fullStart = byteStart + match.index;
    const textStart = fullStart + 1;
    const textEnd = textStart + match[1].length;
    const urlStart = textEnd + 2;
    const urlEnd = urlStart + match[2].length;

    // Link text (underlined)
    editor.addOverlay(
      bufferId,
      "md",
      textStart, textEnd,
      COLORS.link[0], COLORS.link[1], COLORS.link[2],
      true  // underline
    );
    // Link URL (subdued)
    editor.addOverlay(
      bufferId,
      "md",
      urlStart, urlEnd,
      COLORS.linkUrl[0], COLORS.linkUrl[1], COLORS.linkUrl[2],
      false
    );
  }
}

// Check if a file is a markdown file
function isMarkdownFile(path: string): boolean {
  return path.endsWith('.md') || path.endsWith('.markdown');
}

// Process a buffer in compose mode - just enables compose mode
// The actual transform happens via view_transform_request hook
function processBuffer(bufferId: number, _splitId?: number): void {
  if (!composeBuffers.has(bufferId)) return;

  const info = editor.getBufferInfo(bufferId);
  if (!info || !isMarkdownFile(info.path)) return;

  editor.debug(`processBuffer: enabling compose mode for ${info.path}, buffer_id=${bufferId}`);

  // Trigger a refresh to get the view_transform_request hook called
  editor.refreshLines(bufferId);
}

// Enable highlighting for a markdown buffer (auto on file open)
function enableHighlighting(bufferId: number): void {
  const info = editor.getBufferInfo(bufferId);
  if (!info || !isMarkdownFile(info.path)) return;

  if (!highlightingBuffers.has(bufferId)) {
    highlightingBuffers.add(bufferId);
    // Trigger a refresh so lines_changed will process visible lines
    editor.refreshLines(bufferId);
    editor.debug(`Markdown highlighting enabled for buffer ${bufferId}`);
  }
}

// Enable full compose mode for a buffer (explicit toggle)
function enableMarkdownCompose(bufferId: number): void {
  const info = editor.getBufferInfo(bufferId);
  if (!info || !isMarkdownFile(info.path)) return;

  if (!composeBuffers.has(bufferId)) {
    composeBuffers.add(bufferId);
    highlightingBuffers.add(bufferId);  // Also ensure highlighting is on

    // Hide line numbers in compose mode
    editor.setLineNumbers(bufferId, false);

    processBuffer(bufferId);
    editor.debug(`Markdown compose enabled for buffer ${bufferId}`);
  }
}

// Disable compose mode for a buffer (but keep highlighting)
function disableMarkdownCompose(bufferId: number): void {
  if (composeBuffers.has(bufferId)) {
    composeBuffers.delete(bufferId);

    // Re-enable line numbers
    editor.setLineNumbers(bufferId, true);

    // Clear view transform to return to normal rendering
    editor.clearViewTransform(bufferId);

    // Keep highlighting on, just clear the view transform
    editor.refreshLines(bufferId);
    editor.debug(`Markdown compose disabled for buffer ${bufferId}`);
  }
}

// Toggle markdown compose mode for current buffer
globalThis.markdownToggleCompose = function(): void {
  const bufferId = editor.getActiveBufferId();
  const info = editor.getBufferInfo(bufferId);

  if (!info) return;

  // Only work with markdown files
  if (!info.path.endsWith('.md') && !info.path.endsWith('.markdown')) {
    editor.setStatus("Not a Markdown file");
    return;
  }

  if (composeBuffers.has(bufferId)) {
    disableMarkdownCompose(bufferId);
    editor.setStatus("Markdown Compose: OFF");
  } else {
    enableMarkdownCompose(bufferId);
    // Trigger a re-render to apply the transform
    editor.refreshLines(bufferId);
    editor.setStatus("Markdown Compose: ON (soft breaks, styled)");
  }
};

/**
 * Extract text content from incoming tokens
 * Reconstructs the source text from ViewTokenWire tokens
 */
function extractTextFromTokens(tokens: ViewTokenWire[]): string {
  let text = '';
  for (const token of tokens) {
    const kind = token.kind;
    if (kind === "Newline") {
      text += '\n';
    } else if (kind === "Space") {
      text += ' ';
    } else if (kind === "Break") {
      // Soft break, ignore for text extraction
    } else if (typeof kind === 'object' && 'Text' in kind) {
      text += kind.Text;
    }
  }
  return text;
}

/**
 * Transform tokens for markdown compose mode with hanging indents
 *
 * Strategy: Parse the source text to identify block structure, then walk through
 * incoming tokens and emit transformed tokens with soft wraps and hanging indents.
 */
function transformMarkdownTokens(
  inputTokens: ViewTokenWire[],
  width: number,
  viewportStart: number
): ViewTokenWire[] {
  // First, extract text to understand block structure
  const text = extractTextFromTokens(inputTokens);
  const blocks = parseMarkdownBlocks(text);

  // Build a map of source_offset -> block info for quick lookup
  // Block byte positions are 0-based within extracted text
  // Source offsets are actual buffer positions (viewportStart + position_in_text)
  const offsetToBlock = new Map<number, ParsedBlock>();
  for (const block of blocks) {
    // Map byte positions that fall within this block to the block
    // contentStartByte and endByte are positions within extracted text (0-based)
    // source_offset = viewportStart + position_in_extracted_text
    for (let textPos = block.startByte; textPos < block.endByte; textPos++) {
      const sourceOffset = viewportStart + textPos;
      offsetToBlock.set(sourceOffset, block);
    }
  }

  const outputTokens: ViewTokenWire[] = [];
  let column = 0;  // Current column position
  let currentBlock: ParsedBlock | null = null;
  let lineStarted = false;  // Have we output anything on current line?

  for (let i = 0; i < inputTokens.length; i++) {
    const token = inputTokens[i];
    const kind = token.kind;
    const sourceOffset = token.source_offset;

    // Track which block we're in based on source offset
    if (sourceOffset !== null) {
      const block = offsetToBlock.get(sourceOffset);
      if (block) {
        currentBlock = block;
      }
    }

    // Get hanging indent for current block (default 0)
    const hangingIndent = currentBlock?.hangingIndent ?? 0;

    // Handle different token types
    if (kind === "Newline") {
      // Real newlines pass through - they end a block
      outputTokens.push(token);
      column = 0;
      lineStarted = false;
      currentBlock = null;  // Reset at line boundary
    } else if (kind === "Space") {
      // Space handling - potentially wrap before space + next word
      if (!lineStarted) {
        // Leading space on a line - preserve it
        outputTokens.push(token);
        column++;
        lineStarted = true;
      } else {
        // Mid-line space - look ahead to see if we need to wrap
        // Find next non-space token to check word length
        let nextWordLen = 0;
        for (let j = i + 1; j < inputTokens.length; j++) {
          const nextKind = inputTokens[j].kind;
          if (nextKind === "Space" || nextKind === "Newline" || nextKind === "Break") {
            break;
          }
          if (typeof nextKind === 'object' && 'Text' in nextKind) {
            nextWordLen += nextKind.Text.length;
          }
        }

        // Check if space + next word would exceed width
        if (column + 1 + nextWordLen > width && nextWordLen > 0) {
          // Wrap: emit soft newline + hanging indent instead of space
          outputTokens.push({ source_offset: null, kind: "Newline" });
          for (let j = 0; j < hangingIndent; j++) {
            outputTokens.push({ source_offset: null, kind: "Space" });
          }
          column = hangingIndent;
          // Don't emit the space - we wrapped instead
        } else {
          // No wrap needed - emit the space normally
          outputTokens.push(token);
          column++;
        }
      }
    } else if (kind === "Break") {
      // Existing soft breaks - we're replacing wrapping logic, so skip these
      // and handle wrapping ourselves
    } else if (typeof kind === 'object' && 'Text' in kind) {
      const text = kind.Text;

      if (!lineStarted) {
        lineStarted = true;
      }

      // Check if this word alone would exceed width (need to wrap)
      if (column > hangingIndent && column + text.length > width) {
        // Wrap before this word
        outputTokens.push({ source_offset: null, kind: "Newline" });
        for (let j = 0; j < hangingIndent; j++) {
          outputTokens.push({ source_offset: null, kind: "Space" });
        }
        column = hangingIndent;
      }

      // Emit the text token
      outputTokens.push(token);
      column += text.length;
    } else {
      // Unknown token type - pass through
      outputTokens.push(token);
    }
  }

  return outputTokens;
}

// Handle view transform request - receives tokens from core for transformation
// Only applies transforms when in compose mode (not just highlighting)
globalThis.onMarkdownViewTransform = function(data: {
  buffer_id: number;
  split_id: number;
  viewport_start: number;
  viewport_end: number;
  tokens: ViewTokenWire[];
}): void {
  // Only transform when in compose mode (view transforms change line wrapping etc)
  if (!composeBuffers.has(data.buffer_id)) return;

  const info = editor.getBufferInfo(data.buffer_id);
  if (!info || !isMarkdownFile(info.path)) return;

  editor.debug(`onMarkdownViewTransform: buffer=${data.buffer_id}, split=${data.split_id}, tokens=${data.tokens.length}`);

  // Transform the incoming tokens with markdown-aware wrapping
  const transformedTokens = transformMarkdownTokens(
    data.tokens,
    config.composeWidth,
    data.viewport_start
  );

  // Extract text for overlay styling
  const text = extractTextFromTokens(data.tokens);
  const parser = new MarkdownParser(text);
  const mdTokens = parser.parse();

  // Adjust token offsets for viewport
  for (const token of mdTokens) {
    token.start += data.viewport_start;
    token.end += data.viewport_start;
  }
  applyMarkdownStyling(data.buffer_id, mdTokens);

  // Submit the transformed tokens - keep compose_width for margins/centering
  const layoutHints: LayoutHints = {
    compose_width: config.composeWidth,
    column_guides: null,
  };

  editor.submitViewTransform(
    data.buffer_id,
    data.split_id,
    data.viewport_start,
    data.viewport_end,
    transformedTokens,
    layoutHints
  );
};

// Handle render_start - enable highlighting for markdown files
globalThis.onMarkdownRenderStart = function(data: { buffer_id: number }): void {
  // Auto-enable highlighting for markdown files on first render
  if (!highlightingBuffers.has(data.buffer_id)) {
    const info = editor.getBufferInfo(data.buffer_id);
    if (info && isMarkdownFile(info.path)) {
      highlightingBuffers.add(data.buffer_id);
      editor.debug(`Markdown highlighting auto-enabled for buffer ${data.buffer_id}`);
    } else {
      return;
    }
  }
  // Note: Don't clear overlays here - the after-insert/after-delete handlers
  // already clear affected ranges via clearOverlaysInRange(). Clearing all
  // overlays here would cause flicker since lines_changed hasn't fired yet.
};

// Handle lines_changed - process visible lines incrementally
globalThis.onMarkdownLinesChanged = function(data: {
  buffer_id: number;
  lines: Array<{
    line_number: number;
    byte_start: number;
    byte_end: number;
    content: string;
  }>;
}): void {
  // Auto-enable highlighting for markdown files
  if (!highlightingBuffers.has(data.buffer_id)) {
    const info = editor.getBufferInfo(data.buffer_id);
    if (info && isMarkdownFile(info.path)) {
      highlightingBuffers.add(data.buffer_id);
    } else {
      return;
    }
  }

  // Process all changed lines
  for (const line of data.lines) {
    highlightLine(data.buffer_id, line.line_number, line.byte_start, line.content);
  }
};

// Handle buffer activation - auto-enable highlighting for markdown files
globalThis.onMarkdownBufferActivated = function(data: { buffer_id: number }): void {
  enableHighlighting(data.buffer_id);
};

// Handle content changes - clear affected overlays for efficient updates
globalThis.onMarkdownAfterInsert = function(data: {
  buffer_id: number;
  position: number;
  text: string;
  affected_start: number;
  affected_end: number;
}): void {
  if (!highlightingBuffers.has(data.buffer_id)) return;

  // Clear only overlays in the affected byte range
  // These overlays may now span incorrect content after the insertion
  // The affected lines will be re-processed via lines_changed with correct content
  editor.clearOverlaysInRange(data.buffer_id, data.affected_start, data.affected_end);
};

globalThis.onMarkdownAfterDelete = function(data: {
  buffer_id: number;
  start: number;
  end: number;
  deleted_text: string;
  affected_start: number;
  deleted_len: number;
}): void {
  if (!highlightingBuffers.has(data.buffer_id)) return;

  // Clear overlays that overlapped with the deleted range
  // Overlays entirely within the deleted range are already gone (their markers were deleted)
  // But overlays spanning the deletion boundary may now be incorrect
  // Use a slightly expanded range to catch boundary cases
  const clearStart = data.affected_start > 0 ? data.affected_start - 1 : 0;
  const clearEnd = data.affected_start + data.deleted_len + 1;
  editor.clearOverlaysInRange(data.buffer_id, clearStart, clearEnd);
};

// Handle buffer close events
globalThis.onMarkdownBufferClosed = function(data: { buffer_id: number }): void {
  highlightingBuffers.delete(data.buffer_id);
  composeBuffers.delete(data.buffer_id);
  dirtyBuffers.delete(data.buffer_id);
};

// Register hooks
editor.on("view_transform_request", "onMarkdownViewTransform");
editor.on("render_start", "onMarkdownRenderStart");
editor.on("lines_changed", "onMarkdownLinesChanged");
editor.on("buffer_activated", "onMarkdownBufferActivated");
editor.on("after-insert", "onMarkdownAfterInsert");
editor.on("after-delete", "onMarkdownAfterDelete");
editor.on("buffer_closed", "onMarkdownBufferClosed");
editor.on("prompt_confirmed", "onMarkdownComposeWidthConfirmed");

// Set compose width command - starts interactive prompt
globalThis.markdownSetComposeWidth = function(): void {
  editor.startPrompt("Compose width: ", "markdown-compose-width");
  editor.setPromptSuggestions([
    { text: "60", description: "Narrow - good for side panels" },
    { text: "72", description: "Classic - traditional terminal width" },
    { text: "80", description: "Standard - default width" },
    { text: "100", description: "Wide - more content per line" },
  ]);
};

// Handle compose width prompt confirmation
globalThis.onMarkdownComposeWidthConfirmed = function(args: {
  prompt_type: string;
  text: string;
}): void {
  if (args.prompt_type !== "markdown-compose-width") return;

  const width = parseInt(args.text, 10);
  if (!isNaN(width) && width > 20 && width < 300) {
    config.composeWidth = width;
    editor.setStatus(`Markdown compose width set to ${width}`);

    // Re-process active buffer if in compose mode
    const bufferId = editor.getActiveBufferId();
    if (composeBuffers.has(bufferId)) {
      editor.refreshLines(bufferId);  // Trigger re-transform
    }
  } else {
    editor.setStatus("Invalid width - must be between 20 and 300");
  }
};

// Register commands
editor.registerCommand(
  "Markdown: Toggle Compose",
  "Toggle beautiful Markdown rendering (soft breaks, syntax highlighting)",
  "markdownToggleCompose",
  "normal"
);

editor.registerCommand(
  "Markdown: Set Compose Width",
  "Set the width for compose mode wrapping and margins",
  "markdownSetComposeWidth",
  "normal"
);

// Initialization
editor.debug("Markdown Compose plugin loaded - use 'Markdown: Toggle Compose' command");
editor.setStatus("Markdown plugin ready");
