/**
 * Unit tests for browser preference resolution and the "browser not installed"
 * error classifier. Offline — no Playwright or real browser required.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    BROWSER_ENV,
    isBrowserNotInstalledError,
    resolveBrowserPreference,
} from '../../src/utils/browser';
import { UsageError } from '../../src/utils/errors';

test('browser: --browser flag wins over env and maps to a channel', () => {
    const pref = resolveBrowserPreference('msedge', { [BROWSER_ENV]: 'chrome' });
    assert.deepEqual(pref, { kind: 'channel', channel: 'msedge', source: 'flag' });
});

test('browser: AUTHXTRACT_BROWSER env is used (case-insensitive) when no flag is given', () => {
    const pref = resolveBrowserPreference(undefined, { [BROWSER_ENV]: 'CHROME' });
    assert.deepEqual(pref, { kind: 'channel', channel: 'chrome', source: 'env' });
});

test('browser: with no flag or env, the preference is auto-detect', () => {
    assert.deepEqual(resolveBrowserPreference(undefined, {}), { kind: 'auto' });
});

test('browser: a blank env value falls through to auto-detect', () => {
    assert.deepEqual(resolveBrowserPreference(undefined, { [BROWSER_ENV]: '   ' }), { kind: 'auto' });
});

test('browser: an invalid --browser value is a usage error', () => {
    assert.throws(() => resolveBrowserPreference('firefox', {}), UsageError);
});

test('browser: an invalid AUTHXTRACT_BROWSER value is a usage error', () => {
    assert.throws(() => resolveBrowserPreference(undefined, { [BROWSER_ENV]: 'safari' }), UsageError);
});

test('browser: isBrowserNotInstalledError recognizes the channel-not-found message', () => {
    const notInstalled = new Error(
        "browserType.launchPersistentContext: Chromium distribution 'chrome' is not found at " +
            '/opt/google/chrome/chrome\nRun "npx playwright install chrome"'
    );
    assert.equal(isBrowserNotInstalledError(notInstalled), true);
});

test('browser: isBrowserNotInstalledError ignores unrelated launch failures', () => {
    const other = new Error(
        'browserType.launchPersistentContext: Target page, context or browser has been closed'
    );
    assert.equal(isBrowserNotInstalledError(other), false);
});

test('browser: isBrowserNotInstalledError ignores a navigation timeout', () => {
    assert.equal(
        isBrowserNotInstalledError(new Error('Navigation timeout of 30000 ms exceeded')),
        false
    );
});
