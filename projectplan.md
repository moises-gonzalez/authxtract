# authXtract

> 🔐 A minimalistic CLI tool for securely extracting and managing authentication state from web pages — built for automation testers.

---

## Problem Statement

Automation testers face significant challenges when handling authentication in test scenarios:

| Challenge | Risk |
|-----------|------|
| **Hardcoded credentials** | Security vulnerabilities, exposed secrets in repos |
| **Environment variables** | Still visible in logs, CI/CD configs, process lists |
| **Manual auth flows** | Slow test execution, flaky MFA handling |
| **Session management** | No encryption, no expiry tracking, no reuse |

**Result:** Insecure practices, brittle tests, and wasted time re-authenticating.

---

## Approach

### Workflow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│   CAPTURE   │ ──▶ │    LOGIN     │ ──▶ │   EXTRACT   │ ──▶ │    STORE     │
│  (CLI cmd)  │     │  (User MFA)  │     │  (Cookies)  │     │ (Encrypted)  │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
                                                                     │
                    ┌──────────────┐     ┌─────────────┐             │
                    │    REUSE     │ ◀── │   INJECT    │ ◀───────────┘
                    │  (Skip auth) │     │  (Browser)  │
                    └──────────────┘     └─────────────┘
```

### Phase 1: Capture Session

1. **CLI launches browser** — Playwright opens a headed Chromium browser
2. **User authenticates** — Manual login including MFA, SSO, OAuth, etc.
3. **Signal completion** — User presses a key or closes a modal to signal login complete
4. **Extract state** — Capture cookies, localStorage, and sessionStorage

### Phase 2: Store Securely

1. **Export state** — Use Playwright's `context.storageState()` for cookies + storage
2. **Encrypt** — AES-256-GCM encryption with user-provided password
3. **Save locally** — Store in `.authxtract/` directory (gitignored)
4. **Track metadata** — Session name, URL, expiry timestamp

### Phase 3: Reuse in Tests

1. **Decrypt state** — Unlock with password
2. **Inject into browser** — Load via Playwright's `storageState` option
3. **Skip authentication** — Tests start already logged in

---

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Runtime** | Node.js + npm | Wide compatibility, stable ecosystem |
| **Browser** | Playwright | Native `storageState` export/import, multi-browser support |
| **CLI** | Commander.js | Lightweight, intuitive command structure |
| **Prompts** | Inquirer.js | Interactive password input with masking |
| **Encryption** | Node.js `crypto` | Built-in AES-256-GCM, no dependencies |
| **Storage** | JSON files | Simple, portable, works with Playwright directly |

---

## Capturing Authentication State

Using Playwright's **built-in `storageState()`** method:

```typescript
// After user logs in
const state = await context.storageState();
// Contains: cookies, localStorage, sessionStorage
```

This is Playwright-native, captures everything needed (cookies, localStorage, sessionStorage), and directly exports to a Playwright-compatible format.

---

## Storage Structure

```
.authxtract/
├── sessions/
│   ├── my-app.enc          # Encrypted session state
│   └── staging-env.enc
└── metadata.json           # Session names, URLs, expiry times
```

**Security:**
- All session files encrypted with AES-256-GCM
- Password never stored — required at decrypt time
- `.authxtract/` added to `.gitignore` by default

---

## CLI Commands

```bash
# Capture a new session (opens browser, waits for login)
authxtract capture <name> --url <login-url>

# List stored sessions
authxtract list

# Export decrypted state for Playwright
authxtract export <name> --output ./auth-state.json

# Delete a session
authxtract delete <name>
```

---

## Usage in Playwright Tests

```typescript
import { test } from '@playwright/test';

// Skip login — use pre-authenticated state
test.use({ storageState: './auth-state.json' });

test('dashboard loads for authenticated user', async ({ page }) => {
  await page.goto('https://app.example.com/dashboard');
  // Already logged in!
});
```