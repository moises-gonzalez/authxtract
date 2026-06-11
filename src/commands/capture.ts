/**
 * Capture command - Opens a browser for manual authentication and saves the session state
 */

import { chromium } from 'playwright';
import * as readline from 'readline';
import { saveSession } from '../utils/storage';
import { logger } from '../utils/logger';
import { BrowserError, EXIT, InterruptedError } from '../utils/errors';

export interface CaptureOptions {
    url: string;
    name: string;
    key?: string;
}

/**
 * Wait for user to press Enter in the terminal. Rejects with InterruptedError
 * on Ctrl+C (readline swallows SIGINT while a question is pending).
 */
function waitForEnter(message: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stderr,
        });

        rl.question(message, () => {
            rl.close();
            resolve();
        });
        rl.on('SIGINT', () => {
            rl.close();
            reject(new InterruptedError());
        });
    });
}

/** Wrap a browser operation so failures classify as BrowserError (exit code 3). */
async function browserStep<T>(description: string, action: () => Promise<T>): Promise<T> {
    try {
        return await action();
    } catch (error) {
        throw new BrowserError(`${description}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Execute the capture command
 */
export async function capture(options: CaptureOptions): Promise<void> {
    const { url, name, key } = options;

    logger.info('authXtract — capture session', '🔐');
    logger.info(`Session name: ${name}`);
    logger.info(`Target URL: ${url}`);

    logger.info('Launching browser...', '🚀');
    const browser = await browserStep('Failed to launch browser', () => chromium.launch({ headless: false }));

    // Ctrl+C outside the readline prompt: close the browser, write nothing, exit 130.
    const onSigint = (): void => {
        logger.error('Interrupted — closing browser without saving.');
        void browser
            .close()
            .catch(() => undefined)
            .finally(() => process.exit(EXIT.SIGINT));
    };
    process.once('SIGINT', onSigint);

    try {
        const context = await browserStep('Failed to create browser context', () => browser.newContext());
        const page = await browserStep('Failed to open page', () => context.newPage());
        await browserStep(`Failed to navigate to ${url}`, () => page.goto(url));

        logger.info('Complete the login in the browser, including any MFA, SSO, or OAuth steps.', '📝');
        await waitForEnter('Press ENTER when login is complete...');

        logger.info('Extracting authentication state...', '📦');
        const storageState = await browserStep('Failed to extract storage state', () =>
            context.storageState()
        );

        saveSession(name, storageState, url, key);
    } finally {
        // Always release the browser, whatever happened above (error, Ctrl+C, success).
        process.removeListener('SIGINT', onSigint);
        await browser.close().catch(() => undefined);
    }

    logger.success('Session captured successfully!');
    logger.info(`Export it for Playwright with: authxtract export ${name} --output ./auth-state.json`);
}
