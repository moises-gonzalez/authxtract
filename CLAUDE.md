# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

authXtract is a CLI tool for capturing and managing encrypted authentication sessions from web browsers for Playwright automation testing. It allows testers to manually authenticate (including MFA) in a browser, then securely store and reuse that session state.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Install Playwright browser (Chromium only)
bunx playwright install chromium

# Run the CLI
bun run start <command>

# Development mode with watch
bun run dev <command>
```

## CLI Commands

- `bun run start capture` - Launch browser, authenticate manually, save encrypted session
- `bun run start list` - List all stored sessions
- `bun run start export <name> --output <path>` - Export session to Playwright storageState JSON
- `bun run start delete <name>` - Delete a stored session

## Architecture

```
src/
├── index.ts           # CLI entry point (Commander setup)
├── core/
│   ├── browser.ts     # Playwright browser launch, storageState extraction, cookie expiry analysis
│   └── crypto.ts      # AES-256-GCM encryption/decryption with PBKDF2 key derivation
├── storage/
│   └── file-store.ts  # Session persistence to ~/.authxtract/ (index.json + *.enc.json files)
└── commands/
    ├── capture.ts     # Interactive session capture workflow
    ├── list.ts        # Display sessions table
    ├── delete.ts      # Remove session with confirmation
    └── export.ts      # Decrypt and export to storageState JSON
```

**Data flow:** Browser storageState (JSON) → encrypted with password → saved to `~/.authxtract/sessions/<name>.enc.json`

**Key patterns:**
- All commands use Commander for CLI parsing and Inquirer for interactive prompts
- Encryption uses Node.js crypto (not Bun-specific) for AES-256-GCM with random IV/salt per session
- Sessions stored in user's home directory (`~/.authxtract/`) with a JSON index file for metadata

## Testing Notes

- All tests run on **Chrome only** - no other browsers required
- Browser launches in headed mode (`headless: false`) for manual authentication
