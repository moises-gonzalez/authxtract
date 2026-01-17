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

authXtract solves this by capturing authenticated browser state and securely storing it for reuse:

1. **Capture** — Open a browser, let the user authenticate (including MFA), then extract cookies/storage
2. **Encrypt** — Store the session state encrypted with a master password
3. **Export** — Decrypt and export to Playwright-compatible `storageState.json`
4. **Reuse** — Tests skip login entirely by loading pre-authenticated state

### Key Features

- ✅ Supports **all authentication methods** (SSO, MFA, OAuth, etc.)
- ✅ **Encrypted storage** with password protection
- ✅ **Session expiry tracking** with warnings
- ✅ **CLI-first** design for CI/CD integration
- ✅ **Playwright-native** export format

---

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Runtime** | Bun | Fast startup, native TypeScript, modern tooling |
| **Browser Automation** | Playwright | Industry standard, excellent auth handling |
| **CLI Framework** | Commander + Inquirer | Rich interactive prompts, clean UX |
| **Encryption** | Node.js crypto (AES-256-GCM) | Strong encryption, built-in |
| **Output Format** | Playwright `storageState` | Direct compatibility with test frameworks |

---

## CLI Commands

```bash
# Capture a new session
authxtract capture <name> --url <login-url>

# List stored sessions  
authxtract list

# Export for Playwright
authxtract export <name> --output ./auth-state.json

# Delete a session
authxtract delete <name>
```

---

## Usage in Playwright

```typescript
import { test } from '@playwright/test';

// Skip login — use pre-authenticated state
test.use({ storageState: './auth-state.json' });

test('authenticated test', async ({ page }) => {
  await page.goto('https://app.example.com/dashboard');
  // Already logged in!
});
```