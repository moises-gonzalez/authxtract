# authXtract

A CLI tool for **securely** capturing and managing authentication sessions from web browsers for Playwright automation testing. It allows manual authentication (including MFA), stores session state **encrypted at rest**, and exports decrypted JSON for testing.

## Security Features

- **AES-256-GCM Authenticated Encryption**: All captured sessions are stored encrypted on disk; any tampering or wrong key fails decryption cleanly.
- **scrypt Key Derivation**: The encryption key is derived from your passphrase with a fresh random salt per file. Passphrases can be any length.
- **Masked Key Entry**: The interactive key prompt never echoes what you type.
- **Strict Session Names**: Session names are validated so they can never escape the session store.
- **Restrictive Permissions**: The store is created `0700` and session/export files `0600` (POSIX; Windows relies on profile ACLs).
- **Secure Export**: Decrypted JSON is only generated when explicitly exported for testing, or streamed via `--stdout` to avoid persisting it.
- **OS Keychain Integration**: Store the passphrase once in the Windows Credential Manager / macOS Keychain / libsecret (`authxtract key store`); a pluggable `AUTHXTRACT_KEY_CMD` hook supports Vault/KMS/secret managers.
- **Session TTL**: Captures expire after 24h by default (`--ttl`), limiting the blast radius of a leaked store.
- **Isolated Capture Profile**: Each capture runs in a fresh throwaway browser profile that is deleted afterward — it can never see your personal browser's credentials.

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

### 1. Provide the Encryption Key

The passphrase can be any length (it is run through scrypt). Sources are tried in this order:

1. `--key` flag — **deprecated** (leaks into shell history/process lists; prints a warning)
2. `AUTHXTRACT_KEY` env var — recommended for CI, sourced from your secret manager
3. `AUTHXTRACT_KEY_CMD` env var — a command whose stdout is the passphrase (pluggable Vault/KMS/secret-manager integration)
4. OS keychain — stored once via `authxtract key store`
5. Interactive prompt — masked, never echoed

**OS keychain (recommended locally):**
```bash
authxtract key store    # prompts (masked) and saves to Credential Manager / Keychain / libsecret
authxtract key status   # reports presence (exit 1 when absent); never prints the key
authxtract key clear    # removes it
```

**Environment variable (recommended for CI):**
```cmd
set AUTHXTRACT_KEY=use-a-long-random-passphrase-here
```

**Pluggable secret manager / KMS:**
```bash
export AUTHXTRACT_KEY_CMD="vault kv get -field=key secret/authxtract"
# or: aws ssm get-parameter --name /authxtract/key --with-decryption --query Parameter.Value --output text
# or: op read op://vault/authxtract/password
```

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
1. Open a Chromium browser with a **fresh, isolated, throwaway profile** at the specified URL.
2. Wait for you to complete the login process (including MFA/SSO).
3. Press **Enter** in the terminal when login is complete.
4. Save the encrypted storage state to `.authxtract/sessions/` and delete the temporary profile.

Sessions **expire 24 hours after capture** by default. Tune it with `--ttl`:

```bash
authxtract capture my-app -u https://example.com/login --ttl 7d    # m/h/d units
authxtract capture my-app -u https://example.com/login --ttl none  # no expiry
```

Expired sessions still appear in `list` (marked `EXPIRED`) but `export` refuses them — re-run `capture`.

### 3. List Saved Sessions

View all stored sessions:

```bash
authxtract list
authxtract list --json          # machine-readable: stdout carries JSON only
```
*`list` reads the `AUTHXTRACT_KEY` env var (or the deprecated `--key`) to decrypt metadata, but does not prompt interactively. Without a key, sessions are listed by filename only.*

### 4. Export a Session

Export a session to a plain JSON file for use in Playwright tests:

```bash
authxtract export <session-name> --output <path>
```

