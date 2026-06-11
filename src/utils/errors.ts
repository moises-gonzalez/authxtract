/**
 * Error classification and documented exit codes.
 *
 * 0   success
 * 1   usage error (bad arguments, invalid session name, missing/empty key, unknown session)
 * 2   I/O or crypto failure (decryption, legacy/malformed files, filesystem errors)
 * 3   browser automation failure (launch, navigation, state extraction)
 * 130 interrupted (SIGINT)
 */

export const EXIT = {
    OK: 0,
    USAGE: 1,
    IO_CRYPTO: 2,
    BROWSER: 3,
    SIGINT: 130,
} as const;

/** The user invoked the tool incorrectly (bad name, empty key, unknown session, …). */
export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UsageError';
    }
}

/** A browser automation step failed (launch, navigation, storage extraction). */
export class BrowserError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BrowserError';
    }
}

/** The user interrupted an interactive flow (Ctrl+C). */
export class InterruptedError extends Error {
    constructor() {
        super('Interrupted.');
        this.name = 'InterruptedError';
    }
}

/** Map an error to its documented exit code. Unclassified errors count as I/O/runtime. */
export function exitCodeFor(error: unknown): number {
    if (error instanceof UsageError) return EXIT.USAGE;
    if (error instanceof BrowserError) return EXIT.BROWSER;
    if (error instanceof InterruptedError) return EXIT.SIGINT;
    return EXIT.IO_CRYPTO;
}
