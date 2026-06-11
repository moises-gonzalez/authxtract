import * as fs from 'fs';
import { test, expect } from '@playwright/test';
import { getTargetUrl, getTargetHostname } from './helpers/env';

const AUTH_STATE_PATH = './auth-state.json';

// Skip (not fail) when prerequisites are missing so unit/CI runs stay green.
test.skip(!process.env.TARGET_URL, 'TARGET_URL env var not set — E2E needs a target site');
test.skip(
    !fs.existsSync(AUTH_STATE_PATH),
    'auth-state.json not found — run `authxtract export <name>` first'
);

// Use captured session
test.use({
    storageState: AUTH_STATE_PATH,
});

test('Authenticated page access', async ({ page }) => {
    const targetUrl = getTargetUrl();

    await page.goto(targetUrl);

    // Still on the target site...
    await expect(page).toHaveURL(getTargetHostname());

    // ...and not bounced to a login page. A hostname-only check passes even when
    // the app redirects an unauthenticated visitor back to its login screen.
    await expect(page).not.toHaveURL(/log[io]n|sign-?in/i);
});
