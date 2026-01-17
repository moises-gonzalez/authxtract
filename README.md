# authXtract

🔐 A minimalistic CLI tool for extracting and managing authentication sessions from web pages for Playwright automation testing.

## Features

- **Interactive Session Capture** - Launch a browser, log in manually (including MFA), and capture the session
- **Encrypted Storage** - Sessions are encrypted with AES-256-GCM using a master password
- **Session Management** - List, delete, and export stored sessions
- **Playwright Integration** - Export sessions in Playwright's `storageState` format
- **Session Expiry Warnings** - Automatic detection of expired or expiring cookies

## Installation

Requires [Bun](https://bun.sh) runtime.

```bash
# Clone and install dependencies
bun install

# Install Playwright browser
bunx playwright install chromium
```

## Usage

### Capture a Session

```bash
bun run start capture
```

1. Enter the URL to authenticate
2. Name the session (e.g., `my-app-qa`)
3. Enter a master password
4. Log in manually in the browser (complete MFA if needed)
5. Press Enter when done

### List Sessions

```bash
bun run start list
```

### Export for Playwright

```bash
bun run start export <session-name> --output ./auth-state.json
```

### Delete a Session

```bash
bun run start delete <session-name>
```

## Playwright Integration

```typescript
// playwright.config.ts or test file
import { test } from '@playwright/test';

test.use({
  storageState: './auth-state.json'
});

test('authenticated test', async ({ page }) => {
  await page.goto('https://your-app.com/dashboard');
  // Already logged in!
});
```

## Security

- **AES-256-GCM** encryption with random IV per session
- **PBKDF2** key derivation with 100,000 iterations
- Master password is **never stored** - required each session
- Sessions stored in `~/.authxtract/` (excluded from git)

## Storage Location

Sessions are stored in your home directory:
- Windows: `C:\Users\<username>\.authxtract\`
- macOS/Linux: `~/.authxtract/`

> ⚠️ **Never commit** the `.authxtract/` directory or exported `auth-state.json` files to version control!

## License

MIT
