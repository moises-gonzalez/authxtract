import { test, expect } from '@playwright/test';
import { getTargetUrl, getTargetHostname } from './helpers/env';

test('capture page', async ({ page }) => {
  const targetUrl = getTargetUrl();

  await page.goto(targetUrl);

  // Confirm page loaded successfully
  await expect(page).toHaveURL(getTargetHostname());

  // await page.close();
});
