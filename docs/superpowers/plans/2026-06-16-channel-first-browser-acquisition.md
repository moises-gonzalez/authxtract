# Channel-First Browser Acquisition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `authxtract capture` (and the e2e tests) launch the user's **system** Chrome/Edge via Playwright's `channel` instead of a downloaded Chromium, removing the install/hang failure class (#7, #8).

**Architecture:** A new `src/utils/browser.ts` owns browser-preference resolution (`--browser` flag → `AUTHXTRACT_BROWSER` env → auto-detect Chrome→Edge) and channel launching with a not-installed classifier driving fallback and friendly errors. `capture.ts` delegates launching to it. The runtime dependency drops from `playwright` to `playwright-core` (no browser download); `playwright.config.ts` pins the test project to `channel: 'chrome'`. The recent #7 docs/`setup` script are removed as superseded.

**Tech Stack:** TypeScript (CommonJS), `commander` CLI, `playwright-core`, `@playwright/test` (dev), `node:test` unit tests via `ts-node/register/transpile-only`.

**Spec:** `docs/superpowers/specs/2026-06-16-channel-first-browser-acquisition-design.md`

---

## File Structure

- **Create** `src/utils/browser.ts` — browser preference resolution + channel launching + error classifier. One responsibility: "decide which system browser to use and launch it."
- **Create** `tests/unit/browser.test.ts` — offline unit tests for the pure parts (resolver + classifier).
- **Modify** `src/commands/capture.ts` — delegate launch to `browser.ts`; drop the `playwright` import; `CaptureOptions` gains `browser`.
- **Modify** `src/index.ts` — add `--browser` option to the capture command; resolve preference; pass it through.
- **Modify** `playwright.config.ts` — add `channel: 'chrome'` to the `chromium` project.
- **Modify** `package.json` — `dependencies`: `playwright` → `playwright-core`; remove the `setup` script; add `browser.test.ts` to `test:unit`.
- **Modify** `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` — supersede #7 (remove `npm run setup`, `playwright install`, `__dirlock` troubleshooting); document `--browser` / `AUTHXTRACT_BROWSER`; update Requirements.

---

## Task 1: Browser preference resolver + not-installed classifier (TDD)

**Files:**
- Create: `src/utils/browser.ts`
- Test: `tests/unit/browser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/browser.test.ts`:

```ts
/**
 * Unit tests for browser preference resolution and the "browser not installed"
 * error classifier. Offline — no Playwright or real browser required.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    BROWSER_ENV,
    isBrowserNotInstalledError,
    resolveBrowserPreference,
} from '../../src/utils/browser';
import { UsageError } from '../../src/utils/errors';

test('browser: --browser flag wins over env and maps to a channel', () => {
    const pref = resolveBrowserPreference('msedge', { [BROWSER_ENV]: 'chrome' });
    assert.deepEqual(pref, { kind: 'channel', channel: 'msedge', source: 'flag' });
});

test('browser: AUTHXTRACT_BROWSER env is used (case-insensitive) when no flag is given', () => {
    const pref = resolveBrowserPreference(undefined, { [BROWSER_ENV]: 'CHROME' });
    assert.deepEqual(pref, { kind: 'channel', channel: 'chrome', source: 'env' });
});

test('browser: with no flag or env, the preference is auto-detect', () => {
    assert.deepEqual(resolveBrowserPreference(undefined, {}), { kind: 'auto' });
});

test('browser: a blank env value falls through to auto-detect', () => {
    assert.deepEqual(resolveBrowserPreference(undefined, { [BROWSER_ENV]: '   ' }), { kind: 'auto' });
});

test('browser: an invalid --browser value is a usage error', () => {
    assert.throws(() => resolveBrowserPreference('firefox', {}), UsageError);
});

test('browser: an invalid AUTHXTRACT_BROWSER value is a usage error', () => {
    assert.throws(() => resolveBrowserPreference(undefined, { [BROWSER_ENV]: 'safari' }), UsageError);
});

test('browser: isBrowserNotInstalledError recognizes the channel-not-found message', () => {
    const notInstalled = new Error(
        "browserType.launchPersistentContext: Chromium distribution 'chrome' is not found at " +
            '/opt/google/chrome/chrome\nRun "npx playwright install chrome"'
    );
    assert.equal(isBrowserNotInstalledError(notInstalled), true);
});

test('browser: isBrowserNotInstalledError ignores unrelated launch failures', () => {
    const other = new Error(
        'browserType.launchPersistentContext: Target page, context or browser has been closed'
    );
    assert.equal(isBrowserNotInstalledError(other), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --require ts-node/register/transpile-only tests/unit/browser.test.ts`
