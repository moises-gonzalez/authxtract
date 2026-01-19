# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

authXtract is a CLI tool for capturing and managing authentication sessions from web browsers for Playwright automation testing. It allows testers to manually authenticate (including MFA) in a browser, then store and reuse that session state.

## Build & Run Commands

```bash
# Install dependencies
npm install

# Install Playwright browser (Chromium only)
npx playwright install chromium

# Build the project
npm run build

# Run the CLI (after build)
npm run start <command>

# Development mode (no build required)
npm run dev <command>
```

## CLI Commands

- `npm run dev capture <name> -u <url>` - Launch browser, authenticate manually, save session
- `npm run dev list` - List all stored sessions
- `npm run dev export <name> --output <path>` - Export session to Playwright storageState JSON
- `npm run dev delete <name>` - Delete a stored session

## Testing

```bash
# Run Playwright tests (requires TARGET_URL environment variable)
TARGET_URL=https://example.com npx playwright test
```

## Architecture

```
src/
├── index.ts              # CLI entry point (Commander) with all command definitions
├── commands/
│   └── capture.ts        # Browser session capture workflow
└── utils/
    └── storage.ts        # Session persistence to ./.authxtract/sessions/
```

**Data flow:** Browser storageState (JSON) → saved as `./.authxtract/sessions/<name>.json`

**Key patterns:**
- CLI uses Commander for argument parsing
- User prompts use Node.js readline (not Inquirer)
- Sessions stored as **unencrypted JSON** in `./.authxtract/sessions/` (project directory, not home)
- Browser launches in headed mode (`headless: false`) for manual authentication

## Testing Notes

- All tests run on **Chrome only** - no other browsers required
- Tests require `TARGET_URL` environment variable
