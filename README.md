# authXtract

A CLI tool for **securely** capturing and managing authentication sessions from web browsers for Playwright automation testing. It allows manual authentication (including MFA), stores session state **encrypted at rest**, and exports decrypted JSON for testing.

## Security Features

- **AES-256 Encryption**: All captured sessions are stored encrypted on disk.
- **Key-Protected**: Operations require a 32-character encryption key.
- **Secure Export**: Decrypted JSON is only generated when explicitly exported for testing.

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd authxtract

# Install dependencies
npm install

# Install Playwright browser (Chromium only)
npx playwright install chromium

# Build the project
npm run build

# One-time: register the `authxtract` command globally on this machine,
# so it can be invoked via `npx authxtract …` or `authxtract …`.
# This bypasses npm's `run` argv parsing, which otherwise eats flags
# like `-u` and `--key` before they reach the CLI.
npm link
```

## Usage

### 1. Set Encryption Key (Recommended)
Set the `AUTHXTRACT_KEY` environment variable with a 32-character string.

**CMD (recommended):**
```cmd
set AUTHXTRACT_KEY=12345678901234567890123456789012
```

**Bash:**
```bash
export AUTHXTRACT_KEY="12345678901234567890123456789012"
```

*Alternatively, you can provide the key via the `--key` flag or enter it interactively when prompted.*

### 2. Capture a Session

Launch a browser, manually authenticate, and save the encrypted session:

```bash
authxtract capture <session-name> -u <login-url>
# or, equivalently:
npx authxtract capture <session-name> -u <login-url>
```

Example:
```bash
authxtract capture my-app -u https://example.com/login
```

*If you skipped `npm link`, use `node dist/index.js capture my-app -u https://example.com/login` instead — same effect, no global setup.*

This will:
1. Open a Chromium browser at the specified URL.
2. Wait for you to complete the login process (including MFA/SSO).
3. Press **Enter** in the terminal when login is complete.
4. Save the encrypted storage state to `.authxtract/sessions/`.

### 3. List Saved Sessions

View all stored sessions:

```bash
authxtract list
authxtract list --key <your-32-char-key>
```
*`list` reads the `AUTHXTRACT_KEY` env var or accepts `--key` to decrypt metadata, but does not prompt interactively. Without a key, sessions are listed by filename only.*

### 4. Export a Session

Export a session to a plain JSON file for use in Playwright tests:

```bash
authxtract export <session-name> --output <path>
```

Example:
```bash
authxtract export my-app --output ./playwright-auth.json
```
**Note:** The exported file is **decrypted** standard JSON. Treat this file as sensitive and do not commit it to version control.

### 5. Delete a Session

Remove a stored session:

```bash
authxtract delete <session-name>
```

## Development Mode

Run commands without building:

```bash
npm run dev -- capture <session-name> -u <login-url>
npm run dev -- list
npm run dev -- export <session-name> --output <path>
npm run dev -- delete <session-name>
```

*Same caveat as `npm run start`: npm intercepts flags it recognizes (e.g. `--key`) from the full argv even after `--`. If your flags go missing, invoke `ts-node` directly instead:*

```bash
npx ts-node src/index.ts capture <session-name> -u <login-url> --key <32-char-key>
```

## Using with Playwright Tests

After exporting a session, use it in your Playwright tests:

```typescript
import { test } from '@playwright/test';

test.use({
  storageState: './playwright-auth.json'
});

test('authenticated test', async ({ page }) => {
  await page.goto('https://example.com/dashboard');
  // User is already logged in
});
```

## Running Tests

Tests run on **Chrome only** and require a `TARGET_URL` env var and an exported `./auth-state.json` session file.

```bash
# Run all tests
TARGET_URL=https://example.com npx playwright test --project=chromium

# Run a single test file
TARGET_URL=https://example.com npx playwright test tests/example.spec.ts --project=chromium

# Run by test name
TARGET_URL=https://example.com npx playwright test -g "test name" --project=chromium
```

## Storage Location

- Encrypted sessions: `.authxtract/sessions/*.json`
- **Do not commit these files** if you share the same key across teams, or if you consider the metadata sensitive.

## Notes

- **Invocation**: Always prefer `authxtract …`, `npx authxtract …`, or `node dist/index.js …`. Avoid `npm run start -- …` and `npm run dev -- …` — npm scans the full argv (even after `--`) for keys that match its own config, so flags like `--key` get silently consumed before they reach the CLI, regardless of shell (cmd, bash, PowerShell).
- **Encryption Key**: Must be exactly 32 characters long.
- **Headless Mode**: Not supported. All captures are heavily manual to support MFA/SSO.