Expected: FAIL — cannot find module `../../src/utils/browser` (file does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/utils/browser.ts`:

```ts
/**
 * System-browser acquisition. authXtract launches the user's installed Chrome
 * or Edge via Playwright's `channel` — it never downloads a browser.
 *
 * Preference precedence (mirrors key-provider.ts): --browser flag →
 * AUTHXTRACT_BROWSER env → auto-detect (Chrome, then Edge).
 */

import { chromium, type BrowserContext } from 'playwright-core';
import { BrowserError, UsageError } from './errors';
import { logger } from './logger';

export const BROWSER_ENV = 'AUTHXTRACT_BROWSER';

export type BrowserChannel = 'chrome' | 'msedge';

/** A resolved choice: a specific channel, or auto-detect (Chrome → Edge). */
export type BrowserPreference =
    | { kind: 'channel'; channel: BrowserChannel; source: 'flag' | 'env' }
    | { kind: 'auto' };

const VALID_CHANNELS: readonly BrowserChannel[] = ['chrome', 'msedge'];
const AUTO_ORDER: readonly BrowserChannel[] = ['chrome', 'msedge'];
const CHANNEL_LABELS: Record<BrowserChannel, string> = {
    chrome: 'Google Chrome',
    msedge: 'Microsoft Edge',
};

function normalizeChannel(value: string): BrowserChannel | null {
    const v = value.trim().toLowerCase();
    return (VALID_CHANNELS as readonly string[]).includes(v) ? (v as BrowserChannel) : null;
}

/**
 * Resolve which browser to use. Throws UsageError (exit 1) on an invalid value.
 */
export function resolveBrowserPreference(
    flag: string | undefined,
    env: NodeJS.ProcessEnv = process.env
): BrowserPreference {
    if (flag !== undefined) {
        const channel = normalizeChannel(flag);
        if (channel === null) {
            throw new UsageError(`Invalid --browser '${flag}'. Use 'chrome' or 'msedge'.`);
        }
        return { kind: 'channel', channel, source: 'flag' };
    }

    const envValue = env[BROWSER_ENV];
    if (envValue !== undefined && envValue.trim().length > 0) {
        const channel = normalizeChannel(envValue);
        if (channel === null) {
            throw new UsageError(`Invalid ${BROWSER_ENV} '${envValue}'. Use 'chrome' or 'msedge'.`);
        }
        return { kind: 'channel', channel, source: 'env' };
    }

    return { kind: 'auto' };
}

/**
 * Does this launch error mean "the requested browser channel isn't installed",
 * as opposed to some other launch failure? Playwright-core reports a distinctive
 * message ("... distribution 'chrome' is not found ...") for a missing channel.
 */
export function isBrowserNotInstalledError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /is not found|not installed|Executable doesn't exist|Run "npx playwright install/i.test(message);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --require ts-node/register/transpile-only tests/unit/browser.test.ts`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/browser.ts tests/unit/browser.test.ts
git commit -m "Add system-browser preference resolver and not-installed classifier" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Channel launcher with fallback + friendly errors

**Files:**
- Modify: `src/utils/browser.ts` (append `launchWithChannel`)

This logic launches a real browser, so it is verified by typecheck/build and the manual smoke test (Task 7), not an offline unit test.

- [ ] **Step 1: Append the launcher to `src/utils/browser.ts`**

Add at the end of `src/utils/browser.ts`:

```ts
function launchOne(profileDir: string, channel: BrowserChannel): Promise<BrowserContext> {
    return chromium.launchPersistentContext(profileDir, { headless: false, channel });
}

function wrapLaunchError(error: unknown): BrowserError {
    return new BrowserError(
        `Failed to launch browser: ${error instanceof Error ? error.message : String(error)}`
    );
}

/**
 * Launch a persistent context using the resolved preference. For an explicit
 * channel, try only that one; for auto, try Chrome then Edge. A "not installed"
 * outcome yields an actionable BrowserError (exit 3); any other launch failure
 * is surfaced as a generic browser error.
 */
export async function launchWithChannel(
    profileDir: string,
    pref: BrowserPreference
): Promise<BrowserContext> {
    if (pref.kind === 'channel') {
        try {
            return await launchOne(profileDir, pref.channel);
        } catch (error) {
            if (isBrowserNotInstalledError(error)) {
                const other: BrowserChannel = pref.channel === 'chrome' ? 'msedge' : 'chrome';
                throw new BrowserError(
                    `${CHANNEL_LABELS[pref.channel]} was requested (--browser ${pref.channel}) ` +
                        `but isn't installed. Install it, or use --browser ${other}.`
                );
            }
            throw wrapLaunchError(error);
        }
    }

    for (const channel of AUTO_ORDER) {
        try {
            return await launchOne(profileDir, channel);
        } catch (error) {
            if (isBrowserNotInstalledError(error)) {
                logger.verbose(`${CHANNEL_LABELS[channel]} not found; trying the next browser.`);
                continue;
            }
            throw wrapLaunchError(error);
        }
    }

    throw new BrowserError(
        'No supported browser found. authXtract uses your system Google Chrome or Microsoft Edge — ' +
            'install Google Chrome (https://www.google.com/chrome/) and try again.'
    );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS — no errors (confirms `playwright-core` types resolve and there are no unused symbols).

