/**
 * Environment variable helpers for test configuration
 */

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
