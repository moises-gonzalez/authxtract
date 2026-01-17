import { test, expect } from '@playwright/test';

// Get URL from environment variable (passed via CLI)
const targetUrl = process.env.TARGET_URL;

test('capture page', async ({ page }) => {
  // Validate URL is provided
  if (!targetUrl) {
    throw new Error('TARGET_URL environment variable is required. Run with: TARGET_URL=https://example.com npx playwright test');
  }

  await page.goto(targetUrl);

  // Confirm page loaded successfully
  await expect(page).toHaveURL(new RegExp(new URL(targetUrl).hostname));

  await page.close();
});
