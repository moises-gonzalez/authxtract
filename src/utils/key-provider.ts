/**
 * Key providers — where the encryption passphrase comes from.
 *
 * The key source is abstracted behind KeyProvider so OS keychain / KMS
 * providers (Phase 2) can slot in later without changing callers.
 */

import * as readline from 'readline';
import { Writable } from 'stream';
import { logger } from './logger';

export interface KeyProvider {
    /** Identifies the key source (for warnings/diagnostics). */
    readonly source: 'flag' | 'env' | 'prompt';
    getPassphrase(): Promise<string>;
}

export function warnKeyFlagDeprecated(): void {
    logger.warn(
        '--key is deprecated: it exposes the key in shell history and process lists. ' +
            'Use the AUTHXTRACT_KEY environment variable (secret-managed in CI) or the interactive prompt instead.'
    );
}

/** Key passed via the deprecated --key flag. */
export class FlagKeyProvider implements KeyProvider {
    readonly source = 'flag' as const;

    constructor(private readonly key: string) {}

    async getPassphrase(): Promise<string> {
        warnKeyFlagDeprecated();
        return this.key;
    }
}

/** Key from the AUTHXTRACT_KEY environment variable (recommended for CI). */
export class EnvKeyProvider implements KeyProvider {
    readonly source = 'env' as const;

    async getPassphrase(): Promise<string> {
        return process.env.AUTHXTRACT_KEY ?? '';
    }
}

/** Interactive prompt with masked input — typed characters are never echoed. */
export class PromptKeyProvider implements KeyProvider {
    readonly source = 'prompt' as const;

    async getPassphrase(): Promise<string> {
        logger.info('Encryption key required.', '🔑');
        return promptMasked('Enter encryption key (input hidden): ');
    }
}

/** Resolve the key source: --key flag (deprecated) → env var → masked prompt. */
export function resolveKeyProvider(flagKey?: string): KeyProvider {
    if (flagKey !== undefined) {
        return new FlagKeyProvider(flagKey);
    }
    if (process.env.AUTHXTRACT_KEY) {
        return new EnvKeyProvider();
    }
    return new PromptKeyProvider();
}

/**
 * Read a line from stdin without echoing it. Readline's echo goes through the
 * `output` stream, so a mutable sink that drops writes while muted hides the
 * typed key; the prompt text itself is written before muting kicks in.
 * The prompt goes to stderr so redirected stdout (e.g. `export --stdout > f`)
 * never captures prompt text.
 */
function promptMasked(question: string): Promise<string> {
    return new Promise((resolve) => {
        let muted = false;
        const output = new Writable({
            write(chunk, encoding, callback) {
                if (!muted) {
                    process.stderr.write(chunk, encoding);
                }
                callback();
            },
        });

        const rl = readline.createInterface({
            input: process.stdin,
            output,
            terminal: process.stdin.isTTY === true,
        });

        let answered = false;
        rl.question(question, (answer) => {
            answered = true;
            muted = false;
            rl.close();
            process.stderr.write('\n'); // readline's own newline echo was muted
            resolve(answer.trim());
        });
        // stdin closed without an answer (EOF): resolve empty, callers reject it.
        rl.on('close', () => {
            if (!answered) {
                muted = false;
                process.stderr.write('\n');
                resolve('');
            }
        });
        muted = true; // everything echoed from here on is the typed key
    });
}
