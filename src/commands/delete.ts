import { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { deleteSession, sessionExists } from '../storage/file-store';

export const deleteCommand = new Command('delete')
    .description('Delete a stored session')
    .argument('<name>', 'Name of the session to delete')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(async (name: string, options: { force?: boolean }) => {
        console.log(chalk.cyan('\n🔐 authXtract - Delete Session\n'));

        if (!sessionExists(name)) {
            console.log(chalk.red(`❌ Session "${name}" not found.`));
            console.log(chalk.gray('\nUse "authxtract list" to see available sessions.\n'));
            return;
        }

        if (!options.force) {
            const confirmed = await confirm({
                message: `Are you sure you want to delete session "${name}"?`,
                default: false,
            });

            if (!confirmed) {
                console.log(chalk.yellow('\n⚠️  Deletion cancelled.\n'));
                return;
            }
        }

        const success = deleteSession(name);

        if (success) {
            console.log(chalk.green(`\n✅ Session "${name}" deleted successfully.\n`));
        } else {
            console.log(chalk.red(`\n❌ Failed to delete session "${name}".\n`));
        }
    });
