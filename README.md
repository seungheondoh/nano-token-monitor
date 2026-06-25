# Nano Token Monitor

**Nano Token Monitor** is a small macOS menu bar app for tracking local Claude Code and Codex usage.

This Nano build is intentionally minimal:

- macOS only
- Claude Code and Codex only
- No cloud uploads
- No social features
- No account system
- No screenshots or social sharing workflow

## Features

- Shows Claude and Codex usage as menu bar percentages: `Cl: 42% | Co: 18%`
- Tracks Claude Pro quota windows when Claude usage tracking is enabled
- Tracks Codex Pro rate-limit windows when Codex data is available
- Shows a compact dashboard focused only on quota usage and top projects
- Reads local Claude/Codex session data
- Supports multiple Claude and Codex config directories
- Runs as a macOS menu bar app

## Data Sources

| Tool | Default path |
| --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |

The app does not upload usage data for cloud or social features.

## Requirements

- macOS
- Node.js 18+
- Rust toolchain
- Tauri CLI v2
- Claude Code or Codex installed and used at least once

## Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run tauri dev
```

Build the macOS app:

```bash
npm run tauri build
```

Build output is created under:

```bash
src-tauri/target/release/bundle/
```

## Notes

- If Claude or Codex usage does not appear, run the CLI once first.
- If Codex is installed but not visible, confirm `~/.codex/sessions` exists.
- Claude quota tracking requires access to local Claude Code credentials.

## License

MIT

## Shoutout

Original project: https://github.com/soulduse/ai-token-monitor
