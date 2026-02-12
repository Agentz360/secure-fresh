// Blog showcase tests - individual feature demos for blog posts
//
// Each test generates a separate animated GIF for one feature.
// Two blog posts: "editing" (text editing features) and "productivity" (broader features).
//
// Usage:
//   cargo test --package fresh-editor --test e2e_tests blog_showcase_ -- --ignored --nocapture
//   # Then for each generated showcase:
//   scripts/frames-to-gif.sh docs/blog/editing/multi-cursor
//   scripts/frames-to-gif.sh docs/blog/editing/search-replace
//   # ... etc

use crate::common::blog_showcase::BlogShowcase;
use crate::common::harness::EditorTestHarness;
use crossterm::event::{KeyCode, KeyModifiers};
use std::fs;

// =========================================================================
// Helpers
// =========================================================================

fn snap(h: &mut EditorTestHarness, s: &mut BlogShowcase, key: Option<&str>, ms: u32) {
    h.render().unwrap();
    let c = h.screen_cursor_position();
    s.capture_frame(h.buffer(), c, key, None, ms).unwrap();
}

fn snap_mouse(
    h: &mut EditorTestHarness,
    s: &mut BlogShowcase,
    key: Option<&str>,
    mouse: (u16, u16),
    ms: u32,
) {
    h.render().unwrap();
    let c = h.screen_cursor_position();
    s.capture_frame(h.buffer(), c, key, Some(mouse), ms)
        .unwrap();
}

fn hold(h: &mut EditorTestHarness, s: &mut BlogShowcase, count: usize, ms: u32) {
    h.render().unwrap();
    let c = h.screen_cursor_position();
    s.hold_frames(h.buffer(), c, None, None, count, ms).unwrap();
}

fn hold_key(h: &mut EditorTestHarness, s: &mut BlogShowcase, key: &str, count: usize, ms: u32) {
    h.render().unwrap();
    let c = h.screen_cursor_position();
    s.hold_frames(h.buffer(), c, Some(key), None, count, ms)
        .unwrap();
}