Example:
```bash
authxtract export my-app --output ./playwright-auth.json

# Or avoid writing a file at all — stream the decrypted state to stdout:
authxtract export my-app --stdout > ./playwright-auth.json

# Machine-readable result (name/url/capturedAt/output) after writing the file:
authxtract export my-app --json
```
**Note:** The exported file is **decrypted** standard JSON containing live session tokens — it is password-equivalent. It is written with `0600` permissions (POSIX). Keep it out of version control and delete it after use.

### 5. Delete a Session

Remove a stored session:

```bash
authxtract delete <session-name>
```

## Output, Flags & Exit Codes

- Status messages go to **stderr**; command data (lists, JSON, exported state) goes to **stdout**, so piping and redirection stay clean.
- Output is TTY-aware: interactive terminals get decorated messages; non-interactive/CI runs get plain text with `warning:`/`error:` prefixes and no emoji.
- Global flags (place before the subcommand): `--quiet` (errors and data only), `--verbose` (detailed diagnostics, including crypto error internals), `--storage-dir <path>` (relocate the session store).

| Exit code | Meaning |
| --------- | ------- |
| `0`   | Success |
| `1`   | Usage error — bad arguments, invalid session name, missing/empty key, unknown session |
| `2`   | I/O or crypto failure — decryption failed, legacy/malformed file, filesystem error |
| `3`   | Browser automation failure — launch, navigation, or state extraction |
| `130` | Interrupted (Ctrl+C) — the browser is closed and nothing is written |

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
npx ts-node src/index.ts capture <session-name> -u <login-url>
```

Quality gates (these run in CI on every push/PR):

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # ESLint
npm run format          # Prettier (writes)
npm run test:unit       # offline unit tests
npm run test:coverage   # unit tests + c8 coverage report (coverage/)
npm audit --audit-level=high
```

Releases are semver-automated: update `CHANGELOG.md`, then `npm version patch|minor|major` — the quality gates run pre-version, the `v*` tag is pushed automatically, and CI generates an SBOM, creates the GitHub Release, and runs the (dry-run) npm publish.

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

Unit tests (storage/crypto/path-validation) run offline with no browser:

```bash
npm run test:unit
```

E2E tests run on **Chrome only** and require a `TARGET_URL` env var and an exported `./auth-state.json` session file.

```bash
# Run all tests
TARGET_URL=https://example.com npx playwright test --project=chromium

# Run a single test file
TARGET_URL=https://example.com npx playwright test tests/example.spec.ts --project=chromium

# Run by test name
TARGET_URL=https://example.com npx playwright test -g "test name" --project=chromium
```

## Storage Location

- Encrypted sessions live in `.authxtract/sessions/*.json` **relative to the directory you run the CLI from** — each project gets its own store by default.
- Use the global `--storage-dir <path>` flag to point every command at a fixed location instead, e.g. `authxtract --storage-dir ~/.authxtract list`.
- **Do not commit these files** if you share the same key across teams, or if you consider the metadata sensitive.

## Notes

- **Invocation**: Always prefer `authxtract …`, `npx authxtract …`, or `node dist/index.js …`. Avoid `npm run start -- …` and `npm run dev -- …` — npm scans the full argv (even after `--`) for keys that match its own config, so flags like `--key` get silently consumed before they reach the CLI, regardless of shell (cmd, bash, PowerShell).
- **Encryption Key**: Any non-empty passphrase; a 32-byte AES key is derived via scrypt with a per-file salt.
- **Legacy Sessions**: Sessions captured before the AES-256-GCM format (v2) are detected and rejected — re-run `capture` to migrate.
- **Diagnostics**: Decryption failures are intentionally generic. Pass `--verbose` (before the subcommand) for details.
- **Headless Mode**: Not supported. All captures are heavily manual to support MFA/SSO.

## Project Docs

- [SECURITY.md](SECURITY.md) — threat model, what the encryption does and does not guarantee, vulnerability reporting
- [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup, quality gates, PR guidelines
- [CHANGELOG.md](CHANGELOG.md) — release history (Keep a Changelog)

## License

[ISC](LICENSE) © Moises Gonzalez
