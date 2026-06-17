/**
 * System-browser acquisition. authXtract launches the user's installed Chrome
 * or Edge via Playwright's `channel` — it never downloads a browser.
 *
 * Preference precedence (mirrors key-provider.ts): --browser flag →
 * AUTHXTRACT_BROWSER env → auto-detect (Chrome, then Edge).
 */

import { chromium, type BrowserContext } from 'playwright-core';
import { BrowserError, UsageError } from './errors';
import { logger } from './logger';

export const BROWSER_ENV = 'AUTHXTRACT_BROWSER';

export type BrowserChannel = 'chrome' | 'msedge';

/** A resolved choice: a specific channel, or auto-detect (Chrome → Edge). */
export type BrowserPreference =
    | { kind: 'channel'; channel: BrowserChannel; source: 'flag' | 'env' }
    | { kind: 'auto' };

const VALID_CHANNELS: readonly BrowserChannel[] = ['chrome', 'msedge'];
const AUTO_ORDER: readonly BrowserChannel[] = ['chrome', 'msedge'];
const CHANNEL_LABELS: Record<BrowserChannel, string> = {
    chrome: 'Google Chrome',
    msedge: 'Microsoft Edge',
};

function normalizeChannel(value: string): BrowserChannel | null {
    const v = value.trim().toLowerCase();
    return (VALID_CHANNELS as readonly string[]).includes(v) ? (v as BrowserChannel) : null;
}

/**
 * Resolve which browser to use. Throws UsageError (exit 1) on an invalid value.
 */
export function resolveBrowserPreference(
    flag: string | undefined,
    env: NodeJS.ProcessEnv = process.env
): BrowserPreference {
    if (flag !== undefined) {
        const channel = normalizeChannel(flag);
        if (channel === null) {
            throw new UsageError(`Invalid --browser '${flag}'. Use 'chrome' or 'msedge'.`);
        }
        return { kind: 'channel', channel, source: 'flag' };
    }

    const envValue = env[BROWSER_ENV];
    if (envValue !== undefined && envValue.trim().length > 0) {
        const channel = normalizeChannel(envValue);
        if (channel === null) {
            throw new UsageError(`Invalid ${BROWSER_ENV} '${envValue}'. Use 'chrome' or 'msedge'.`);
        }
        return { kind: 'channel', channel, source: 'env' };
    }

    return { kind: 'auto' };
}

/**
 * Does this launch error mean "the requested browser channel isn't installed",
 * as opposed to some other launch failure? Playwright-core reports a distinctive
 * message ("... distribution 'chrome' is not found ...") for a missing channel.
 */
export function isBrowserNotInstalledError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /is not found|not installed|Executable doesn't exist|Run "npx playwright install/i.test(message);
}

function launchOne(profileDir: string, channel: BrowserChannel): Promise<BrowserContext> {
    return chromium.launchPersistentContext(profileDir, { headless: false, channel });
}

function wrapLaunchError(error: unknown): BrowserError {
    return new BrowserError(
        `Failed to launch browser: ${error instanceof Error ? error.message : String(error)}`
    );
}

/**
 * Launch a persistent context using the resolved preference. For an explicit
 * channel, try only that one; for auto, try Chrome then Edge. A "not installed"
 * outcome yields an actionable BrowserError (exit 3); any other launch failure
 * is surfaced as a generic browser error.
 */
export async function launchWithChannel(
    profileDir: string,
    pref: BrowserPreference
): Promise<BrowserContext> {
    if (pref.kind === 'channel') {
        try {
            return await launchOne(profileDir, pref.channel);
        } catch (error) {
            if (isBrowserNotInstalledError(error)) {
                const other: BrowserChannel = pref.channel === 'chrome' ? 'msedge' : 'chrome';
                throw new BrowserError(
                    `${CHANNEL_LABELS[pref.channel]} was requested (--browser ${pref.channel}) ` +
                        `but isn't installed. Install it, or use --browser ${other}.`
                );
            }
            throw wrapLaunchError(error);
        }
    }

    for (const channel of AUTO_ORDER) {
        try {
            return await launchOne(profileDir, channel);
        } catch (error) {
            if (isBrowserNotInstalledError(error)) {
                logger.verbose(`${CHANNEL_LABELS[channel]} not found; trying the next browser.`);
                continue;
            }
            throw wrapLaunchError(error);
        }
    }

    throw new BrowserError(
        'No supported browser found. authXtract uses your system Google Chrome or Microsoft Edge — ' +
            'install Google Chrome (https://www.google.com/chrome/) and try again.'
    );
}