/// Create a standard Rust project for demos
fn create_demo_project(project_dir: &std::path::Path) {
    fs::create_dir_all(project_dir.join("src")).unwrap();
    fs::write(
        project_dir.join("src/main.rs"),
        r#"use std::collections::HashMap;

fn main() {
    let config = load_config("settings.json");
    let items = vec!["alpha", "beta", "gamma", "delta"];

    for item in &items {
        process_item(item, &config);
    }

    let results: HashMap<&str, i32> = items
        .iter()
        .enumerate()
        .map(|(i, item)| (*item, i as i32))
        .collect();

    println!("Processed {} items", results.len());
}

fn load_config(path: &str) -> HashMap<String, String> {
    println!("Loading config from {}", path);
    HashMap::new()
}

fn process_item(item: &str, _config: &HashMap<String, String>) {
    let value = item.to_uppercase();
    let length = value.len();
    println!("[{}] {} (len: {})", item, value, length);
}
"#,
    )
    .unwrap();

    fs::write(
        project_dir.join("src/utils.rs"),
        r#"pub fn format_duration(secs: u64) -> String {
    let hours = secs / 3600;
    let mins = (secs % 3600) / 60;
    let secs = secs % 60;
    format!("{}h {}m {}s", hours, mins, secs)
}

pub fn truncate(s: &str, max_len: usize) -> &str {
    if s.len() > max_len { &s[..max_len] } else { s }
}
"#,
    )
    .unwrap();

    fs::write(
        project_dir.join("README.md"),
        "# My Project\n\nA demo project.\n",
    )
    .unwrap();
    fs::write(
        project_dir.join("Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .unwrap();
}

// =========================================================================
// Blog Post 1: Editing Features
// =========================================================================

/// Multi-cursor editing: Ctrl+W to select word, Ctrl+D to add next occurrence
#[test]
#[ignore]
fn blog_showcase_editing_multi_cursor() {
    let mut h = EditorTestHarness::with_temp_project(100, 30).unwrap();
    let pd = h.project_dir().unwrap();
    create_demo_project(&pd);
    h.open_file(&pd.join("src/main.rs")).unwrap();

    let mut s = BlogShowcase::new(
        "editing/multi-cursor",
        "Multi-Cursor Editing",
        "Select multiple occurrences and edit them all at once.",
    );

    hold(&mut h, &mut s, 5, 100);

    // Navigate to "item" on line 7
    for _ in 0..6 {
        h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
    }
    h.send_key(KeyCode::Home, KeyModifiers::NONE).unwrap();
    for _ in 0..2 {
        h.send_key(KeyCode::Right, KeyModifiers::CONTROL).unwrap();
    }
    h.render().unwrap();
    snap(&mut h, &mut s, None, 200);

    // Select word
    h.send_key(KeyCode::Char('w'), KeyModifiers::CONTROL)
        .unwrap();
    snap(&mut h, &mut s, Some("Ctrl+W"), 150);
    hold_key(&mut h, &mut s, "Ctrl+W", 2, 100);

    // Add 3 more occurrences
    for _ in 0..3 {
        h.send_key(KeyCode::Char('d'), KeyModifiers::CONTROL)
            .unwrap();
        snap(&mut h, &mut s, Some("Ctrl+D"), 120);
        hold(&mut h, &mut s, 1, 80);
    }
    hold(&mut h, &mut s, 4, 100);

    // Type replacement
    for ch in "entry".chars() {
        h.send_key(KeyCode::Char(ch), KeyModifiers::NONE).unwrap();
        snap(&mut h, &mut s, Some(&ch.to_string()), 50);
    }
    hold(&mut h, &mut s, 6, 100);

    s.finalize().unwrap();
}

/// Search & Replace: open via command palette and replace text
#[test]
#[ignore]
fn blog_showcase_editing_search_replace() {
    let mut h = EditorTestHarness::new(80, 24).unwrap();

    h.type_text("fn main() {\n    let item = get_item();\n    process_item(&item);\n    println!(\"item: {}\", item);\n}").unwrap();
    h.send_key(KeyCode::Home, KeyModifiers::CONTROL).unwrap();

    let mut s = BlogShowcase::new(
        "editing/search-replace",
        "Search & Replace",
        "Find and replace with incremental highlighting.",
    );

    hold(&mut h, &mut s, 4, 100);

    // Open command palette
    h.send_key(KeyCode::Char('p'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Ctrl+P"), 120);

    // Type "Replace" to find the command
    for ch in "Replace".chars() {
        h.send_key(KeyCode::Char(ch), KeyModifiers::NONE).unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some(&ch.to_string()), 50);
    }
    hold(&mut h, &mut s, 2, 100);

    // Execute the Replace command
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);
    hold(&mut h, &mut s, 3, 100);

    // Type search term
    for ch in "item".chars() {
        h.send_key(KeyCode::Char(ch), KeyModifiers::NONE).unwrap();
        snap(&mut h, &mut s, Some(&ch.to_string()), 70);
    }
    hold(&mut h, &mut s, 3, 100);

    // Enter to confirm search and move to replace field
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    snap(&mut h, &mut s, Some("Enter"), 120);

    // Type replacement
    for ch in "element".chars() {
        h.send_key(KeyCode::Char(ch), KeyModifiers::NONE).unwrap();
        snap(&mut h, &mut s, Some(&ch.to_string()), 70);
    }
    hold(&mut h, &mut s, 3, 100);

    // Enter to confirm replacement
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);
    hold(&mut h, &mut s, 5, 100);

    s.finalize().unwrap();
}

