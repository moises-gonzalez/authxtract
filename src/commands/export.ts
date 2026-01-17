import { Command } from 'commander';
import { password as passwordPrompt } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { exportSession, sessionExists, loadSession } from '../storage/file-store';
import { getSessionExpiryInfo } from '../core/browser';

export const exportCommand = new Command('export')
    .description('Export a session for use in Playwright tests')
    .argument('<name>', 'Name of the session to export')
    .option('-o, --output <path>', 'Output file path', './auth-state.json')
    .action(async (name: string, options: { output: string }) => {
        console.log(chalk.cyan('\n🔐 authXtract - Export Session\n'));

        if (!sessionExists(name)) {
            console.log(chalk.red(`❌ Session "${name}" not found.`));
            console.log(chalk.gray('\nUse "authxtract list" to see available sessions.\n'));
            return;
        }

        try {
            // Get master password
            const password = await passwordPrompt({
                message: 'Enter master password:',
            });

            const spinner = ora('Decrypting session...').start();

            // Load and check session
            const storageState = loadSession(name, password);
            const expiryInfo = getSessionExpiryInfo(storageState);

            // Check for expired session
            if (expiryInfo.hasExpiredCookies) {
                spinner.warn('Session may be expired!');
                console.log(chalk.yellow(`\n⚠️  Warning: ${expiryInfo.expiredCount} cookie(s) have expired.`));
                console.log(chalk.yellow('   Consider recapturing the session.\n'));
            }

            spinner.text = 'Exporting session...';

            // Export to file
            const outputPath = path.resolve(options.output);
            exportSession(name, password, outputPath);

            spinner.succeed('Session exported successfully!');
            console.log(chalk.green(`\n✅ Session exported to: ${chalk.bold(outputPath)}`));

            // Show expiry warning if applicable
            if (expiryInfo.earliestExpiry && !expiryInfo.hasExpiredCookies) {
                const now = new Date();
                const hoursUntilExpiry = Math.round((expiryInfo.earliestExpiry.getTime() - now.getTime()) / (1000 * 60 * 60));

                if (hoursUntilExpiry < 24) {
                    console.log(chalk.yellow(`\n⚠️  Warning: Session cookies expire in ${hoursUntilExpiry} hours.`));
                }
            }

            // Usage hint
            console.log(chalk.gray('\nUsage in Playwright:'));
            console.log(chalk.gray('─────────────────────────────────────'));
            console.log(chalk.white(`test.use({ storageState: '${options.output}' });`));
            console.log();

        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('Unsupported state') || error.message.includes('bad decrypt')) {
                    console.log(chalk.red('\n❌ Incorrect password.\n'));
                } else if (error.message.includes('User force closed')) {
                    console.log(chalk.yellow('\n⚠️  Export cancelled.\n'));
                } else {
                    console.error(chalk.red('\n❌ Error:'), error.message, '\n');
                }
            }
        }
    });
