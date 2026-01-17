import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'child_process';

let browser: Browser | null = null;
let chromeProcess: ChildProcess | null = null;

/**
 * Launches Chrome manually and connects via CDP to avoid Windows --no-startup-window issue
 * @param url - The URL to navigate to
 * @returns Object containing the browser context and page
 */
export async function launchBrowser(url: string): Promise<{ context: BrowserContext; page: Page }> {
    console.log('[DEBUG] Launching Chrome via CDP connection...');

    const debuggingPort = 9222;

    // Find Chrome executable
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

    // Launch Chrome with remote debugging enabled
    chromeProcess = spawn(chromePath, [
        `--remote-debugging-port=${debuggingPort}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--start-maximized',
        url,  // Open URL directly
    ], {
        detached: true,
        stdio: 'ignore',
    });

    console.log('[DEBUG] Chrome started with PID:', chromeProcess.pid);

    // Wait for Chrome to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Connect to Chrome via CDP
    console.log('[DEBUG] Connecting to Chrome via CDP...');
    browser = await chromium.connectOverCDP(`http://localhost:${debuggingPort}`, {
        timeout: 30000,
    });

    console.log('[DEBUG] Connected to Chrome');

    // Get the default context (Chrome's main window)
    const contexts = browser.contexts();
    const context = contexts[0];

    if (!context) {
        throw new Error('No browser context found');
    }

    // Get the page that was opened with the URL
    const pages = context.pages();
    const page = pages[0] || await context.newPage();

    console.log('[DEBUG] Got page, waiting for navigation...');

    // Wait for the page to be ready
    await page.waitForLoadState('networkidle');

    console.log('[DEBUG] Navigation complete - page loaded');

    return { context, page };
}

/**
 * Extracts the storage state (cookies, localStorage) from a browser context
 * @param context - The browser context to extract state from
 * @returns JSON string of the storage state
 */
export async function extractStorageState(context: BrowserContext): Promise<string> {
    const state = await context.storageState();
    return JSON.stringify(state, null, 2);
}

/**
 * Closes the browser instance
 */
export async function closeBrowser(): Promise<void> {
    if (browser) {
        await browser.close();
        browser = null;
    }
    if (chromeProcess) {
        chromeProcess.kill();
        chromeProcess = null;
    }
}

/**
 * Analyzes cookies in storage state for expiration information
 * @param storageState - JSON string of the storage state
 * @returns Object with expiry info
 */
export function getSessionExpiryInfo(storageState: string): {
    hasExpiredCookies: boolean;
    earliestExpiry: Date | null;
    expiredCount: number;
} {
    try {
        const state = JSON.parse(storageState);
        const now = Date.now() / 1000;
        let earliestExpiry: number | null = null;
        let expiredCount = 0;

        for (const cookie of state.cookies || []) {
            if (cookie.expires && cookie.expires !== -1) {
                if (cookie.expires < now) {
                    expiredCount++;
                } else if (earliestExpiry === null || cookie.expires < earliestExpiry) {
                    earliestExpiry = cookie.expires;
                }
            }
        }

        return {
            hasExpiredCookies: expiredCount > 0,
            earliestExpiry: earliestExpiry ? new Date(earliestExpiry * 1000) : null,
            expiredCount,
        };
    } catch {
        return { hasExpiredCookies: false, earliestExpiry: null, expiredCount: 0 };
    }
}