/// Line editing: move lines up/down with Alt+Arrow
#[test]
#[ignore]
fn blog_showcase_editing_line_move() {
    let mut h = EditorTestHarness::with_temp_project(100, 30).unwrap();
    let pd = h.project_dir().unwrap();
    create_demo_project(&pd);
    h.open_file(&pd.join("src/main.rs")).unwrap();

    let mut s = BlogShowcase::new(
        "editing/line-move",
        "Move Lines",
        "Move lines up and down with Alt+Arrow keys.",
    );

    // Go to line 5 (the items vec)
    h.send_key(KeyCode::Home, KeyModifiers::CONTROL).unwrap();
    for _ in 0..4 {
        h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
    }
    h.render().unwrap();
    hold(&mut h, &mut s, 4, 100);

    // Move line down twice
    h.send_key(KeyCode::Down, KeyModifiers::ALT).unwrap();
    snap(&mut h, &mut s, Some("Alt+↓"), 180);
    h.send_key(KeyCode::Down, KeyModifiers::ALT).unwrap();
    snap(&mut h, &mut s, Some("Alt+↓"), 180);
    hold(&mut h, &mut s, 3, 100);

    // Move back up twice
    h.send_key(KeyCode::Up, KeyModifiers::ALT).unwrap();
    snap(&mut h, &mut s, Some("Alt+↑"), 180);
    h.send_key(KeyCode::Up, KeyModifiers::ALT).unwrap();
    snap(&mut h, &mut s, Some("Alt+↑"), 180);
    hold(&mut h, &mut s, 5, 100);

    s.finalize().unwrap();
}

/// Block selection: Alt+Shift+Arrow for rectangular selection
#[test]
#[ignore]
fn blog_showcase_editing_block_selection() {
    let mut h = EditorTestHarness::with_temp_project(100, 30).unwrap();
    let pd = h.project_dir().unwrap();

    // Create a file with aligned columns
    fs::create_dir_all(pd.join("src")).unwrap();
    fs::write(
        pd.join("data.txt"),
        "name       age  city\nalice      30   london\nbob        25   paris\ncharlie    35   tokyo\ndiana      28   berlin\neve        22   rome\nfrank      40   madrid\n",
    )
    .unwrap();
    h.open_file(&pd.join("data.txt")).unwrap();

    let mut s = BlogShowcase::new(
        "editing/block-selection",
        "Block Selection",
        "Rectangular column editing with Alt+Shift+Arrow.",
    );

    hold(&mut h, &mut s, 4, 100);

    // Position at start of "age" column (row 0, col 11)
    h.send_key(KeyCode::Home, KeyModifiers::NONE).unwrap();
    for _ in 0..11 {
        h.send_key(KeyCode::Right, KeyModifiers::NONE).unwrap();
    }
    h.render().unwrap();
    snap(&mut h, &mut s, None, 200);

    // Block select down 6 rows and right 3 chars
    for _ in 0..6 {
        h.send_key(KeyCode::Down, KeyModifiers::ALT | KeyModifiers::SHIFT)
            .unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some("Alt+Shift+↓"), 100);
    }
    for _ in 0..2 {
        h.send_key(KeyCode::Right, KeyModifiers::ALT | KeyModifiers::SHIFT)
            .unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some("Alt+Shift+→"), 100);
    }
    hold(&mut h, &mut s, 5, 100);

    // Escape
    h.send_key(KeyCode::Esc, KeyModifiers::NONE).unwrap();
    hold(&mut h, &mut s, 3, 100);

    s.finalize().unwrap();
}