- [ ] **Step 3: Verify lint is clean**

Run: `npm run lint`
Expected: PASS — no unused-variable or other lint errors in `browser.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/utils/browser.ts
git commit -m "Add channel launcher with Chrome->Edge fallback and friendly errors" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire the launcher into the capture command

**Files:**
- Modify: `src/commands/capture.ts`

- [ ] **Step 1: Update imports**

In `src/commands/capture.ts`, replace the `playwright` import (currently line 5):

```ts
import { chromium } from 'playwright';
```

with:

```ts
import { launchWithChannel, type BrowserPreference } from '../utils/browser';
```

(Keep the existing `import { BrowserError, EXIT, InterruptedError } from '../utils/errors';` line — `browserStep` still constructs `BrowserError` for the page/navigate/extract steps.)

- [ ] **Step 2: Add `browser` to `CaptureOptions`**

In the `CaptureOptions` interface, add the field:

```ts
export interface CaptureOptions {
    url: string;
    name: string;
    key?: string;
    /** Session lifetime in ms; null disables expiry. */
    ttlMs: number | null;
    /** Resolved system-browser choice (channel or auto-detect). */
    browser: BrowserPreference;
}
```

- [ ] **Step 3: Destructure `browser` and replace the launch block**

Change the destructuring line in `capture()`:

```ts
const { url, name, key, ttlMs } = options;
```

to:

```ts
const { url, name, key, ttlMs, browser } = options;
```

Then replace the launch block (currently):

```ts
    const context = await browserStep('Failed to launch browser', () =>
        chromium.launchPersistentContext(profileDir, { headless: false })
    ).catch((error) => {
        removeProfileDir(profileDir);
        throw error;
    });
