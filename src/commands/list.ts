import { Command } from 'commander';
import chalk from 'chalk';
import { getSessionIndex } from '../storage/file-store';

export const listCommand = new Command('list')
    .description('List all stored sessions')
    .action(() => {
        console.log(chalk.cyan('\n🔐 authXtract - Stored Sessions\n'));

        const index = getSessionIndex();

        if (index.sessions.length === 0) {
            console.log(chalk.gray('No sessions stored yet. Use "authxtract capture" to create one.\n'));
            return;
        }

        // Calculate column widths
        const nameWidth = Math.max(12, ...index.sessions.map((s) => s.name.length));
        const urlWidth = Math.max(30, ...index.sessions.map((s) => Math.min(s.url.length, 40)));

        // Header
        const header = `│ ${'Name'.padEnd(nameWidth)} │ ${'URL'.padEnd(urlWidth)} │ ${'Last Updated'.padEnd(19)} │`;
        const separator = `├${'─'.repeat(nameWidth + 2)}┼${'─'.repeat(urlWidth + 2)}┼${'─'.repeat(21)}┤`;
        const topBorder = `┌${'─'.repeat(nameWidth + 2)}┬${'─'.repeat(urlWidth + 2)}┬${'─'.repeat(21)}┐`;
        const bottomBorder = `└${'─'.repeat(nameWidth + 2)}┴${'─'.repeat(urlWidth + 2)}┴${'─'.repeat(21)}┘`;

        console.log(topBorder);
        console.log(header);
        console.log(separator);

        // Rows
        for (const session of index.sessions) {
            const truncatedUrl = session.url.length > urlWidth
                ? session.url.substring(0, urlWidth - 1) + '…'
                : session.url;
            const updatedAt = new Date(session.updatedAt).toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
            console.log(`│ ${chalk.green(session.name.padEnd(nameWidth))} │ ${truncatedUrl.padEnd(urlWidth)} │ ${updatedAt.padEnd(19)} │`);
        }

        console.log(bottomBorder);
        console.log();
    });