/// Triple-click to select entire line
#[test]
#[ignore]
fn blog_showcase_editing_triple_click() {
    let mut h = EditorTestHarness::with_temp_project(100, 30).unwrap();
    let pd = h.project_dir().unwrap();
    create_demo_project(&pd);
    h.open_file(&pd.join("src/main.rs")).unwrap();

    let mut s = BlogShowcase::new(
        "editing/triple-click",
        "Triple-Click Selection",
        "Triple-click to select an entire line.",
    );

    hold(&mut h, &mut s, 4, 100);

    // Triple click on line 5 (row ~6 in terminal including menu+tab bar)
    let click_row = 6u16;
    let click_col = 15u16;

    // First click
    h.mouse_click(click_col, click_row).unwrap();
    snap_mouse(&mut h, &mut s, Some("Click"), (click_col, click_row), 120);

    // Second click (double-click selects word)
    h.mouse_click(click_col, click_row).unwrap();
    snap_mouse(
        &mut h,
        &mut s,
        Some("Double-click"),
        (click_col, click_row),
        120,
    );

    // Third click (triple-click selects line)
    h.mouse_click(click_col, click_row).unwrap();
    snap_mouse(
        &mut h,
        &mut s,
        Some("Triple-click"),
        (click_col, click_row),
        200,
    );
    hold(&mut h, &mut s, 5, 100);

    // Click elsewhere to deselect
    h.mouse_click(5, 10).unwrap();
    hold(&mut h, &mut s, 3, 100);

    s.finalize().unwrap();
}

// =========================================================================
// Blog Post 2: Productivity Features
// =========================================================================

/// Command Palette: Ctrl+P for unified file/command/buffer navigation
#[test]
#[ignore]
fn blog_showcase_productivity_command_palette() {
    let mut h = EditorTestHarness::with_temp_project(100, 30).unwrap();
    let pd = h.project_dir().unwrap();
    create_demo_project(&pd);
    h.open_file(&pd.join("src/main.rs")).unwrap();

    let mut s = BlogShowcase::new(
        "productivity/command-palette",
        "Command Palette",
        "Unified access to files, commands, buffers, and line navigation.",
    );

    hold(&mut h, &mut s, 4, 100);

    // Open palette
    h.send_key(KeyCode::Char('p'), KeyModifiers::CONTROL)
        .unwrap();
    snap(&mut h, &mut s, Some("Ctrl+P"), 200);
    hold(&mut h, &mut s, 2, 100);

    // Search for a command (Ctrl+P already starts in command mode with ">")
    for ch in "theme".chars() {
        h.send_key(KeyCode::Char(ch), KeyModifiers::NONE).unwrap();
        snap(&mut h, &mut s, Some(&ch.to_string()), 60);
    }
    hold(&mut h, &mut s, 4, 100);

    // Clear and try file mode
    // Escape and reopen
    h.send_key(KeyCode::Esc, KeyModifiers::NONE).unwrap();
    hold(&mut h, &mut s, 2, 100);

    h.send_key(KeyCode::Char('p'), KeyModifiers::CONTROL)
        .unwrap();
    snap(&mut h, &mut s, Some("Ctrl+P"), 150);

    // Type filename search
    for ch in "util".chars() {
        h.send_key(KeyCode::Char(ch), KeyModifiers::NONE).unwrap();
        snap(&mut h, &mut s, Some(&ch.to_string()), 60);
    }
    hold(&mut h, &mut s, 4, 100);

    h.send_key(KeyCode::Esc, KeyModifiers::NONE).unwrap();
    hold(&mut h, &mut s, 3, 100);

    s.finalize().unwrap();
}

