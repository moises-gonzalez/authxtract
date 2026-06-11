# Security Policy

authXtract stores **credential-grade data**: captured browser sessions contain cookies and
session/bearer tokens that are password-equivalent for the target application. This document
describes what the tool protects against, what it deliberately does not, and how to report
vulnerabilities.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.2.x   | ✅        |
| < 0.2   | ❌ (insecure legacy CBC format — re-capture sessions) |

## Threat model

### What authXtract protects

- **Session state at rest.** Stored sessions in `.authxtract/sessions/` are encrypted with
  AES-256-GCM. An attacker who obtains the files (backup, sync folder, lost laptop) cannot read
  them without the passphrase.
- **Tampering.** GCM is authenticated encryption: any modification of a stored session causes
  decryption to fail loudly. Tampered files are never silently accepted.
- **Brute force against the passphrase.** Keys are derived via scrypt with a fresh random
  16-byte salt per file, so attacks don't parallelize across files and rainbow tables don't apply.
  A weak passphrase is still a weak passphrase — use a long random one.
- **Path traversal.** Session names are strictly validated (`[A-Za-z0-9._-]{1,64}`, no `..`) and
  resolved paths are asserted to stay inside the session store.
- **Shoulder surfing / scrollback.** The interactive key prompt masks input. Decryption errors are
  generic by default (no crypto internals) — pass `--verbose` for diagnostics.
- **Loose file permissions (POSIX).** The store is created `0700`; session files and exports are
  written `0600`. On Windows, NTFS profile ACLs apply instead.

### What authXtract does NOT protect

- **Exported state.** `export` writes (or streams with `--stdout`) **decrypted** JSON by design —
  that is its purpose. The exported file is password-equivalent: anyone holding it can use the
  session until the tokens expire or are revoked. Delete it after use; never commit it.
- **A compromised machine.** Malware, keyloggers, or another user able to read your shell
  environment (`AUTHXTRACT_KEY`) or memory defeats any local encryption.
- **The key itself.** Anyone with your passphrase and the store can decrypt everything. The
  deprecated `--key` flag additionally leaks the key into shell history and process lists — use
  the env var (secret-managed in CI) or the masked prompt.
- **Server-side token lifetime.** Encryption does not shorten the life of captured tokens. If a
  session leaks, revoke it at the identity provider / application.
- **The browser profile during capture.** Capture launches a real, headed Chromium for you to log
  in; whatever you do in that window is between you and the target site.

## Handling guidance

- Provide the passphrase via `AUTHXTRACT_KEY` from a secret manager in CI, or type it into the
  masked prompt locally. Treat `--key` as deprecated.
- Treat `auth-state.json` (or any `--output` target) as a credential: short-lived, untracked,
  deleted after the test run.
- Sessions captured before the v2 format (AES-256-GCM) are rejected — re-run `capture`.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Report privately:

- Email: <moises.gonzalez@simpat.tech>
- Or use GitHub's private vulnerability reporting on this repository, if enabled.

Include reproduction steps and impact. You should receive an acknowledgement within 5 business
days. Please allow a reasonable window for a fix before any public disclosure.
