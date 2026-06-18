# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-06-18

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
- **Uninstall / removal docs**: a README section (and CONTRIBUTING pointer) documenting how to fully
  remove authXtract — clearing the keychain, deleting the `.authxtract` store(s) and exported files,
  and uninstalling the global command. Addresses #9.

### Removed

- The `npm run setup` script and the `npx playwright install chromium` install/troubleshooting steps —
  nothing is downloaded anymore.

## [0.3.0] - 2026-06-10

Polish & scale release (improvement plan Phase 2).

### Added

- **OS keychain integration**: `authxtract key store|status|clear` manages the passphrase in the
  Windows Credential Manager, macOS Keychain, or Secret Service (libsecret). Commands pick the
  stored key up automatically when no env var is set.
- **Pluggable KMS/Vault provider**: `AUTHXTRACT_KEY_CMD` runs any command (Vault, AWS KMS/SSM,
  1Password, …) whose stdout becomes the passphrase. Resolution order is now
  `--key` → `AUTHXTRACT_KEY` → `AUTHXTRACT_KEY_CMD` → OS keychain → masked prompt.
- **Session TTL**: captures set `expiresAt` (default `--ttl 24h`; `m`/`h`/`d` units or `none`).
  Expired sessions are refused on load/export with a re-capture message and flagged as
  `EXPIRED` in `list`.
- **`--storage-dir <path>`** global flag relocates the session store (default remains
  `./.authxtract` relative to the working directory); empty `list` output now names the
  directory it looked in.
- **Coverage reporting**: `npm run test:coverage` (c8); CI uploads the report as an artifact.
- **Release automation**: `npm version patch|minor|major` runs the quality gates, tags, and
  pushes; the tag-gated CI job generates a CycloneDX SBOM, creates a GitHub Release with the
  SBOM attached, and runs the (dry-run) npm publish with provenance wiring ready.

### Changed

- **Browser profile isolation**: capture now launches Chromium with a fresh temporary
  `userDataDir` (deleted after capture) instead of the default ephemeral context, so it can
  never observe ambient local browser credentials.
- The CLI reads its version from `package.json` at runtime (no more hardcoded drift).

## [0.2.0] - 2026-06-10

Security-hardening and production-readiness release (improvement plan Phases 0 & 1).
Sessions captured with 0.1.x use the legacy CBC format and are rejected — re-run `capture`.

### Security

- Switched session encryption from unauthenticated AES-256-CBC to **AES-256-GCM**; any
  tampering or wrong key now fails decryption loudly instead of silently.
- Added **scrypt key derivation** with a fresh random 16-byte salt per file; passphrases may be
  any non-empty length (the old exactly-32-characters rule is gone).
- Introduced a versioned on-disk envelope (`{v:2, alg, kdf, salt, iv, tag, ct}`); legacy v1
  files are detected and rejected with a re-capture message.
- Fixed a **path traversal** in session names: names are validated against a strict allowlist
  and resolved paths are asserted to stay inside `.authxtract/sessions/`.
- The interactive key prompt now **masks input**; `--key` is deprecated (leaks into shell
  history/process lists) and prints a runtime warning.
- Store directories are created `0700` and session/export files `0600` on POSIX.
- Decrypted session data is shape-validated before use; decryption errors are generic by
  default with details available under `--verbose`.
- `export` warns that the output is password-equivalent and supports `--stdout` to avoid
  persisting decrypted state to disk.

### Added

- Offline unit test suite (`npm run test:unit`, zero new dependencies via `node:test`).
- GitHub Actions CI: typecheck → lint → unit tests → build → `npm audit --audit-level=high`,
  plus a tag-gated (dry-run) publish job.
- ESLint (flat config) + Prettier + `.editorconfig`; `lint`, `format`, `typecheck` scripts.
- Central logger with TTY-aware output (plain text, no emoji, in non-interactive/CI runs),
  `--json` for `list`/`export`, global `--quiet`/`--verbose` flags, and documented exit codes
  (0 ok · 1 usage · 2 I/O/crypto · 3 browser · 130 SIGINT).
- Governance docs: `LICENSE` (ISC), `SECURITY.md`, `CONTRIBUTING.md`, this changelog.
- Publish guards in `package.json`: `files` allowlist, `engines.node >= 18`, `prepublishOnly`
  build, full author/repository metadata.

### Changed

- `capture` now wraps the browser lifecycle in `try/finally` and handles Ctrl+C: the browser
  is always closed and no partial session is written (exit code 130 on interrupt).
- E2E spec asserts the post-login URL is not a login/sign-in page (hostname-only matching
  passed even on login redirects) and skips gracefully when `TARGET_URL` or
  `auth-state.json` is missing.
- Playwright config runs **Chromium only** (Chrome-only policy); `firefox` project removed.
- Version restarted at `0.2.0` (pre-1.0 until the feature/test set stabilizes).

## [0.1.0] - 2026-01-17

### Added

- Initial release: `capture` (headed Chromium, manual MFA/SSO login), `list`, `export`,
  `delete`; sessions stored AES-256-CBC encrypted in `.authxtract/sessions/`.

[Unreleased]: https://github.com/moises-gonzalez/authxtract/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/moises-gonzalez/authxtract/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/moises-gonzalez/authxtract/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/moises-gonzalez/authxtract/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/moises-gonzalez/authxtract/releases/tag/v0.1.0
