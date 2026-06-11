#!/usr/bin/env node

/**
 * authXtract CLI - Securely extract and manage authentication state
 */

import { Command } from 'commander';
import { capture } from './commands/capture';
import { resolveKeyProvider, warnKeyFlagDeprecated } from './utils/key-provider';
import { setVerbose, validateSessionName } from './utils/storage';

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
        throw new Error('Encryption key must not be empty.');
    }
    return key;
}

program
    .name('authxtract')
    .description('🔐 Securely extract and manage authentication state from web pages')
    .version('1.0.0')
    .option('--verbose', 'Print detailed error diagnostics (may include crypto error internals)')
    .hook('preAction', () => {
        setVerbose(program.opts().verbose === true);
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
            console.error('❌ Error:', error instanceof Error ? error.message : error);
            process.exit(1);
        }
    });

// List command
program
    .command('list')
    .description('List all saved sessions')
    .option('-k, --key <key>', DEPRECATED_KEY_HELP)
    .action(async (options: { key?: string }) => {
        try {
            if (options.key !== undefined) {
                warnKeyFlagDeprecated();
            }
            const { listSessions } = await import('./utils/storage');
            const sessions = listSessions(options.key);

            if (sessions.length === 0) {
                console.log('No sessions found.');
                return;
            }

            console.log('\n📋 Saved Sessions:\n');
            sessions.forEach((session) => {
                console.log(`  • ${session.name}`);
                console.log(`    URL: ${session.url}`);
                console.log(`    Captured: ${session.capturedAt}\n`);
            });
        } catch (error) {
            console.error('❌ Error:', error instanceof Error ? error.message : error);
            process.exit(1);
        }
    });

// Export command
program
    .command('export <name>')
    .description('Export a session for use in Playwright tests')
    .option('-o, --output <path>', 'Output file path', './auth-state.json')
    .option('--stdout', 'Write the decrypted state to stdout instead of a file')
    .option('-k, --key <key>', DEPRECATED_KEY_HELP)
    .action(async (name: string, options: { output: string; stdout?: boolean; key?: string }) => {
        const fs = await import('fs');
        const { loadSession } = await import('./utils/storage');

        try {
            validateSessionName(name);
            const key = await getKey(options.key);
            const session = loadSession(name, key);

            if (!session) {
                console.error(`❌ Session "${name}" not found.`);
                process.exit(1);
            }

            const stateJson = JSON.stringify(session.state, null, 2);

            if (options.stdout) {
                // Keep stdout JSON-only so it can be piped; messages go to stderr.
                process.stdout.write(stateJson + '\n');
                console.error('⚠️  Decrypted state written to stdout only — nothing was saved to disk.');
                console.error('⚠️  This data is password-equivalent: anyone holding it can use the session.');
                return;
            }

            fs.writeFileSync(options.output, stateJson, { mode: 0o600 });
            // writeFileSync's mode only applies on creation; enforce it on overwrite too.
            fs.chmodSync(options.output, 0o600);
            console.log(`✅ Exported to: ${options.output}`);
            console.log('⚠️  This file contains live session tokens — it is password-equivalent.');
            console.log('   Keep it out of version control and delete it after use.');
        } catch (error) {
            console.error('❌ Export failed:', error instanceof Error ? error.message : error);
            process.exit(1);
        }
    });

// Delete command
program
    .command('delete <name>')
    .description('Delete a saved session')
    .action(async (name: string) => {
        try {
            validateSessionName(name);
            const { deleteSession } = await import('./utils/storage');

            if (deleteSession(name)) {
                console.log(`✅ Session "${name}" deleted.`);
            } else {
                console.error(`❌ Session "${name}" not found.`);
                process.exit(1);
            }
        } catch (error) {
            console.error('❌ Error:', error instanceof Error ? error.message : error);
            process.exit(1);
        }
    });

program.parse();
