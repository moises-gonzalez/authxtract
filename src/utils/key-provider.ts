/**
 * Key providers — where the encryption passphrase comes from.
 *
 * Resolution order: --key flag (deprecated) → AUTHXTRACT_KEY env var →
 * AUTHXTRACT_KEY_CMD (pluggable KMS/Vault/secret-manager command) →
 * OS keychain (`authxtract key store`) → masked interactive prompt.
 */

import { execSync } from 'child_process';
import * as readline from 'readline';
import { Writable } from 'stream';
import { logger } from './logger';
import { UsageError } from './errors';
import { keychainName, tryReadKeychainKey } from './keychain';

export const KEY_CMD_ENV = 'AUTHXTRACT_KEY_CMD';

export interface KeyProvider {
    /** Identifies the key source (for warnings/diagnostics). */
    readonly source: 'flag' | 'env' | 'command' | 'keychain' | 'prompt';
    getPassphrase(): Promise<string>;
}

export function warnKeyFlagDeprecated(): void {
    logger.warn(
        '--key is deprecated: it exposes the key in shell history and process lists. ' +
            'Use the AUTHXTRACT_KEY environment variable (secret-managed in CI), ' +
            '`authxtract key store`, or the interactive prompt instead.'
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

/**
 * Key produced by an external command (AUTHXTRACT_KEY_CMD). This is the
 * pluggable KMS/Vault integration point — e.g.
 *   AUTHXTRACT_KEY_CMD="vault kv get -field=key secret/authxtract"
 *   AUTHXTRACT_KEY_CMD="aws ssm get-parameter --name /authxtract/key --with-decryption --query Parameter.Value --output text"
 *   AUTHXTRACT_KEY_CMD="op read op://vault/authxtract/password"
 * The command's stdout (trimmed) is the passphrase.
 */
export class CommandKeyProvider implements KeyProvider {
    readonly source = 'command' as const;

    constructor(private readonly command: string) {}

    async getPassphrase(): Promise<string> {
        logger.verbose(`Resolving encryption key via ${KEY_CMD_ENV}`);
        let output: string;
        try {
            output = execSync(this.command, {
                encoding: 'utf8',
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'inherit'],
            });
        } catch (error) {
            throw new UsageError(
                `${KEY_CMD_ENV} command failed${error instanceof Error ? `: ${error.message}` : '.'}`
            );
        }
        const key = output.trim();
        if (key.length === 0) {
            throw new UsageError(`${KEY_CMD_ENV} command produced no output.`);
        }
        return key;
    }
}

/** Key previously stored in the OS keychain via `authxtract key store`. */
export class KeychainKeyProvider implements KeyProvider {
    readonly source = 'keychain' as const;

    constructor(private readonly key: string) {}

    async getPassphrase(): Promise<string> {
        logger.verbose(`Using encryption key from the ${keychainName()}`);
        return this.key;
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

/**
 * Resolve the key source. Precedence: explicit flag, then environment, then
 * key command, then OS keychain, then prompt — explicit beats ambient, and
 * per-shell config (env) beats the per-user keychain.
 */
export function resolveKeyProvider(flagKey?: string): KeyProvider {
    if (flagKey !== undefined) {
        return new FlagKeyProvider(flagKey);
    }
    if (process.env.AUTHXTRACT_KEY) {
        return new EnvKeyProvider();
    }
    const keyCmd = process.env[KEY_CMD_ENV];
    if (keyCmd && keyCmd.trim().length > 0) {
        return new CommandKeyProvider(keyCmd);
    }
    const stored = tryReadKeychainKey();
    if (stored) {
        return new KeychainKeyProvider(stored);
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
export function promptMasked(question: string): Promise<string> {
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
