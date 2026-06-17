# Contributing to authXtract

Thanks for helping improve authXtract! This is a security-sensitive tool — captured sessions are
credential-grade — so the bar for changes touching `src/utils/storage.ts` (crypto, paths,
permissions) is deliberately high.

## Development setup

```bash
git clone https://github.com/moises-gonzalez/authxtract.git
cd authxtract
npm install
npm run build
```

> authXtract uses your **system** Google Chrome or Microsoft Edge (via Playwright's `channel`) — no browser download. To run the e2e tests you need Chrome (or Edge) installed locally; GitHub's `ubuntu-latest` runners already ship Google Chrome.

> **Removing a dev install:** clear stored data first (`authxtract key clear` and delete any `.authxtract/` stores), then `npm uninstall -g authxtract` to reverse `npm link`, and delete the clone. Full steps: [Uninstall / Remove authXtract](README.md#uninstall--remove-authxtract).

Day-to-day commands:

| Command              | What it does                                            |
| -------------------- | ------------------------------------------------------- |
| `npm run dev <cmd>`  | Run the CLI via ts-node (no build needed)               |
| `npm run build`      | Compile TypeScript to `dist/`                           |
| `npm run typecheck`  | `tsc --noEmit` (strict + noUnused\* + noImplicitReturns) |
| `npm run lint`       | ESLint over the repo                                    |
| `npm run format`     | Prettier over `src/`, `tests/`, `playwright.config.ts`  |
| `npm run test:unit`  | Offline unit tests (node:test, no browser required)     |
| `npm run test:coverage` | Unit tests with a c8 coverage report (`coverage/`)   |

## Testing

- **Unit tests** (`tests/unit/`) must pass offline: `npm run test:unit`. New storage/crypto
  behavior needs unit coverage (round-trip, tamper, traversal, permissions).
- **E2E** (`tests/example.spec.ts`) runs on **Chrome only** and needs a real manual login:

  ```bash
  npm run dev capture my-app -u https://example.com/login
  npm run dev export my-app
  TARGET_URL=https://example.com npx playwright test --project=chromium
  ```

  The spec skips gracefully when `TARGET_URL` or `auth-state.json` is absent, so CI never
  hard-fails on it. Do not add other browser projects to `playwright.config.ts`.

## Pull requests

1. Branch from `main`.
2. Keep changes focused; update `CHANGELOG.md` under **Unreleased** (Keep a Changelog format).
3. Make sure the full CI gate passes locally before pushing:
   `npm run typecheck && npm run lint && npm run test:unit && npm run build && npm audit --audit-level=high`
4. PRs must keep CI green — audit findings of high/critical severity block merge.
5. Security-relevant changes (crypto, key handling, file permissions, path handling) should
   explain *why* in the PR description and update `SECURITY.md` if guarantees change.

## Security issues

Never open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md) for private
reporting.

## Releases

Releases are semver-automated via `npm version`:

1. Move the relevant `CHANGELOG.md` entries from **Unreleased** into a new version section.
2. Run `npm version patch|minor|major`:
   - `preversion` runs the quality gates (typecheck, lint, unit tests, build);
   - npm bumps `package.json` (the CLI reads its version from there at runtime) and creates the
     commit + `v*` tag;
   - `postversion` pushes the branch and tag.
3. The pushed tag triggers the release job in CI, which generates a **CycloneDX SBOM**
   (`npm sbom`), attaches it to an auto-created **GitHub Release**, and runs the npm publish
   (currently `--dry-run`; distribution is internal-first until the project goes public — when
   flipping, also enable `--provenance`, which the workflow's `id-token` permission already
   supports).
