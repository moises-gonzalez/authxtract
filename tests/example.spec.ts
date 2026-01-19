import { test, expect } from '@playwright/test';
import { getTargetUrl, getTargetHostname } from './helpers/env';

// Use captures session
test.use({
  storageState: './auth-state.json',
});

test('Authenticated page access', async ({ page }) => {
  const targetUrl = getTargetUrl();

  await page.goto(targetUrl);

  // Confirm page loaded successfully
  await expect(page).toHaveURL(getTargetHostname());

  // await page.close();
});
