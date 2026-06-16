# Channel-first browser acquisition for authXtract

- **Date:** 2026-06-16
- **Status:** Approved (design)
- **Related issues:** #7 (Chromium install hang), #8 ("Playwright was just installed" at first capture)

## Context

`authxtract capture` opens a real, **headed** browser so a human can complete an
interactive login (MFA/SSO/OAuth), then extracts the authenticated storage state. Today it
launches Playwright's **bundled, downloaded Chromium** (`chromium.launchPersistentContext(...)` in
`src/commands/capture.ts`). Provisioning that bundled browser is the root of a recurring failure
class on the systems this tool targets:

- The download is **package-manager dependent** (npm runs Playwright's postinstall; pnpm v10 blocks
  dependency lifecycle scripts by default), so a clean machine may never get the browser — #8.
- A **single per-user cache** (`%LOCALAPPDATA%\ms-playwright`) is shared by every Playwright version
  on the box; different versions demand different Chromium revisions, so the cache can't satisfy all
  of them (observed: `chromium-1200` for project's 1.57 vs cached `chromium-1223` for a 1.60 install).
- The CDN download **hangs/stalls** behind corporate networks, and a stale `__dirlock` makes it look
  like a silent hang — #7.

Because capture is always interactive on a desktop, a real browser (Chrome or Edge) is essentially
always present. So the durable fix is to **stop downloading a browser entirely** and launch the
system browser via Playwright's `channel`.

## Goals

- `authxtract` never downloads a browser — at runtime **or** in tests.
- Deterministic across systems and package managers (no reliance on postinstall browser downloads).
- Eliminate the shared-cache version-skew failure class rather than contain it.
- Replace Playwright's misleading "just installed… run `npx playwright install`" box with a crisp,
  on-brand, actionable error.
- Preserve the security model: throwaway, isolated `userDataDir` per capture (no ambient credentials).

## Non-goals

- Supporting headless/CI capture (capture is inherently interactive).
- A `doctor` command (the capture preflight already validates and reports the resolved browser — YAGNI).
- Per-project browser cache isolation (`PLAYWRIGHT_BROWSERS_PATH`) — moot once nothing is downloaded.
- Firefox/WebKit support (Chrome-only policy stands; Edge is the Chromium-family fallback).

## Decisions

| Fork | Decision |
|------|----------|
| Browser resolution | System **Chrome → Edge → error**. No bundled download, ever. |
| Control surface | `--browser <chrome\|msedge>` flag + `AUTHXTRACT_BROWSER` env override; default = auto-detect. |
| Test path | Channel-ize tests too: `channel: 'chrome'` in `playwright.config.ts`. |
| Runtime dependency | `playwright` → `playwright-core` (no postinstall download); `@playwright/test` stays dev-only. |
| #7 artifacts | Removed (superseded): `npm run setup`, `playwright install` docs, `__dirlock` troubleshooting. |

## Design

### Behavior & resolution

Preference precedence (mirrors the existing key-provider style): **`--browser` flag → `AUTHXTRACT_BROWSER`
env → auto-detect**.

- **Auto-detect:** try `channel: 'chrome'`; if that browser isn't installed, try `channel: 'msedge'`;
  if neither, fail.
- **Explicit override** (`chrome` or `msedge`): use **only** that channel — no fallback.
- **Invalid override value:** `UsageError` (exit **1**): `Invalid --browser '<v>'. Use 'chrome' or 'msedge'.`
- **No usable browser:** `BrowserError` (exit **3**), e.g.:
  - auto: `No supported browser found. authXtract uses your system Google Chrome or Microsoft Edge — install Google Chrome (https://www.google.com/chrome/) and try again.`
  - explicit: `Google Chrome was requested (--browser chrome) but isn't installed. Install it, or use --browser msedge.`

Security model is unchanged: a fresh `fs.mkdtempSync` `userDataDir` per capture; we change only the
browser *binary* (system channel), not the *profile* isolation.

### Components

- **New `src/utils/browser.ts`** — one bounded unit, two responsibilities:
  - `resolveBrowserPreference(flag: string | undefined, env: NodeJS.ProcessEnv): BrowserPreference`
    — validates the override, returns either a fixed `channel` or an `auto` marker; throws `UsageError`
    on an invalid value. Pure/synchronous → easily unit-tested offline.
  - `launchWithChannel(profileDir: string, pref: BrowserPreference): Promise<BrowserContext>`
    — attempts the channel(s) in order, classifies Playwright's "browser is not installed" error to
    drive fallback, and throws a `BrowserError` with the on-brand message when the candidates are
    exhausted. Other launch failures pass through as a generic browser error.
  - A small exported helper `isBrowserNotInstalledError(err): boolean` so the classifier can be unit-tested
    against known Playwright messages.
- **`src/commands/capture.ts`** — import `chromium` from `playwright-core`; replace the inline
  `browserStep('Failed to launch browser', () => chromium.launchPersistentContext(profileDir, { headless: false }))`
  with `launchWithChannel(profileDir, pref)`. Everything downstream (page, `goto`, `storageState`,
  SIGINT handling, `removeProfileDir`) is untouched. `CaptureOptions` gains a resolved `pref`.
- **`src/index.ts`** — add `--browser <chrome|msedge>` to the `capture` command; read
  `AUTHXTRACT_BROWSER`; call `resolveBrowserPreference` and pass the result into `capture`.

### Dependencies & build

- `dependencies`: replace `playwright` with `playwright-core` (same version range as `@playwright/test`,
  currently `^1.57.0`). `playwright-core` launches system channels and performs **no** browser download.
- `devDependencies`: keep `@playwright/test` (brings its own core for the test runner).
- `playwright.config.ts`: add `channel: 'chrome'` to the `chromium` project's `use`.
- Remove the `setup` npm script.

### Docs (supersede #7)

- **README** — Requirements: "Google Chrome or Microsoft Edge installed on the system" (drop "Chromium
  via Playwright"). Installation: `npm install` + `npm run build` only (drop `npm run setup`). Remove the
  `__dirlock` Troubleshooting subsection. Document `--browser` / `AUTHXTRACT_BROWSER`.
- **CONTRIBUTING** — Development setup drops `npm run setup`; note contributors need Chrome (or Edge)
  installed to run e2e tests; remove the `npm run setup` table row and the #7 troubleshooting pointer.
- **CHANGELOG** — `[Unreleased]`: Added (`--browser`/env, system-channel launching); Changed
  (`playwright` → `playwright-core`; tests use system Chrome); Removed (`npm run setup`,
  `playwright install` steps). Note it resolves #7 and #8 by removing their root cause.

### Error handling

All browser-resolution failures map to existing exit codes via `src/utils/errors.ts`: invalid override
→ `UsageError` (1); no usable / un-launchable browser → `BrowserError` (3). No new exit codes.

### Testing

- **Unit (offline, `tests/unit/` node:test style):**
  - `resolveBrowserPreference` — flag wins over env; env over default; valid values map; invalid → `UsageError`.
  - `isBrowserNotInstalledError` — known Playwright "Chromium distribution 'chrome' is not found" /
    "is not installed" messages → `true`; an unrelated error → `false`. (Guards against upstream message drift.)
- **e2e:** `playwright.config.ts` now channel-based; specs remain skip-gated on `TARGET_URL`/`auth-state.json`,
  so CI is unaffected (`ubuntu-latest` ships `google-chrome-stable` if ever un-gated).
- **Manual:** `authxtract capture …` opens system Chrome; `--browser msedge` opens Edge;
  `AUTHXTRACT_BROWSER=chrome`; bogus `--browser xyz` → exit 1; hide Chrome to see the exit-3 message.

## Risks

- **No public "is channel installed?" API.** `launchWithChannel` relies on matching Playwright's
  not-installed error text to decide fallback. Robust enough, but coupled to `playwright-core`; a major
  Playwright bump warrants re-checking the classifier. Mitigated by the `isBrowserNotInstalledError` unit
  test using the known message.
- **Edge-as-fallback semantics.** Edge is Chromium-family and ubiquitous on Windows; treating it as a
  valid fallback is a deliberate widening of the literal "Chrome-only" wording (documented in Requirements).

## Out of scope / future

- Optional bundled-Chromium mode for headless/CI use (could return as `--browser chromium` later if a
  non-interactive use case appears).