/// Split View: horizontal and vertical splits with independent panes
#[test]
#[ignore]
fn blog_showcase_productivity_split_view() {
    let mut h = EditorTestHarness::with_temp_project(100, 30).unwrap();
    let pd = h.project_dir().unwrap();
    create_demo_project(&pd);
    h.open_file(&pd.join("src/main.rs")).unwrap();

    let mut s = BlogShowcase::new(
        "productivity/split-view",
        "Split View",
        "Side-by-side editing with independent panes.",
    );

    hold(&mut h, &mut s, 4, 100);

    // Create horizontal split
    h.send_key(KeyCode::Char('p'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    h.type_text("split horiz").unwrap();
    snap(&mut h, &mut s, Some("Ctrl+P"), 120);
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);
    hold(&mut h, &mut s, 2, 100);

    // Open different file in new split
    h.open_file(&pd.join("src/utils.rs")).unwrap();
    h.render().unwrap();
    hold(&mut h, &mut s, 4, 100);

    // Switch between splits
    h.send_key(KeyCode::Char('k'), KeyModifiers::CONTROL)
        .unwrap();
    snap(&mut h, &mut s, Some("Ctrl+K"), 200);
    hold(&mut h, &mut s, 3, 100);

    h.send_key(KeyCode::Char('k'), KeyModifiers::CONTROL)
        .unwrap();
    snap(&mut h, &mut s, Some("Ctrl+K"), 200);
    hold(&mut h, &mut s, 3, 100);

    // Close split
    h.send_key(KeyCode::Char('p'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    h.type_text("close split").unwrap();
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    hold(&mut h, &mut s, 4, 100);

    s.finalize().unwrap();
}

/// File Explorer: sidebar tree navigation
#[test]
#[ignore]
fn blog_showcase_productivity_file_explorer() {
    let mut h = EditorTestHarness::with_temp_project(100, 30).unwrap();
    let pd = h.project_dir().unwrap();
    create_demo_project(&pd);
    h.open_file(&pd.join("src/main.rs")).unwrap();

    let mut s = BlogShowcase::new(
        "productivity/file-explorer",
        "File Explorer",
        "Sidebar tree view with fuzzy search and git indicators.",
    );

    hold(&mut h, &mut s, 4, 100);

    // Open explorer
    h.send_key(KeyCode::Char('e'), KeyModifiers::CONTROL)
        .unwrap();
    snap(&mut h, &mut s, Some("Ctrl+E"), 200);
    hold(&mut h, &mut s, 2, 100);

    // Navigate down
    for _ in 0..3 {
        h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some("↓"), 100);
    }

    // Expand directory
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    snap(&mut h, &mut s, Some("Enter"), 150);
    hold(&mut h, &mut s, 2, 100);

    // Navigate into expanded dir
    h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
    snap(&mut h, &mut s, Some("↓"), 120);
    hold(&mut h, &mut s, 3, 100);

    // Open file
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);
    hold(&mut h, &mut s, 4, 100);

    // Toggle back to editor
    h.send_key(KeyCode::Char('e'), KeyModifiers::CONTROL)
        .unwrap();
    hold(&mut h, &mut s, 3, 100);

    s.finalize().unwrap();
}

/// Settings UI: graphical configuration editor
#[test]
#[ignore]
fn blog_showcase_productivity_settings() {
    let mut h = EditorTestHarness::with_temp_project(100, 30).unwrap();
    let pd = h.project_dir().unwrap();
    create_demo_project(&pd);
    h.open_file(&pd.join("src/main.rs")).unwrap();

    let mut s = BlogShowcase::new(
        "productivity/settings",
        "Settings UI",
        "Graphical editor for all configuration options.",
    );

    hold(&mut h, &mut s, 3, 100);

    // Open settings via command palette
    h.send_key(KeyCode::Char('p'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    h.type_text("settings").unwrap();
    snap(&mut h, &mut s, Some("Ctrl+P"), 120);
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);
    hold(&mut h, &mut s, 3, 100);

    // Navigate settings categories
    for _ in 0..3 {
        h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some("↓"), 100);
    }
    hold(&mut h, &mut s, 3, 100);

    // Navigate more
    for _ in 0..2 {
        h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some("↓"), 100);
    }
    hold(&mut h, &mut s, 4, 100);

    // Filter settings with /
    h.send_key(KeyCode::Char('/'), KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("/"), 150);

    for ch in "terminal bg".chars() {
        h.send_key(KeyCode::Char(ch), KeyModifiers::NONE).unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some(&ch.to_string()), 70);
    }
    hold(&mut h, &mut s, 5, 100);

    // Confirm filter
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);
    hold(&mut h, &mut s, 4, 100);

    // Close settings
    h.send_key(KeyCode::Esc, KeyModifiers::NONE).unwrap();
    hold(&mut h, &mut s, 3, 100);

    s.finalize().unwrap();
}

