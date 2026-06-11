/**
 * OS keychain access for the encryption passphrase.
 *
 * - Windows: Credential Manager (advapi32 CredRead/CredWrite/CredDelete via an
 *   embedded PowerShell + C# P/Invoke shim; the secret travels via the child
 *   process environment, never on a command line).
 * - macOS: Keychain via `security` (interactive `-i` mode keeps the secret off argv).
 * - Linux: Secret Service via `secret-tool` (libsecret; secret piped on stdin).
 *
 * All functions are synchronous and throw KeychainUnavailableError when the
 * platform mechanism cannot be used (callers fall through to other providers).
 */

import { spawnSync, SpawnSyncOptions } from 'child_process';
import { logger } from './logger';

const SERVICE = 'authxtract';
const ACCOUNT = 'default';
const WINDOWS_TARGET = `${SERVICE}:${ACCOUNT}`;
const SECRET_ENV = 'AUTHXTRACT_KEYCHAIN_SECRET';

export class KeychainUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KeychainUnavailableError';
    }
}

/** Human-readable name of the platform keychain, for messages. */
export function keychainName(): string {
    switch (process.platform) {
        case 'win32':
            return 'Windows Credential Manager';
        case 'darwin':
            return 'macOS Keychain';
        default:
            return 'Secret Service (libsecret)';
    }
}

// C# shim compiled by PowerShell at call time: generic credentials, per-user.
const WINDOWS_CREDMAN_SHIM = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class AuthxtractCredMan {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWriteW(ref CREDENTIAL credential, int flags);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDeleteW(string target, int type, int flags);
    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);

    public static string Read(string target) {
        IntPtr ptr;
        if (!CredReadW(target, 1, 0, out ptr)) return null;
        try {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            if (cred.CredentialBlobSize == 0) return "";
            return Marshal.PtrToStringUni(cred.CredentialBlob, cred.CredentialBlobSize / 2);
        } finally {
            CredFree(ptr);
        }
    }
    public static bool Write(string target, string secret) {
        byte[] bytes = System.Text.Encoding.Unicode.GetBytes(secret);
        CREDENTIAL cred = new CREDENTIAL();
        cred.Type = 1;                 // CRED_TYPE_GENERIC
        cred.TargetName = target;
        cred.Persist = 2;              // CRED_PERSIST_LOCAL_MACHINE (per-user, survives logoff)
        cred.UserName = "authxtract";
        cred.CredentialBlobSize = bytes.Length;
        cred.CredentialBlob = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, cred.CredentialBlob, bytes.Length);
        try {
            return CredWriteW(ref cred, 0);
        } finally {
            Marshal.FreeCoTaskMem(cred.CredentialBlob);
        }
    }
    public static bool Delete(string target) {
        return CredDeleteW(target, 1, 0);
    }
}
'@
`;

function runPowerShell(script: string, extraEnv?: Record<string, string>): ReturnType<typeof spawnSync> {
    const options: SpawnSyncOptions = {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, ...extraEnv },
    };
    return spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        options
    );
}

function run(command: string, args: string[], input?: string): ReturnType<typeof spawnSync> {
    return spawnSync(command, args, { encoding: 'utf8', windowsHide: true, input });
}

function unavailable(result: ReturnType<typeof spawnSync>, what: string): KeychainUnavailableError {
    const detail =
        result.error instanceof Error ? result.error.message : (result.stderr || '').toString().trim();
    return new KeychainUnavailableError(`${keychainName()} ${what} failed${detail ? `: ${detail}` : '.'}`);
}

/**
 * Read the stored passphrase. Returns null when no key is stored.
 * Throws KeychainUnavailableError when the keychain cannot be queried at all.
 */
export function readKeychainKey(): string | null {
    if (process.platform === 'win32') {
        const script = `${WINDOWS_CREDMAN_SHIM}
