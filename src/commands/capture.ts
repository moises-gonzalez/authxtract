/**
 * Capture command - Opens a browser for manual authentication and saves the session state
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { saveSession } from '../utils/storage';
import { logger } from '../utils/logger';
import { BrowserError, EXIT, InterruptedError } from '../utils/errors';
import { expiresAtFrom } from '../utils/ttl';

export interface CaptureOptions {
    url: string;
    name: string;
    key?: string;
    /** Session lifetime in ms; null disables expiry. */
    ttlMs: number | null;
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

/** Remove the temporary browser profile; best-effort (Chromium may lag releasing locks). */
function removeProfileDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
        logger.warn(`Could not remove temporary browser profile ${dir} — delete it manually.`);
        logger.verbose('Profile cleanup failed', error);
    }
}

/**
 * Execute the capture command
 */
export async function capture(options: CaptureOptions): Promise<void> {
    const { url, name, key, ttlMs } = options;
    const expiresAt = expiresAtFrom(ttlMs);

    logger.info('authXtract — capture session', '🔐');
    logger.info(`Session name: ${name}`);
    logger.info(`Target URL: ${url}`);
    logger.info(
        expiresAt ? `Session expires: ${expiresAt} (change with --ttl)` : 'Session expiry: none (--ttl none)'
    );

    // Profile isolation: a fresh throwaway userDataDir per capture, so the
    // browser can never see (or sweep) ambient local browser credentials.
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authxtract-profile-'));
    logger.info('Launching browser with a temporary, isolated profile...', '🚀');

    const context = await browserStep('Failed to launch browser', () =>
        chromium.launchPersistentContext(profileDir, { headless: false })
    ).catch((error) => {
        removeProfileDir(profileDir);
        throw error;
    });

    // Ctrl+C outside the readline prompt: close the browser, write nothing, exit 130.
    const onSigint = (): void => {
        logger.error('Interrupted — closing browser without saving.');
        void context
            .close()
            .catch(() => undefined)
            .finally(() => {
                removeProfileDir(profileDir);
                process.exit(EXIT.SIGINT);
            });
    };
    process.once('SIGINT', onSigint);

    try {
        const page =
            context.pages()[0] ?? (await browserStep('Failed to open page', () => context.newPage()));
        await browserStep(`Failed to navigate to ${url}`, () => page.goto(url));

        logger.info('Complete the login in the browser, including any MFA, SSO, or OAuth steps.', '📝');
        await waitForEnter('Press ENTER when login is complete...');

        logger.info('Extracting authentication state...', '📦');
        const storageState = await browserStep('Failed to extract storage state', () =>
            context.storageState()
        );

        saveSession(name, storageState, url, key, { expiresAt });
    } finally {
        // Always release the browser and its throwaway profile, whatever happened above.
        process.removeListener('SIGINT', onSigint);
        await context.close().catch(() => undefined);
        removeProfileDir(profileDir);
    }

    logger.success('Session captured successfully!');
    logger.info(`Export it for Playwright with: authxtract export ${name} --output ./auth-state.json`);
}
