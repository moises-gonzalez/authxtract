#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { captureCommand } from './commands/capture';
import { listCommand } from './commands/list';
import { deleteCommand } from './commands/delete';
import { exportCommand } from './commands/export';

const program = new Command();

program
    .name('authxtract')
    .description(chalk.cyan('🔐 A minimalistic tool for extracting authentication information from web pages'))
    .version('1.0.0');

program.addCommand(captureCommand);
program.addCommand(listCommand);
program.addCommand(deleteCommand);
program.addCommand(exportCommand);

program.parse();
