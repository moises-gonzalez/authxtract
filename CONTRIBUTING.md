# Contributing to authXtract

Thanks for helping improve authXtract! This is a security-sensitive tool — captured sessions are
credential-grade — so the bar for changes touching `src/utils/storage.ts` (crypto, paths,
permissions) is deliberately high.

## Development setup

```bash
git clone https://github.com/moises-gonzalez/authxtract.git
cd authxtract
npm install
npx playwright install chromium   # Chromium only — Chrome-only policy
npm run build
```

Day-to-day commands:

| Command              | What it does                                            |
| -------------------- | ------------------------------------------------------- |
| `npm run dev <cmd>`  | Run the CLI via ts-node (no build needed)               |
| `npm run build`      | Compile TypeScript to `dist/`                           |
| `npm run typecheck`  | `tsc --noEmit` (strict + noUnused\* + noImplicitReturns) |
| `npm run lint`       | ESLint over the repo                                    |
| `npm run format`     | Prettier over `src/`, `tests/`, `playwright.config.ts`  |
| `npm run test:unit`  | Offline unit tests (node:test, no browser required)     |

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

- Versioning is semver; the project stays `0.x` until the feature/test set stabilizes.
- Update `CHANGELOG.md`, bump `package.json` and the CLI `.version(...)` in `src/index.ts`
  together.
- Pushing a `v*` tag triggers the tag-gated publish job (currently `npm publish --dry-run`;
  distribution is internal-first until the project goes public).