```

with:

```ts
    const context = await launchWithChannel(profileDir, browser).catch((error) => {
        removeProfileDir(profileDir);
        throw error;
    });
```

(`launchWithChannel` already throws an actionable `BrowserError`, so no `browserStep` wrapper here.)

- [ ] **Step 4: Verify it typechecks**

Run: `npm run typecheck`
Expected: FAIL — `src/index.ts` calls `capture(...)` without the now-required `browser` property. This is expected and fixed in Task 4. (The `capture.ts` file itself has no errors.)

- [ ] **Step 5: Commit**

```bash
git add src/commands/capture.ts
git commit -m "Capture: launch the system browser via the channel launcher" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Add the `--browser` option to the CLI

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Import the resolver**

In `src/index.ts`, add to the imports near the top (after the `capture` import on line 10):

```ts
import { resolveBrowserPreference } from './utils/browser';
```

- [ ] **Step 2: Add the `--browser` option to the capture command**

In the capture command definition, add the option after the `--key` option (currently line 70). The block becomes:

```ts
program
    .command('capture <name>')
    .description('Capture authentication state from a browser session')
    .requiredOption('-u, --url <url>', 'Login page URL')
    .option('--ttl <duration>', 'Session lifetime: <n>m/<n>h/<n>d, or "none" to disable expiry', '24h')
    .option('-k, --key <key>', DEPRECATED_KEY_HELP)
    .option('--browser <name>', 'Browser to launch: chrome or msedge (default: auto-detect — Chrome, then Edge)')
    .action(async (name: string, options: { url: string; ttl: string; key?: string; browser?: string }) => {
        try {
            validateSessionName(name);
            const ttlMs = parseTtl(options.ttl);
            const browser = resolveBrowserPreference(options.browser);
            const key = await getKey(options.key);
            await capture({ name, url: options.url, key, ttlMs, browser });
        } catch (error) {
            handleCliError(error);
        }
    });
```

(Resolving `browser` *before* `getKey` means an invalid `--browser` fails fast with exit 1 without prompting for a passphrase.)

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS — `capture(...)` now receives `browser`, satisfying `CaptureOptions`.

- [ ] **Step 4: Verify lint and unit tests**

Run: `npm run lint`
Expected: PASS.

Run: `node --require ts-node/register/transpile-only tests/unit/browser.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "CLI: add --browser option and resolve preference for capture" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Channel-ize tests, swap dependency, drop the setup script

**Files:**
- Modify: `playwright.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Point the test project at system Chrome**

In `playwright.config.ts`, change the `chromium` project (currently lines 39-42):

```ts
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
```

to:

```ts
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], channel: 'chrome' },
        },
```

- [ ] **Step 2: Swap the runtime dependency and update scripts in `package.json`**

In `package.json`:

(a) In `dependencies`, replace the `playwright` line with `playwright-core` (same version range):

```json
  "dependencies": {
    "commander": "^13.0.0",
    "playwright-core": "^1.57.0"
  },
```

