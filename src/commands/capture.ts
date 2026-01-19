/**
 * Capture command - Opens a browser for manual authentication and saves the session state
 */

import { chromium } from 'playwright';
import * as readline from 'readline';
import { saveSession } from '../utils/storage';

export interface CaptureOptions {
    url: string;
    name: string;
}

/**
 * Wait for user to press Enter in the terminal
 */
function waitForEnter(message: string): Promise<void> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question(message, () => {
            rl.close();
            resolve();
        });
    });
}

/**
 * Execute the capture command
 */
export async function capture(options: CaptureOptions): Promise<void> {
    const { url, name } = options;

    console.log(`\n🔐 authXtract - Capture Session\n`);
    console.log(`Session name: ${name}`);
    console.log(`Target URL: ${url}\n`);

    // Launch browser in headed mode
    console.log('🚀 Launching browser...\n');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to the target URL
    await page.goto(url);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 Please complete the login process in the browser.');
    console.log('   This includes any MFA, SSO, or OAuth steps.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Wait for user to complete authentication
    await waitForEnter('Press ENTER when login is complete...');

    // Extract storage state
    console.log('\n📦 Extracting authentication state...');
    const storageState = await context.storageState();

    // Save the session
    saveSession(name, storageState, url);

    // Close browser
    await browser.close();

    console.log('\n✨ Session captured successfully!');
    console.log(`\nTo use in Playwright tests:`);
    console.log(`  npx authxtract export ${name} --output ./auth-state.json\n`);
}
