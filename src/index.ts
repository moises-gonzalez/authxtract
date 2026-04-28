#!/usr/bin/env node

/**
 * authXtract CLI - Securely extract and manage authentication state
 */

import { Command } from 'commander';
import { capture } from './commands/capture';
import * as readline from 'readline';

const program = new Command();

/**
 * Prompt for encryption key if not provided
 */
function promptByKey(message: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question(message, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * Helper to get key from env or prompt
 */
async function getKey(providedKey?: string): Promise<string> {
    if (providedKey) return providedKey;
    if (process.env.AUTHXTRACT_KEY) return process.env.AUTHXTRACT_KEY;

    console.log('🔑 Encryption key required.');
    const key = await promptByKey('Enter encryption key (32 chars): ');
    return key;
}

program
    .name('authxtract')
    .description('🔐 Securely extract and manage authentication state from web pages')
    .version('1.0.0');

// Capture command
program
    .command('capture <name>')
    .description('Capture authentication state from a browser session')
    .requiredOption('-u, --url <url>', 'Login page URL')
    .option('-k, --key <key>', 'Encryption key (32 chars). If not provided, will look for AUTHXTRACT_KEY env var or prompt.')
    .action(async (name: string, options: { url: string; key?: string }) => {
        try {
            const key = await getKey(options.key);
            // Basic length check before proceeding
            if (key.length !== 32) {
                console.error(`❌ Key must be exactly 32 characters long. Provided key is ${key.length} characters.`);
                process.exit(1);
            }

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
    .option('-k, --key <key>', 'Encryption key to decrypt session details')
    .action(async (options: { key?: string }) => {
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
    });

// Export command
program
    .command('export <name>')
    .description('Export a session for use in Playwright tests')
    .option('-o, --output <path>', 'Output file path', './auth-state.json')
    .option('-k, --key <key>', 'Encryption key to decrypt session')
    .action(async (name: string, options: { output: string; key?: string }) => {
        const fs = await import('fs');
        const { loadSession } = await import('./utils/storage');

        try {
            // We don't necessarily prompt here if list works without it, but loadSession NEEDS it.
            // We should prompt if not found.
            const key = await getKey(options.key);
            const session = loadSession(name, key);

            if (!session) {
                console.error(`❌ Session "${name}" not found.`);
                process.exit(1);
            }

            fs.writeFileSync(options.output, JSON.stringify(session.state, null, 2));
            console.log(`✅ Exported to: ${options.output}`);
            console.log(`   (Exported as plain JSON for compatibility)`);

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
        const { deleteSession } = await import('./utils/storage');

        if (deleteSession(name)) {
            console.log(`✅ Session "${name}" deleted.`);
        } else {
            console.error(`❌ Session "${name}" not found.`);
            process.exit(1);
        }
    });

program.parse();
