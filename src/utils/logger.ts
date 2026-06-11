/**
 * Central logger.
 *
 * Conventions:
 * - Primary command output (lists, JSON, exported state) goes to stdout via `out()`
 *   and is never decorated, so it stays stable for pipes and scripts.
 * - Status/diagnostic messages go to stderr. They carry emoji only on an
 *   interactive terminal; in non-TTY/CI contexts they are plain text with
 *   `warning:`/`error:` prefixes instead.
 * - `--quiet` suppresses everything on stderr except errors; `--verbose`
 *   additionally prints `[verbose]` diagnostics (e.g. crypto error internals).
 */

type LogLevel = 'quiet' | 'normal' | 'verbose';

class Logger {
    private level: LogLevel = 'normal';
    private readonly decorated: boolean = process.stderr.isTTY === true && !process.env.CI;

    configure(options: { quiet?: boolean; verbose?: boolean }): void {
        if (options.verbose) {
            this.level = 'verbose';
        } else if (options.quiet) {
            this.level = 'quiet';
        } else {
            this.level = 'normal';
        }
    }

    /** Primary command output (data). Always printed, to stdout, undecorated. */
    out(message: string): void {
        process.stdout.write(`${message}\n`);
    }

    /** Status message. Suppressed by --quiet; emoji only on a TTY. */
    info(message: string, emoji?: string): void {
        if (this.level === 'quiet') return;
        this.write(emoji, '', message);
    }

    /** Success status. Suppressed by --quiet. */
    success(message: string): void {
        this.info(message, '✅');
    }

    /** Warning. Suppressed by --quiet; plain "warning:" prefix off-TTY. */
    warn(message: string): void {
        if (this.level === 'quiet') return;
        this.write('⚠️ ', 'warning: ', message);
    }

    /** Error. Always printed; plain "error:" prefix off-TTY. */
    error(message: string): void {
        this.write('❌', 'error: ', message);
    }

    /** Detailed diagnostics, printed only under --verbose. */
    verbose(message: string, error?: unknown): void {
        if (this.level !== 'verbose') return;
        const detail = error instanceof Error ? ` (${error.name}: ${error.message})` : '';
        process.stderr.write(`[verbose] ${message}${detail}\n`);
    }

    private write(emoji: string | undefined, plainPrefix: string, message: string): void {
        const line = this.decorated && emoji ? `${emoji} ${message}` : `${plainPrefix}${message}`;
        process.stderr.write(`${line}\n`);
    }
}

export const logger = new Logger();
