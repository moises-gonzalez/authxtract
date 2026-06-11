/**
 * Environment variable helpers for test configuration
 */

/**
 * Whether a target URL is configured. E2E specs use this to skip gracefully
 * (instead of hard-failing) in unit/CI runs where no target exists.
 */
export function isTargetUrlSet(): boolean {
    return Boolean(process.env.TARGET_URL);
}

/**
 * Get the target URL from environment variable
 * @throws Error if TARGET_URL is not set
 */
export function getTargetUrl(): string {
    const url = process.env.TARGET_URL;

    if (!url) {
        throw new Error(
            'TARGET_URL environment variable is required.\n' +
                'Run with: npx cross-env TARGET_URL=https://example.com playwright test'
        );
    }

    return url;
}

/**
 * Get the target URL hostname for URL matching
 */
export function getTargetHostname(): RegExp {
    const url = getTargetUrl();
    return new RegExp(new URL(url).hostname);
}