/// Keybinding Editor: full-featured modal for customizing key bindings
#[test]
#[ignore]
fn blog_showcase_productivity_keybinding_editor() {
    let mut h = EditorTestHarness::new(120, 35).unwrap();
    h.render().unwrap();

    let mut s = BlogShowcase::new(
        "productivity/keybinding-editor",
        "Keybinding Editor",
        "Search, add, edit, and delete key bindings with conflict detection.",
    );

    hold(&mut h, &mut s, 3, 100);

    // Open keybinding editor directly
    h.editor_mut().open_keybinding_editor();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Keybinding Editor"), 250);
    hold(&mut h, &mut s, 3, 100);

    // Navigate down through bindings
    for _ in 0..6 {
        h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some("↓"), 80);
    }
    hold(&mut h, &mut s, 3, 100);

    // Activate search with /
    h.send_key(KeyCode::Char('/'), KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("/"), 150);

    // Type search query
    for ch in "save".chars() {
        h.send_key(KeyCode::Char(ch), KeyModifiers::NONE).unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some(&ch.to_string()), 70);
    }
    hold(&mut h, &mut s, 4, 100);

    // Press Enter to confirm search
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    hold(&mut h, &mut s, 3, 100);

    // Close
    h.send_key(KeyCode::Esc, KeyModifiers::NONE).unwrap();
    hold(&mut h, &mut s, 3, 100);

    s.finalize().unwrap();
}

