# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

authXtract is a CLI tool for capturing and managing authentication sessions from web browsers for Playwright automation testing. It allows testers to manually authenticate (including MFA) in a browser, then store and reuse that session state.

## Build & Run Commands

```bash
npm install                          # Install dependencies
npx playwright install chromium      # Install Playwright browser (Chromium only)
npm run build                        # Build (tsc → dist/)
npm run start <command>              # Run CLI (after build)
npm run dev <command>                # Development mode (ts-node, no build required)
```

## CLI Commands

All commands that read/write sessions require a 32-character encryption key, provided via `AUTHXTRACT_KEY` env var, `--key` flag, or interactive prompt.

- `npm run dev capture <name> -u <url>` — Launch headed browser, authenticate manually, save encrypted session
- `npm run dev list` — List all stored sessions (requires key to decrypt metadata)
- `npm run dev export <name> --output <path>` — Export session to decrypted Playwright storageState JSON
- `npm run dev delete <name>` — Delete a stored session

## Testing

All tests run on **Chrome only** — no other browsers required.

Tests require a `TARGET_URL` env var and an exported `./auth-state.json` session file.

```bash
# Run all tests
TARGET_URL=https://example.com npx playwright test --project=chromium

# Run a single test file
TARGET_URL=https://example.com npx playwright test tests/example.spec.ts --project=chromium

# Run by test name
TARGET_URL=https://example.com npx playwright test -g "Authenticated page access" --project=chromium
```

**Note:** `playwright.config.ts` still has a `firefox` project enabled — it should be removed to match the Chrome-only policy.

## Architecture

- **`src/index.ts`** — CLI entry point (Commander). Defines all commands. `list`, `export`, and `delete` dynamically import `src/utils/storage.ts`.
- **`src/commands/capture.ts`** — Browser session capture workflow. Launches headed Chromium, waits for manual auth, saves encrypted state via `saveSession()`.
- **`src/utils/storage.ts`** — Encryption (AES-256) and session CRUD (`saveSession`, `loadSession`, `listSessions`, `deleteSession`). Sessions stored as encrypted JSON in `.authxtract/sessions/`.
- **`tests/`** — Playwright E2E tests using exported `auth-state.json`. Helper `tests/helpers/env.ts` provides `getTargetUrl()` / `getTargetHostname()`.

**Data flow:** Browser storageState → AES-256 encrypted JSON in `.authxtract/sessions/<name>.json` → decrypted export to `auth-state.json` for Playwright tests

**Key patterns:**
- CLI uses Commander for argument parsing
- User prompts use Node.js readline (not Inquirer)
- Encryption key must be exactly 32 characters
- Browser launches in headed mode (`headless: false`) for manual authentication
