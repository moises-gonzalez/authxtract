# authXtract

A CLI tool for **securely** capturing and managing authentication sessions from web browsers for Playwright automation testing. You authenticate manually once (including MFA/SSO/OAuth), authXtract stores the session **encrypted at rest**, and exports a decrypted Playwright `storageState` JSON only when your tests need it.

```text
headed browser (manual login) ──▶ AES-256-GCM encrypted store ──▶ decrypted storageState JSON
                                  .authxtract/sessions/<name>.json   auth-state.json (for Playwright)
```

## Security Features

- **AES-256-GCM Authenticated Encryption** — sessions are encrypted on disk; any tampering or wrong key fails decryption cleanly, never silently.
- **scrypt Key Derivation** — the AES key is derived from your passphrase with a fresh random salt per file. Passphrases can be any length.
- **OS Keychain Integration** — store the passphrase once in the Windows Credential Manager / macOS Keychain / libsecret (`authxtract key store`); a pluggable `AUTHXTRACT_KEY_CMD` hook supports Vault/KMS/secret managers.
- **Session TTL** — captures expire after 24 hours by default (`--ttl`), limiting the blast radius of a leaked store.
- **Isolated Capture Profile** — each capture runs in a fresh throwaway browser profile that is deleted afterward; it can never see your personal browser's credentials.
- **Masked Key Entry** — the interactive key prompt never echoes what you type.
- **Strict Session Names** — names are validated (`A-Z a-z 0-9 . _ -`, max 64, no `..`) so they can never escape the session store.
- **Restrictive Permissions** — the store is created `0700`, session and export files `0600` (POSIX; Windows relies on profile ACLs).
- **Hardened Export** — decrypted JSON is produced only on explicit `export`, with a warning; `--stdout` streams it without persisting anything.

## Requirements

- **Node.js ≥ 18**
- **Google Chrome or Microsoft Edge** installed on the system (Chrome-only policy; Edge is the Chromium-family fallback). authXtract uses your existing browser — it never downloads one.

## Installation

Requires **Node.js ≥ 18**.

### From a GitHub release (recommended for users)

Install directly with npm — it clones, builds, and registers the `authxtract` command
globally in one step (npm builds the TypeScript via the `prepare` script during install):

```bash
# Latest tagged release
npm install -g github:moises-gonzalez/authxtract#v0.4.0

# Or the latest commit on main
npm install -g github:moises-gonzalez/authxtract
```

