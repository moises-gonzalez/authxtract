# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/moises-gonzalez/authxtract/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/moises-gonzalez/authxtract/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/moises-gonzalez/authxtract/releases/tag/v0.1.0