/// Integrated Terminal: open a terminal split inside the editor
#[test]
#[ignore]
fn blog_showcase_productivity_terminal() {
    use portable_pty::{native_pty_system, PtySize};

    // Check PTY availability
    if native_pty_system()
        .openpty(PtySize {
            rows: 1,
            cols: 1,
            pixel_width: 0,
            pixel_height: 0,
        })
        .is_err()
    {
        eprintln!("Skipping terminal showcase: PTY not available");
        return;
    }

    let mut h = EditorTestHarness::with_temp_project(100, 30).unwrap();
    let pd = h.project_dir().unwrap();
    create_demo_project(&pd);
    h.open_file(&pd.join("src/main.rs")).unwrap();

    let mut s = BlogShowcase::new(
        "productivity/terminal",
        "Integrated Terminal",
        "Split terminal with scrollback and session persistence.",
    );

    hold(&mut h, &mut s, 4, 100);

    // Open terminal via command palette
    h.send_key(KeyCode::Char('p'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Ctrl+P"), 120);

    for ch in "open terminal".chars() {
        h.send_key(KeyCode::Char(ch), KeyModifiers::NONE).unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some(&ch.to_string()), 50);
    }
    hold(&mut h, &mut s, 2, 100);

    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);

    // Wait for terminal to initialize
    std::thread::sleep(std::time::Duration::from_millis(500));
    h.render().unwrap();
    hold(&mut h, &mut s, 3, 100);

    // Type 'ls' in the terminal
    h.send_key(KeyCode::Char('l'), KeyModifiers::NONE).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));
    h.render().unwrap();
    snap(&mut h, &mut s, Some("l"), 100);
    h.send_key(KeyCode::Char('s'), KeyModifiers::NONE).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));
    h.render().unwrap();
    snap(&mut h, &mut s, Some("s"), 100);
    hold(&mut h, &mut s, 2, 100);

    // Press Enter to execute
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(200));
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);
    hold(&mut h, &mut s, 5, 100);

    // Switch back to editor
    h.send_key(KeyCode::Char('k'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Ctrl+K"), 200);
    hold(&mut h, &mut s, 4, 100);

    s.finalize().unwrap();
}

// =========================================================================
// Blog Post 1 (additional): More Editing Features
// =========================================================================

/// Sort Lines: select lines and sort alphabetically
#[test]
#[ignore]
fn blog_showcase_editing_sort_lines() {
    let mut h = EditorTestHarness::new(80, 24).unwrap();

    let mut s = BlogShowcase::new(
        "editing/sort-lines",
        "Sort Lines",
        "Select lines and sort them alphabetically via command palette.",
    );

    // Type unsorted lines
    h.type_text("cherry\norange\napple\nbanana\ndate\nelderberry")
        .unwrap();
    h.render().unwrap();
    hold(&mut h, &mut s, 4, 100);

    // Select all with Ctrl+A
    h.send_key(KeyCode::Char('a'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Ctrl+A"), 200);
    hold(&mut h, &mut s, 2, 100);

    // Open command palette
    h.send_key(KeyCode::Char('p'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Ctrl+P"), 120);

    // Type "sort lines"
    for ch in "sort lines".chars() {
        h.send_key(KeyCode::Char(ch), KeyModifiers::NONE).unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some(&ch.to_string()), 50);
    }
    hold(&mut h, &mut s, 2, 100);

    // Execute
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);
    hold(&mut h, &mut s, 5, 100);

    s.finalize().unwrap();
}

/// Case conversion: Alt+U for uppercase, Alt+L for lowercase
#[test]
#[ignore]
fn blog_showcase_editing_case_conversion() {
    let mut h = EditorTestHarness::new(80, 24).unwrap();

    let mut s = BlogShowcase::new(
        "editing/case-conversion",
        "Case Conversion",
        "Convert selected text to uppercase (Alt+U) or lowercase (Alt+L).",
    );

    // Type some text
    h.type_text("hello world from fresh editor").unwrap();
    h.render().unwrap();
    hold(&mut h, &mut s, 4, 100);

    // Go to start, select "hello world"
    h.send_key(KeyCode::Home, KeyModifiers::NONE).unwrap();
    for _ in 0..11 {
        h.send_key(KeyCode::Right, KeyModifiers::SHIFT).unwrap();
    }
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Select"), 200);
    hold(&mut h, &mut s, 2, 100);

    // Convert to uppercase
    h.send_key(KeyCode::Char('u'), KeyModifiers::ALT).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Alt+U"), 250);
    hold(&mut h, &mut s, 4, 100);

    // Select "FROM FRESH" (already uppercase from previous)
    // First click to deselect, then re-select
    h.send_key(KeyCode::Home, KeyModifiers::NONE).unwrap();
    // Move past "HELLO WORLD "
    for _ in 0..12 {
        h.send_key(KeyCode::Right, KeyModifiers::NONE).unwrap();
    }
    // Select "from fresh"
    for _ in 0..10 {
        h.send_key(KeyCode::Right, KeyModifiers::SHIFT).unwrap();
    }
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Select"), 200);
    hold(&mut h, &mut s, 2, 100);

    // Convert to uppercase too
    h.send_key(KeyCode::Char('u'), KeyModifiers::ALT).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Alt+U"), 250);
    hold(&mut h, &mut s, 3, 100);

    // Now select all and lowercase
    h.send_key(KeyCode::Char('a'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Ctrl+A"), 150);

    h.send_key(KeyCode::Char('l'), KeyModifiers::ALT).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Alt+L"), 250);
    hold(&mut h, &mut s, 5, 100);

    s.finalize().unwrap();
}

/// Duplicate line: Ctrl+Shift+D to duplicate current line
#[test]
#[ignore]
fn blog_showcase_editing_duplicate_line() {
    let mut h = EditorTestHarness::new(80, 24).unwrap();

    let mut s = BlogShowcase::new(
        "editing/duplicate-line",
        "Duplicate Line",
        "Duplicate the current line with a single command.",
    );

    // Type some code
    h.type_text("fn greet(name: &str) {\n    println!(\"Hello, {}!\", name);\n}")
        .unwrap();
    h.render().unwrap();
    hold(&mut h, &mut s, 4, 100);

    // Go to line 2 (the println line)
    h.send_key(KeyCode::Home, KeyModifiers::CONTROL).unwrap();
    h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, None, 200);
    hold(&mut h, &mut s, 2, 100);

    // Duplicate via command palette
    h.send_key(KeyCode::Char('p'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    h.type_text("duplicate line").unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Ctrl+P"), 100);
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);
    hold(&mut h, &mut s, 3, 100);

    // Duplicate again
    h.send_key(KeyCode::Char('p'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    h.type_text("duplicate line").unwrap();
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Duplicate"), 200);
    hold(&mut h, &mut s, 5, 100);

    s.finalize().unwrap();
}

/// Tab indent/dedent: Tab indents selected lines, Shift+Tab dedents
#[test]
#[ignore]
fn blog_showcase_editing_tab_indent() {
    let mut h = EditorTestHarness::new(80, 24).unwrap();

    let mut s = BlogShowcase::new(
        "editing/tab-indent",
        "Tab Indent Selection",
        "Tab indents selected lines, Shift+Tab dedents.",
    );

    // Type code lines
    h.type_text("fn example() {\nlet a = 1;\nlet b = 2;\nlet c = 3;\n}")
        .unwrap();
    h.render().unwrap();
    hold(&mut h, &mut s, 4, 100);

    // Select lines 2-4
    h.send_key(KeyCode::Home, KeyModifiers::CONTROL).unwrap();
    h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
    for _ in 0..3 {
        h.send_key(KeyCode::Down, KeyModifiers::SHIFT).unwrap();
    }
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Select"), 200);
    hold(&mut h, &mut s, 2, 100);

    // Indent with Tab
    h.send_key(KeyCode::Tab, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Tab"), 200);
    hold(&mut h, &mut s, 2, 100);

    // Indent again
    h.send_key(KeyCode::Tab, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Tab"), 200);
    hold(&mut h, &mut s, 2, 100);

    // Dedent with Shift+Tab
    h.send_key(KeyCode::BackTab, KeyModifiers::SHIFT).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Shift+Tab"), 200);
    hold(&mut h, &mut s, 4, 100);

    s.finalize().unwrap();
}

// =========================================================================
// Blog Post 3: Themes
// =========================================================================

/// Select Theme: browse and apply color themes
#[test]
#[ignore]
fn blog_showcase_themes_select_theme() {
    let mut h = EditorTestHarness::with_temp_project(100, 30).unwrap();
    let pd = h.project_dir().unwrap();
    create_demo_project(&pd);
    h.open_file(&pd.join("src/main.rs")).unwrap();

    let mut s = BlogShowcase::new(
        "themes/select-theme",
        "Select Theme",
        "Browse and apply color themes from the command palette.",
    );

    hold(&mut h, &mut s, 4, 100);

    // Open command palette
    h.send_key(KeyCode::Char('p'), KeyModifiers::CONTROL)
        .unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Ctrl+P"), 120);

    // Type "Select Theme"
    for ch in "Select Theme".chars() {
        h.send_key(KeyCode::Char(ch), KeyModifiers::NONE).unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some(&ch.to_string()), 50);
    }
    hold(&mut h, &mut s, 2, 100);

    // Execute
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);
    hold(&mut h, &mut s, 3, 100);

    // Browse themes with arrow keys
    for _ in 0..3 {
        h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
        h.render().unwrap();
        snap(&mut h, &mut s, Some("↓"), 150);
        hold(&mut h, &mut s, 2, 100);
    }

    // Select a theme
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    snap(&mut h, &mut s, Some("Enter"), 200);
    hold(&mut h, &mut s, 5, 100);

    s.finalize().unwrap();
}