Browse all versions on the [Releases page](https://github.com/moises-gonzalez/authxtract/releases).

### From source (development)

```bash
git clone https://github.com/moises-gonzalez/authxtract.git
cd authxtract

npm install
npm run build

# One-time: register the `authxtract` command globally on this machine,
# so it can be invoked as `authxtract …` or `npx authxtract …`.
npm link
```

> **Invocation note:** always run the CLI as `authxtract …`, `npx authxtract …`, or `node dist/index.js …`. Avoid `npm run start -- …` / `npm run dev -- …` for real usage — npm scans the full argv (even after `--`) for keys matching its own config, so flags like `--key` can be silently consumed before they reach the CLI, regardless of shell.

> **Browser selection:** capture uses your system browser — Google Chrome by default, falling back to Microsoft Edge. Force one with `--browser chrome` / `--browser msedge`, or set `AUTHXTRACT_BROWSER=chrome|msedge` (useful where IT mandates a specific browser). If neither is installed, capture exits with an install message.

## Quick Start

```bash
# 1. One-time: store your passphrase in the OS keychain (prompted, masked)
authxtract key store

# 2. Capture — a browser opens; log in (MFA/SSO included), then press ENTER in the terminal
authxtract capture my-app -u https://example.com/login

# 3. Export the decrypted storageState for Playwright (defaults to ./auth-state.json)
authxtract export my-app

# 4. Point your Playwright tests at it (see "Using with Playwright Tests" below)
```

## Command Reference

| Command | Purpose |
| ------- | ------- |
| `capture <name> -u <url> [--ttl <dur>]` | Open an isolated headed browser, authenticate manually, save the encrypted session |
| `list [--json]` | List stored sessions (decrypts metadata when a key is available) |
| `export <name> [-o <path>] [--stdout] [--json]` | Decrypt a session to Playwright `storageState` JSON |
| `delete <name>` | Remove a stored session |
| `key store \| status \| clear` | Manage the passphrase in the OS keychain |

Global flags go **before** the subcommand: `--quiet`, `--verbose`, `--storage-dir <path>`. `--help` and `--version` are available everywhere.

## Providing the Encryption Key

The passphrase can be any non-empty length (it is run through scrypt). For `capture` and `export`, sources are tried in this order:

1. `--key` flag — **deprecated** (leaks into shell history/process lists; prints a warning)
2. `AUTHXTRACT_KEY` env var — recommended for CI, sourced from your secret manager
3. `AUTHXTRACT_KEY_CMD` env var — a command whose stdout is the passphrase (pluggable Vault/KMS/secret-manager integration)
4. OS keychain — stored once via `authxtract key store`
5. Interactive prompt — masked, never echoed

> `list` is non-interactive by design: it only uses `--key` or `AUTHXTRACT_KEY`. Without a key it still lists sessions by filename. `delete` needs no key.

**OS keychain (recommended locally):**

```bash
authxtract key store    # prompts (masked) and saves to Credential Manager / Keychain / libsecret
authxtract key status   # reports presence (exit 1 when absent); never prints the key
authxtract key clear    # removes it
```

**Environment variable (recommended for CI):**

```bash
export AUTHXTRACT_KEY="use-a-long-random-passphrase-here"   # bash
```

```cmd
set AUTHXTRACT_KEY=use-a-long-random-passphrase-here        # Windows cmd
```

**Pluggable secret manager / KMS:**

```bash
export AUTHXTRACT_KEY_CMD="vault kv get -field=key secret/authxtract"
# or: aws ssm get-parameter --name /authxtract/key --with-decryption --query Parameter.Value --output text
# or: op read op://vault/authxtract/password
```

## Commands in Detail

### capture

```bash
authxtract capture my-app -u https://example.com/login
```

1. Opens your **system browser** (Google Chrome, or Microsoft Edge as a fallback) with a **fresh, isolated, throwaway profile** at the given URL.
2. You complete the login in the browser — MFA, SSO, OAuth, anything manual.
3. Press **Enter** in the terminal when done.
4. The encrypted session is saved to the store and the temporary profile is deleted.

Sessions **expire 24 hours after capture** by default. Tune it with `--ttl` (`m`/`h`/`d` units, max `365d`):

```bash
authxtract capture my-app -u https://example.com/login --ttl 7d
authxtract capture my-app -u https://example.com/login --ttl none   # no expiry
```

Headless capture is intentionally unsupported — the whole point is a real, manual login.

### list

```bash
authxtract list
authxtract list --json   # machine-readable: stdout carries JSON only
```

Shows each session's URL, capture time, and expiry. Expired sessions are marked `EXPIRED — re-run capture`; sessions in the old pre-v2 format are flagged as legacy. The empty-store message names the directory it looked in.

### export

```bash
authxtract export my-app                          # writes ./auth-state.json (0600)
authxtract export my-app -o ./somewhere.json      # custom path
authxtract export my-app --stdout > state.json    # stream; nothing persisted by the CLI
authxtract export my-app --json                   # machine-readable result (name/url/capturedAt/output)
```

The output is **decrypted** JSON containing live session tokens — it is password-equivalent. Keep it out of version control (`auth-state.json` is gitignored here) and delete it after use. Expired sessions are refused — re-run `capture`. `--stdout` and `--json` are mutually exclusive; with `--stdout`, all warnings go to stderr so pipes stay clean.

### delete

```bash
authxtract delete my-app
```

Works without a key, and also on expired or legacy sessions.

## Output, Flags & Exit Codes

- Status messages go to **stderr**; command data (lists, JSON, exported state) goes to **stdout**, so piping and redirection stay clean.
- Output is TTY-aware: interactive terminals get decorated messages; non-interactive/CI runs get plain text with `warning:`/`error:` prefixes and no emoji.
- `--quiet` keeps only errors and command data; `--verbose` adds diagnostics (including crypto error internals — decryption failures are intentionally generic otherwise).

| Exit code | Meaning |
| --------- | ------- |
| `0`   | Success |
| `1`   | Usage error — bad arguments, invalid session name, missing/empty key, unknown session |
| `2`   | I/O or crypto failure — decryption failed, expired/legacy/malformed file, filesystem error |
| `3`   | Browser automation failure — launch, navigation, or state extraction |
| `130` | Interrupted (Ctrl+C) — the browser is closed and nothing is written |

## Session Storage

- Encrypted sessions live in `.authxtract/sessions/*.json` **relative to the directory you run the CLI from** — each project gets its own store by default.
- Use the global `--storage-dir <path>` flag to point every command at a fixed location instead, e.g. `authxtract --storage-dir ~/.authxtract list`.
- **Do not commit the store** if you share the same key across teams, or if you consider the metadata sensitive (it is gitignored here).
- Sessions captured before the AES-256-GCM v2 format are detected and rejected with a re-capture message — encryption migration is a clean break by design.

## Uninstall / Remove authXtract

authXtract stores credential-grade data, so a complete removal has two parts — your **data** and the **program**. Do the data step **first**, while the `authxtract` command is still installed.

### 1. Remove your data

```bash
authxtract list        # (optional) see what's stored first
authxtract key clear   # remove the passphrase from the OS keychain
```

Then delete the encrypted session store. By default it lives in **`.authxtract/` relative to each directory you ran the CLI from**, so you may have one per project — remove each. If you used `--storage-dir <path>`, delete that path instead.

```bash
rm -rf ./.authxtract                          # macOS / Linux
Remove-Item -Recurse -Force .\.authxtract     # Windows (PowerShell)
```

Also delete any `auth-state.json` files you created with `export` — they contain decrypted, password-equivalent tokens and live wherever you wrote them.

### 2. Remove the program

```bash
npm uninstall -g authxtract   # removes the global command (whether installed via `npm link` or `npm i -g`)
```

If you installed from a clone (`git clone` + `npm link`), also delete the cloned repo once the global command is gone.

### 3. Verify

```bash
authxtract --version   # should now report "command not found"
npm ls -g --depth=0    # authxtract should be absent
```

If you removed the program **before** clearing the keychain, delete the entry manually (service `authxtract`, account `default`):

```bash
cmdkey /delete:authxtract:default                          # Windows
security delete-generic-password -s authxtract -a default  # macOS
secret-tool clear service authxtract account default       # Linux
```

## Using with Playwright Tests

After exporting, point Playwright at the file:

```typescript
import { test } from '@playwright/test';

test.use({
  storageState: './auth-state.json',
});

test('authenticated test', async ({ page }) => {
  await page.goto('https://example.com/dashboard');
  // Already logged in
});
```

## Testing This Repository

Unit tests (crypto, TTL, path validation, key resolution) run offline, no browser needed:

```bash
npm run test:unit
npm run test:coverage   # same tests + c8 coverage report in coverage/
```

E2E tests run on **Chrome only** and need a `TARGET_URL` env var plus an exported `./auth-state.json`. They verify the post-login URL is not a login page, and **skip gracefully** when either prerequisite is missing (so CI never hard-fails on them):

```bash
# bash
TARGET_URL=https://example.com npx playwright test --project=chromium

# PowerShell
$env:TARGET_URL='https://example.com'; npx playwright test --project=chromium

# Single file / by name
TARGET_URL=https://example.com npx playwright test tests/example.spec.ts --project=chromium
TARGET_URL=https://example.com npx playwright test -g "Authenticated page access" --project=chromium
```

## Development

```bash
npm run dev -- capture <name> -u <url>   # ts-node, no build needed (see invocation note above —
                                          # if flags go missing, use: npx ts-node src/index.ts …)
```

Quality gates (CI runs these on every push/PR):

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # ESLint
npm run format          # Prettier (writes)
npm run test:coverage   # offline unit tests + coverage
npm audit --audit-level=high
```

Releases are semver-automated: move the `CHANGELOG.md` entries out of *Unreleased*, then run `npm version patch|minor|major` — the gates run pre-version, the `v*` tag is pushed automatically, and CI generates a CycloneDX SBOM, creates the GitHub Release, and runs the (currently dry-run) npm publish.

## Project Docs

- [SECURITY.md](SECURITY.md) — threat model, what the encryption does and does not guarantee, vulnerability reporting
- [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup, quality gates, PR and release guidelines
- [CHANGELOG.md](CHANGELOG.md) — release history (Keep a Changelog)

## License

[ISC](LICENSE) © Moises Gonzalez