$v = [AuthxtractCredMan]::Read('${WINDOWS_TARGET}')
if ($null -eq $v) { exit 3 }
[Console]::Out.Write($v)
exit 0`;
        const result = runPowerShell(script);
        if (result.error) throw unavailable(result, 'lookup');
        if (result.status === 3) return null;
        if (result.status !== 0) throw unavailable(result, 'lookup');
        const value = (result.stdout ?? '').toString();
        return value.length > 0 ? value : null;
    }

    if (process.platform === 'darwin') {
        const result = run('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w']);
        if (result.error) throw unavailable(result, 'lookup');
        if (result.status !== 0) return null; // not found (or locked) — treat as absent
        const value = (result.stdout ?? '').toString().replace(/\n$/, '');
        return value.length > 0 ? value : null;
    }

    const result = run('secret-tool', ['lookup', 'service', SERVICE, 'account', ACCOUNT]);
    if (result.error) {
        throw new KeychainUnavailableError(
            'secret-tool not found — install libsecret-tools to use the OS keychain.'
        );
    }
    if (result.status !== 0) return null;
    const value = (result.stdout ?? '').toString().replace(/\n$/, '');
    return value.length > 0 ? value : null;
}

/** Store (or replace) the passphrase in the OS keychain. */
export function storeKeychainKey(secret: string): void {
    if (process.platform === 'win32') {
        const script = `${WINDOWS_CREDMAN_SHIM}
$secret = $env:${SECRET_ENV}
if ([string]::IsNullOrEmpty($secret)) { exit 2 }
if ([AuthxtractCredMan]::Write('${WINDOWS_TARGET}', $secret)) { exit 0 } else { exit 1 }`;
        const result = runPowerShell(script, { [SECRET_ENV]: secret });
        if (result.error || result.status !== 0) throw unavailable(result, 'store');
        return;
    }

    if (process.platform === 'darwin') {
        // `security -i` reads commands from stdin, keeping the secret off argv.
        if (/[\r\n]/.test(secret)) {
            throw new KeychainUnavailableError('Keychain passphrases must not contain newlines.');
        }
        const escaped = secret.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const command = `add-generic-password -U -s "${SERVICE}" -a "${ACCOUNT}" -w "${escaped}"\n`;
        const result = run('security', ['-i'], command);
        if (result.error || result.status !== 0) throw unavailable(result, 'store');
        return;
    }

    const result = run(
        'secret-tool',
        ['store', '--label=authxtract encryption key', 'service', SERVICE, 'account', ACCOUNT],
        `${secret}\n`
    );
    if (result.error) {
        throw new KeychainUnavailableError(
            'secret-tool not found — install libsecret-tools to use the OS keychain.'
        );
    }
    if (result.status !== 0) throw unavailable(result, 'store');
}

/** Remove the stored passphrase. Returns false when nothing was stored. */
export function clearKeychainKey(): boolean {
    if (process.platform === 'win32') {
        const script = `${WINDOWS_CREDMAN_SHIM}
if ([AuthxtractCredMan]::Delete('${WINDOWS_TARGET}')) { exit 0 } else { exit 3 }`;
        const result = runPowerShell(script);
        if (result.error) throw unavailable(result, 'clear');
        if (result.status === 3) return false;
        if (result.status !== 0) throw unavailable(result, 'clear');
        return true;
    }

    if (process.platform === 'darwin') {
        const result = run('security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT]);
        if (result.error) throw unavailable(result, 'clear');
        return result.status === 0;
    }

    const result = run('secret-tool', ['clear', 'service', SERVICE, 'account', ACCOUNT]);
    if (result.error) {
        throw new KeychainUnavailableError(
            'secret-tool not found — install libsecret-tools to use the OS keychain.'
        );
    }
    return result.status === 0;
}

/**
 * Best-effort read used during provider resolution: returns null instead of
 * throwing when the keychain is unavailable, logging detail under --verbose.
 */
export function tryReadKeychainKey(): string | null {
    try {
        return readKeychainKey();
    } catch (error) {
        logger.verbose('OS keychain unavailable during key resolution', error);
        return null;
    }
}
