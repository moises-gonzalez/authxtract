#!/usr/bin/env node

/**
 * authXtract CLI - Securely extract and manage authentication state
 *
 * Exit codes: 0 success · 1 usage · 2 I/O or crypto · 3 browser · 130 interrupted
 */

import { Command, Option } from 'commander';
import { capture } from './commands/capture';
import { resolveKeyProvider, warnKeyFlagDeprecated } from './utils/key-provider';
import { validateSessionName } from './utils/storage';
import { logger } from './utils/logger';
import { InterruptedError, UsageError, exitCodeFor } from './utils/errors';

const program = new Command();

const DEPRECATED_KEY_HELP =
    '[DEPRECATED] Encryption key. Prefer the AUTHXTRACT_KEY env var (CI) or the masked interactive prompt.';

/**
 * Resolve the encryption passphrase: --key flag (deprecated) → env var → masked prompt
 */
async function getKey(flagKey?: string): Promise<string> {
    const provider = resolveKeyProvider(flagKey);
    const key = await provider.getPassphrase();
    if (Buffer.byteLength(key, 'utf8') === 0) {
        throw new UsageError('Encryption key must not be empty.');
    }
    return key;
}

/** Print a clean error and exit with the documented code for this failure class. */
function handleCliError(error: unknown): never {
    if (!(error instanceof InterruptedError)) {
        logger.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(exitCodeFor(error));
}

program
    .name('authxtract')
    .description('Securely extract and manage authentication state from web pages')
    .version('0.2.0')
    .option('--verbose', 'Print detailed error diagnostics (may include crypto error internals)')
    .addOption(
        new Option('--quiet', 'Suppress all output except errors and command data').conflicts('verbose')
    )
    .hook('preAction', () => {
        const opts = program.opts<{ quiet?: boolean; verbose?: boolean }>();
        logger.configure({ quiet: opts.quiet, verbose: opts.verbose });
    });

// Capture command
program
    .command('capture <name>')
    .description('Capture authentication state from a browser session')
    .requiredOption('-u, --url <url>', 'Login page URL')
    .option('-k, --key <key>', DEPRECATED_KEY_HELP)
    .action(async (name: string, options: { url: string; key?: string }) => {
        try {
            validateSessionName(name);
            const key = await getKey(options.key);
            await capture({ name, url: options.url, key });
        } catch (error) {
            handleCliError(error);
        }
    });

// List command
program
    .command('list')
    .description('List all saved sessions')
    .option('--json', 'Emit the session list as JSON (machine-readable, stdout only)')
    .option('-k, --key <key>', DEPRECATED_KEY_HELP)
    .action(async (options: { json?: boolean; key?: string }) => {
        try {
            if (options.key !== undefined) {
                warnKeyFlagDeprecated();
            }
            const { listSessions } = await import('./utils/storage');
            const sessions = listSessions(options.key);

            if (options.json) {
                logger.out(JSON.stringify(sessions, null, 2));
                return;
            }

            if (sessions.length === 0) {
                logger.out('No sessions found.');
                return;
            }

            logger.out('Saved sessions:');
            sessions.forEach((session) => {
                logger.out(`  - ${session.name}`);
                logger.out(`    URL: ${session.url}`);
                logger.out(`    Captured: ${session.capturedAt}`);
            });
        } catch (error) {
            handleCliError(error);
        }
    });

// Export command
program
    .command('export <name>')
    .description('Export a session for use in Playwright tests')
    .option('-o, --output <path>', 'Output file path', './auth-state.json')
    .addOption(
        new Option('--stdout', 'Write the decrypted state to stdout instead of a file').conflicts('json')
    )
    .option('--json', 'Emit a machine-readable result object after exporting')
    .option('-k, --key <key>', DEPRECATED_KEY_HELP)
    .action(
        async (name: string, options: { output: string; stdout?: boolean; json?: boolean; key?: string }) => {
            const fs = await import('fs');
            const { loadSession } = await import('./utils/storage');

            try {
                validateSessionName(name);
                const key = await getKey(options.key);
                const session = loadSession(name, key);

                if (!session) {
                    throw new UsageError(`Session "${name}" not found.`);
                }

                const stateJson = JSON.stringify(session.state, null, 2);

                if (options.stdout) {
                    // Keep stdout JSON-only so it can be piped; messages go to stderr.
                    logger.out(stateJson);
                    logger.warn('Decrypted state written to stdout only — nothing was saved to disk.');
                    logger.warn('This data is password-equivalent: anyone holding it can use the session.');
                    return;
                }

                fs.writeFileSync(options.output, stateJson, { mode: 0o600 });
                // writeFileSync's mode only applies on creation; enforce it on overwrite too.
                fs.chmodSync(options.output, 0o600);

                if (options.json) {
                    logger.out(
                        JSON.stringify({
                            name: session.metadata.name,
                            url: session.metadata.url,
                            capturedAt: session.metadata.capturedAt,
                            output: options.output,
                        })
                    );
                } else {
                    logger.success(`Exported to: ${options.output}`);
                }
                logger.warn('This file contains live session tokens — it is password-equivalent.');
                logger.warn('Keep it out of version control and delete it after use.');
            } catch (error) {
                handleCliError(error);
            }
        }
    );

// Delete command
program
    .command('delete <name>')
    .description('Delete a saved session')
    .action(async (name: string) => {
        try {
            validateSessionName(name);
            const { deleteSession } = await import('./utils/storage');

            if (deleteSession(name)) {
                logger.success(`Session "${name}" deleted.`);
            } else {
                throw new UsageError(`Session "${name}" not found.`);
            }
        } catch (error) {
            handleCliError(error);
        }
    });

program.parse();
