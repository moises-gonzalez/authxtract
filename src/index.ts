#!/usr/bin/env node

/**
 * authXtract CLI - Securely extract and manage authentication state
 */

import { Command } from 'commander';
import { capture } from './commands/capture';

const program = new Command();

program
    .name('authxtract')
    .description('🔐 Securely extract and manage authentication state from web pages')
    .version('1.0.0');

// Capture command
program
    .command('capture <name>')
    .description('Capture authentication state from a browser session')
    .requiredOption('-u, --url <url>', 'Login page URL')
    .action(async (name: string, options: { url: string }) => {
        try {
            await capture({ name, url: options.url });
        } catch (error) {
            console.error('❌ Error:', error instanceof Error ? error.message : error);
            process.exit(1);
        }
    });

// List command
program
    .command('list')
    .description('List all saved sessions')
    .action(async () => {
        const { listSessions } = await import('./utils/storage');
        const sessions = listSessions();

        if (sessions.length === 0) {
            console.log('No sessions found.');
            return;
        }

        console.log('\n📋 Saved Sessions:\n');
        sessions.forEach((session) => {
            console.log(`  • ${session.name}`);
            console.log(`    URL: ${session.url}`);
            console.log(`    Captured: ${new Date(session.capturedAt).toLocaleString()}\n`);
        });
    });

// Export command
program
    .command('export <name>')
    .description('Export a session for use in Playwright tests')
    .option('-o, --output <path>', 'Output file path', './auth-state.json')
    .action(async (name: string, options: { output: string }) => {
        const fs = await import('fs');
        const { loadSession } = await import('./utils/storage');

        const session = loadSession(name);

        if (!session) {
            console.error(`❌ Session "${name}" not found.`);
            process.exit(1);
        }

        fs.writeFileSync(options.output, JSON.stringify(session.state, null, 2));
        console.log(`✅ Exported to: ${options.output}`);
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