(b) Remove the `setup` script line (added for #7) so the `scripts` block returns to:

```json
    "build": "tsc",
    "start": "node dist/index.js",
```

(c) Add the new unit test file to `test:unit`:

```json
    "test:unit": "node --require ts-node/register/transpile-only tests/unit/storage.test.ts && node --require ts-node/register/transpile-only tests/unit/phase2.test.ts && node --require ts-node/register/transpile-only tests/unit/browser.test.ts",
```

- [ ] **Step 3: Sync the lockfile / node_modules**

Run (use the project's package manager — pnpm locally per project memory; CI uses `npm ci`):
`pnpm install` (or `npm install` if no `pnpm-lock.yaml` is present)
Expected: completes; `playwright-core` is now a direct dependency. `@playwright/test` (devDep) keeps `playwright-core` present regardless.

Verify the engine resolves:
Run: `node -e "require('playwright-core'); console.log('playwright-core OK')"`
Expected: prints `playwright-core OK`.

- [ ] **Step 4: Verify the full gate**

Run: `npm run typecheck && npm run lint && npm run test:unit && npm run build`
Expected: PASS — typecheck/lint clean; storage + phase2 + browser unit suites all pass; `tsc` builds to `dist/`.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts package.json package-lock.json pnpm-lock.yaml
git commit -m "Use playwright-core + system Chrome channel; drop setup script" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(If a given lockfile does not exist, `git add` simply ignores it — that is fine.)

---

## Task 6: Update docs (supersede #7)

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: README — Requirements**

In `README.md`, change the Requirements bullet (currently line 25):

```md
- **Chromium** via Playwright (the only browser used — Chrome-only policy)
```

to:

```md
- **Google Chrome or Microsoft Edge** installed on the system (Chrome-only policy; Edge is the Chromium-family fallback). authXtract uses your existing browser — it never downloads one.
```

- [ ] **Step 2: README — Installation (remove `npm run setup`)**

Replace the Installation code block so it no longer downloads a browser:

```bash
git clone https://github.com/moises-gonzalez/authxtract.git
cd authxtract

npm install
npm run build

# One-time: register the `authxtract` command globally on this machine,
# so it can be invoked as `authxtract …` or `npx authxtract …`.
npm link
```

- [ ] **Step 3: README — remove the `__dirlock` Troubleshooting subsection**

Delete the entire `### Troubleshooting: \`npm run setup\` hangs with no output` subsection (the symptom/recovery block and the `install-deps` note added for #7). It no longer applies — nothing downloads a browser.

- [ ] **Step 4: README — document browser selection**

Immediately after the **Invocation note** blockquote, add:

```md
> **Browser selection:** capture uses your system browser — Google Chrome by default, falling back to Microsoft Edge. Force one with `--browser chrome` / `--browser msedge`, or set `AUTHXTRACT_BROWSER=chrome|msedge` (useful where IT mandates a specific browser). If neither is installed, capture exits with an install message.
```

- [ ] **Step 5: CONTRIBUTING — dev setup**

In `CONTRIBUTING.md`, replace the Development setup block so it ends without `npm run setup`, and replace the `__dirlock` pointer note:

```bash
git clone https://github.com/moises-gonzalez/authxtract.git
cd authxtract
npm install
npm run build
```

Replace the blockquote that points at the README `__dirlock` troubleshooting with:

```md
> authXtract uses your **system** Google Chrome or Microsoft Edge (via Playwright's `channel`) — no browser download. To run the e2e tests you need Chrome (or Edge) installed locally; GitHub's `ubuntu-latest` runners already ship Google Chrome.
```

- [ ] **Step 6: CONTRIBUTING — commands table**

Remove the `npm run setup` row from the Day-to-day commands table (the row added for #7):

```md
| `npm run setup`      | Download the Chromium browser Playwright needs          |
```

- [ ] **Step 7: CHANGELOG — rewrite the `[Unreleased]` section**

Replace the current `[Unreleased]` block (the #7 entries) with:

```md
## [Unreleased]

### Changed

- **Capture uses the system browser.** `authxtract capture` now launches your installed Google
  Chrome (falling back to Microsoft Edge) via Playwright's `channel` instead of a downloaded
  Chromium. The runtime dependency is now `playwright-core` (no browser download). This removes the
  install hang (#7) and the "Playwright was just installed" first-capture failure (#8) by removing
  their root cause. The e2e test project also uses the system Chrome channel.

### Added

- **`--browser <chrome|msedge>` flag and `AUTHXTRACT_BROWSER` env var** to force a specific system
  browser; the default auto-detects Chrome then Edge. A missing browser produces a clear, actionable
  error instead of Playwright's generic "install all browsers" message.

### Removed

- The `npm run setup` script and the `npx playwright install chromium` install/troubleshooting steps —
  nothing is downloaded anymore.
```

- [ ] **Step 8: Verify docs build context still passes**

Run: `npm run typecheck && npm run lint && npm run test:unit && npm run build`
Expected: PASS (docs-only changes don't affect code, but confirm nothing regressed and `package.json` is valid).

- [ ] **Step 9: Commit**

```bash
git add README.md CONTRIBUTING.md CHANGELOG.md
git commit -m "Docs: system-browser model; supersede #7 setup/troubleshooting" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full automated gate**

Run: `npm run typecheck && npm run lint && npm run test:unit && npm run build`
Expected: PASS — typecheck/lint clean; all three unit suites pass; build emits `dist/`.

- [ ] **Step 2: Manual smoke — default (Chrome)**

Run: `node dist/index.js capture smoke-default -u https://example.com -k testkey --ttl none`
Expected: a real **Google Chrome** window opens at example.com; press ENTER in the terminal; "Session captured successfully!" prints and exit code is 0. (Per project policy, manual checks use Chrome only.)

- [ ] **Step 3: Manual smoke — forced Edge**

Run: `node dist/index.js capture smoke-edge -u https://example.com -k testkey --ttl none --browser msedge`
Expected: a **Microsoft Edge** window opens; capture completes, exit 0.

- [ ] **Step 4: Manual smoke — invalid value is a usage error (exit 1)**

Run: `node dist/index.js capture smoke-bad -u https://example.com -k testkey --browser firefox`
Expected: prints `Invalid --browser 'firefox'. Use 'chrome' or 'msedge'.` and exits **1** — no browser opens, no key prompt.

Check the exit code (bash): `echo $?` → `1`. (PowerShell: `$LASTEXITCODE` → `1`.)

- [ ] **Step 5: Clean up smoke sessions**

Run: `node dist/index.js delete smoke-default -k testkey; node dist/index.js delete smoke-edge -k testkey`
Expected: each prints a delete confirmation (ignore "not found" if a capture was aborted).

- [ ] **Step 6: Final commit (only if Step 5 left any tracked changes)**

Normally nothing to commit here. If verification surfaced a fix, commit it:

```bash
git add -A
git commit -m "Fix issues found during channel-first verification" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Resolution Chrome→Edge→error → Tasks 1 (resolver) + 2 (launcher). ✅
- `--browser` flag + `AUTHXTRACT_BROWSER` env, precedence → Tasks 1, 4. ✅
- Explicit override = no fallback; auto = fallback → Task 2 `launchWithChannel`. ✅
- Invalid value → UsageError (exit 1); no browser/un-launchable → BrowserError (exit 3) → Tasks 1, 2; verified Task 7 Step 4. ✅
- Channel-ize tests → Task 5 Step 1. ✅
- `playwright` → `playwright-core`; `@playwright/test` stays dev → Task 5 Step 2. ✅
- Remove `setup` script, `playwright install` docs, `__dirlock` troubleshooting → Tasks 5, 6. ✅
- Security model (throwaway profile) preserved → `capture.ts` keeps `fs.mkdtempSync` profile + cleanup; only the launch call changes (Task 3). ✅
- Classifier guarded by unit test against upstream drift → Task 1 (`isBrowserNotInstalledError`). ✅
- Docs: Requirements, `--browser` docs, CHANGELOG → Task 6. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output. ✅

**Type consistency:** `BrowserPreference` / `BrowserChannel` / `resolveBrowserPreference` / `launchWithChannel` / `isBrowserNotInstalledError` / `BROWSER_ENV` are defined in Task 1–2 and used identically in Tasks 3–4. `CaptureOptions.browser: BrowserPreference` (Task 3) matches the value passed in `index.ts` (Task 4). ✅

**Note (post-merge, out of plan scope):** once merged, update/close issues #7 and #8 noting the root cause was removed (system-browser model), superseding the earlier #7 docs fix.
