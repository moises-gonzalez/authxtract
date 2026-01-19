# authXtract

A CLI tool for capturing and managing authentication sessions from web browsers for Playwright automation testing. Allows testers to manually authenticate (including MFA) in a browser, then store and reuse that session state.

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
```

## Usage

### Capture a Session

Launch a browser, manually authenticate, and save the session:

```bash
npm run start -- capture <session-name> -u <login-url>
```

Example:
```bash
npm run start -- capture my-app -u https://example.com/login
```

This will:
1. Open a Chromium browser at the specified URL
2. Wait for you to complete the login process (including MFA if required)
3. Press Enter in the terminal when authentication is complete
4. Save the browser's storage state (cookies, localStorage, sessionStorage)

### List Saved Sessions

View all stored sessions:

```bash
npm run start -- list
```

### Export a Session

Export a session to a JSON file for use in Playwright tests:

```bash
npm run start -- export <session-name> --output <path>
```

Example:
```bash
npm run start -- export my-app --output ./playwright-auth.json
```

If `--output` is not specified, defaults to `./auth-state.json`.

### Delete a Session

Remove a stored session:

```bash
npm run start -- delete <session-name>
```

## Development Mode

Run commands without building first:

```bash
npm run dev -- capture <session-name> -u <login-url>
npm run dev -- list
npm run dev -- export <session-name> --output <path>
npm run dev -- delete <session-name>
```

For export, --output or -o works.

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

Or configure it globally in `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    storageState: './playwright-auth.json',
  },
});
```

## Storage Location

Sessions are stored as JSON files in `.authxtract/sessions/` within the project directory.

## Running Tests

```bash
TARGET_URL=https://example.com npx playwright test
```

## Notes

- **Windows users**: Use Command Prompt (`cmd`) instead of PowerShell. PowerShell incorrectly intercepts CLI flags like `-u`
- The browser launches in headed mode (visible window) to allow manual authentication
- Sessions are stored as unencrypted JSON files - do not commit them to version control
- Add `.authxtract/` to your `.gitignore` file
