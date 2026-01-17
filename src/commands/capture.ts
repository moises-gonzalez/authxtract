import { Command } from 'commander';
import { input, password as passwordPrompt, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { launchBrowser, extractStorageState, closeBrowser, getSessionExpiryInfo } from '../core/browser';
import { saveSession, sessionExists } from '../storage/file-store';

export const captureCommand = new Command('capture')
    .description('Capture authentication session from a web page')
    .action(async () => {
        console.log(chalk.cyan('\n🔐 authXtract - Session Capture\n'));

        try {
            // Get URL
            const url = await input({
                message: 'Enter the URL to authenticate:',
                validate: (value) => {
                    try {
                        new URL(value);
                        return true;
                    } catch {
                        return 'Please enter a valid URL';
                    }
                },
            });

            // Get session name
            const name = await input({
                message: 'Name this session:',
                validate: (value) => {
                    if (!value.trim()) return 'Session name is required';
                    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                        return 'Session name can only contain letters, numbers, underscores, and hyphens';
                    }
                    return true;
                },
            });

            // Check if session exists
            if (sessionExists(name)) {
                const overwrite = await confirm({
                    message: `Session "${name}" already exists. Overwrite?`,
                    default: false,
                });
                if (!overwrite) {
                    console.log(chalk.yellow('\n⚠️  Capture cancelled.'));
                    return;
                }
            }

            // Get master password
            const password = await passwordPrompt({
                message: 'Enter master password:',
                validate: (value) => {
                    if (value.length < 8) return 'Password must be at least 8 characters';
                    return true;
                },
            });

            // Confirm password for new sessions
            const confirmPassword = await passwordPrompt({
                message: 'Confirm master password:',
            });

            if (password !== confirmPassword) {
                console.log(chalk.red('\n❌ Passwords do not match.'));
                return;
            }

            // Launch browser
            console.log(chalk.cyan('\n🌐 Opening browser... Please log in manually.'));
            console.log(chalk.gray('   Complete MFA if prompted.'));
            console.log(chalk.gray('   Press ENTER in this terminal when logged in successfully.\n'));

            // Launch browser and navigate to URL
            const { context, page } = await launchBrowser(url);

            // Wait for user to press Enter
            await input({
                message: 'Press ENTER when logged in successfully...',
            });

            // Extract session
            const spinner = ora('Extracting session data...').start();
            const storageState = await extractStorageState(context);

            // Check for session expiry warnings
            const expiryInfo = getSessionExpiryInfo(storageState);

            // Close browser
            await closeBrowser();
            spinner.text = 'Encrypting session...';

            // Save session
            saveSession(name, url, storageState, password);
            spinner.succeed('Session captured and encrypted!');

            console.log(chalk.green(`\n✅ Stored as: ${chalk.bold(name)}`));

            // Show expiry warning if applicable
            if (expiryInfo.earliestExpiry) {
                const expiryDate = expiryInfo.earliestExpiry;
                const now = new Date();
                const hoursUntilExpiry = Math.round((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60));

                if (hoursUntilExpiry < 24) {
                    console.log(chalk.yellow(`\n⚠️  Warning: Session cookies expire in ${hoursUntilExpiry} hours.`));
                } else {
                    const daysUntilExpiry = Math.round(hoursUntilExpiry / 24);
                    console.log(chalk.gray(`\nℹ️  Session cookies expire in ~${daysUntilExpiry} days.`));
                }
            }

        } catch (error) {
            await closeBrowser();
            if (error instanceof Error && error.message.includes('User force closed')) {
                console.log(chalk.yellow('\n⚠️  Capture cancelled.'));
            } else {
                console.error(chalk.red('\n❌ Error:'), error);
            }
        }
    });
