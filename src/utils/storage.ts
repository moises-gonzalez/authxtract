/**
 * Storage utilities for saving and loading authentication state
 *
 * On-disk format (v2): a self-describing JSON envelope per session file.
 * The session payload is encrypted with AES-256-GCM (authenticated) using a
 * 32-byte key derived from the user passphrase via scrypt with a fresh
 * per-file random salt. Legacy v1 files (AES-256-CBC, "ivHex:ctHex") are
 * detected and rejected — sessions are ephemeral, so the fix is re-capture.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from './logger';
import { UsageError } from './errors';

const AUTHXTRACT_DIR = '.authxtract';
const SESSIONS_DIR = 'sessions';

const ENVELOPE_VERSION = 2;
const ALGORITHM = 'aes-256-gcm';
const KDF = 'scrypt';
const KEY_LENGTH = 32; // bytes (AES-256)
const SALT_LENGTH = 16; // bytes, fresh random salt per file
const IV_LENGTH = 12; // bytes, recommended nonce size for GCM
const TAG_LENGTH = 16; // bytes, GCM authentication tag

// Session names become file names: only a strict allowlist is accepted so a
// name can never navigate outside the session store.
const SESSION_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

// POSIX permissions; ignored on Windows (profile ACLs apply there).
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

// Legacy v1 format: hex IV (16 bytes), a colon, then hex ciphertext.
const LEGACY_FORMAT_PATTERN = /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;

export interface SessionMetadata {
    name: string;
    url: string;
    capturedAt: string;
    expiresAt?: string;
}

export interface SessionData {
    metadata: SessionMetadata;
    state: object;
}

interface EncryptionEnvelope {
    v: number;
    alg: string;
    kdf: string;
    salt: string;
    iv: string;
    tag: string;
    ct: string;
}

/**
 * Decryption failed. Intentionally generic: wrong-key and tampered-file paths
 * must be indistinguishable and never surface crypto internals.
 */
export class DecryptionError extends Error {
    constructor() {
        super('Decryption failed — wrong key, or corrupted/legacy file.');
        this.name = 'DecryptionError';
    }
}

/** The file uses the old, insecure v1 (AES-256-CBC) format. */
export class LegacySessionError extends Error {
    constructor() {
        super('This session was captured with an older, insecure format. Please re-run `capture`.');
        this.name = 'LegacySessionError';
    }
}

/**
 * Passphrases may be any length (the KDF normalizes them) but must not be empty.
 */
function validatePassphrase(passphrase: string): string {
    if (typeof passphrase !== 'string' || Buffer.byteLength(passphrase, 'utf8') === 0) {
        throw new UsageError('Encryption key must not be empty.');
    }
    return passphrase;
}

/**
 * Get the encryption passphrase from environment variables
 */
function getEncryptionKey(): string {
    const key = process.env.AUTHXTRACT_KEY;
    if (!key) {
        throw new UsageError('AUTHXTRACT_KEY environment variable is not set. Encryption key is required.');
    }
    return validatePassphrase(key);
}

/**
 * Derive a 256-bit AES key from the passphrase via scrypt with the given salt.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
    validatePassphrase(passphrase);
    const key = crypto.scryptSync(passphrase, salt, KEY_LENGTH);
    if (key.length !== KEY_LENGTH) {
        throw new Error(`Derived key must be ${KEY_LENGTH} bytes (got ${key.length}).`);
    }
    return key;
}

/**
 * Encrypt text into a versioned v2 envelope (JSON string).
 */
function encrypt(text: string, passphrase: string): string {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = deriveKey(passphrase, salt);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const envelope: EncryptionEnvelope = {
        v: ENVELOPE_VERSION,
        alg: ALGORITHM,
        kdf: KDF,
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
        ct: ciphertext.toString('hex'),
    };
    return JSON.stringify(envelope);
}

function isHexOfBytes(value: unknown, bytes?: number): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length % 2 !== 0) return false;
    if (!/^[0-9a-fA-F]+$/.test(value)) return false;
    return bytes === undefined || value.length === bytes * 2;
}

/**
 * Parse and validate the on-disk envelope. Legacy v1 files get a dedicated
 * error; anything else unreadable collapses into the generic DecryptionError.
 */
function parseEnvelope(fileContents: string): EncryptionEnvelope {
    const trimmed = fileContents.trim();
    if (LEGACY_FORMAT_PATTERN.test(trimmed)) {
        throw new LegacySessionError();
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch (error) {
        logger.verbose('Session file is neither a v2 envelope nor a known legacy format', error);
        throw new DecryptionError();
    }
    if (typeof parsed !== 'object' || parsed === null) {
        logger.verbose('Session file envelope is not an object');
        throw new DecryptionError();
    }

    const envelope = parsed as Partial<EncryptionEnvelope>;
    if (
        envelope.v !== ENVELOPE_VERSION ||
        envelope.alg !== ALGORITHM ||
        envelope.kdf !== KDF ||
        !isHexOfBytes(envelope.salt, SALT_LENGTH) ||
        !isHexOfBytes(envelope.iv, IV_LENGTH) ||
        !isHexOfBytes(envelope.tag, TAG_LENGTH) ||
        !isHexOfBytes(envelope.ct)
    ) {
        logger.verbose('Session file envelope is malformed or has an unsupported version');
        throw new DecryptionError();
    }
    return envelope as EncryptionEnvelope;
}

/**
 * Decrypt a v2 envelope. GCM authentication makes tampering and wrong keys
 * throw; all such failures surface as the same generic DecryptionError, with
 * details logged only under --verbose.
 */
function decrypt(fileContents: string, passphrase: string): string {
    const envelope = parseEnvelope(fileContents);
    try {
        const key = deriveKey(passphrase, Buffer.from(envelope.salt, 'hex'));
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
        const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ct, 'hex')), decipher.final()]);
        return plaintext.toString('utf8');
    } catch (error) {
        logger.verbose('Decryption failed', error);
        throw new DecryptionError();
    }
}

/**
 * Validate a session name. Names become file names, so reject anything
 * outside the allowlist, dot navigation, and path separators.
 */
export function validateSessionName(name: string): string {
    const invalid = () =>
        new UsageError(
            `Invalid session name "${name}". Use 1-64 characters: letters, digits, ".", "_" or "-" (no path separators).`
        );
    if (typeof name !== 'string' || !SESSION_NAME_PATTERN.test(name)) throw invalid();
    if (name === '.' || name === '..' || name.includes('..')) throw invalid();
    if (name.includes('/') || name.includes('\\')) throw invalid();
    if (path.basename(name) !== name) throw invalid();
    return name;
}

/**
 * Ensure the .authxtract directory structure exists (owner-only on POSIX)
 */
export function ensureStorageDir(): string {
    const rootPath = path.join(process.cwd(), AUTHXTRACT_DIR);
    const sessionsPath = path.join(rootPath, SESSIONS_DIR);

    for (const dir of [rootPath, sessionsPath]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { mode: DIR_MODE });
        }
    }

    return sessionsPath;
}

/**
 * Get the path for a session file. The name is validated and the resolved
 * path is asserted to still be inside the session store before any fs use.
 */
export function getSessionPath(name: string): string {
    const validName = validateSessionName(name);
    const sessionsPath = path.resolve(ensureStorageDir());
    const fileName = `${path.basename(validName)}.json`;
    const target = path.resolve(sessionsPath, fileName);

    if (path.dirname(target) !== sessionsPath || path.basename(target) !== fileName) {
        throw new Error(`Invalid session name "${name}". Resolved path escapes the session store.`);
    }
    return target;
}

/**
 * Shape-check decrypted data. GCM already guarantees integrity; this guards
 * malformed-but-authentic content before it is handed to callers.
 */
function isValidSessionData(value: unknown): value is SessionData {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as { metadata?: unknown; state?: unknown };
    if (typeof candidate.metadata !== 'object' || candidate.metadata === null) return false;
    if (typeof candidate.state !== 'object' || candidate.state === null) return false;
    const metadata = candidate.metadata as { name?: unknown; url?: unknown };
    if (typeof metadata.name !== 'string' || metadata.name.length === 0) return false;
    if (typeof metadata.url !== 'string') return false;
    try {
        new URL(metadata.url);
    } catch {
        return false;
    }
    return true;
}

function malformedSessionError(name: string): Error {
    return new Error(
        `Session "${name}" decrypted successfully but its contents are malformed. Please re-run \`capture\`.`
    );
}

/**
 * Save storage state to a session file
 */
export function saveSession(name: string, state: object, url: string, key?: string): void {
    const sessionPath = getSessionPath(name);

    // Use provided key or get from env
    const passphrase = key ? validatePassphrase(key) : getEncryptionKey();

    const sessionData: SessionData = {
        metadata: {
            name,
            url,
            capturedAt: new Date().toISOString(),
        },
        state,
    };

    const encryptedData = encrypt(JSON.stringify(sessionData), passphrase);

    fs.writeFileSync(sessionPath, encryptedData, { mode: FILE_MODE });
    // writeFileSync's mode only applies on creation; enforce it on overwrite too.
    fs.chmodSync(sessionPath, FILE_MODE);
    logger.success(`Session saved (encrypted): ${sessionPath}`);
}

/**
 * Load a session file
 */
export function loadSession(name: string, key?: string): SessionData | null {
    const sessionPath = getSessionPath(name);

    if (!fs.existsSync(sessionPath)) {
        return null;
    }

    const fileContents = fs.readFileSync(sessionPath, 'utf-8');
    const passphrase = key ? validatePassphrase(key) : getEncryptionKey();
    const decryptedData = decrypt(fileContents, passphrase);

    let parsed: unknown;
    try {
        parsed = JSON.parse(decryptedData);
    } catch (error) {
        logger.verbose('Decrypted session is not valid JSON', error);
        throw malformedSessionError(name);
    }
    if (!isValidSessionData(parsed)) {
        throw malformedSessionError(name);
    }
    return parsed;
}

/**
 * List all saved sessions
 */
export function listSessions(key?: string): SessionMetadata[] {
    const sessionsPath = path.join(process.cwd(), AUTHXTRACT_DIR, SESSIONS_DIR);

    if (!fs.existsSync(sessionsPath)) {
        return [];
    }

    const files = fs.readdirSync(sessionsPath).filter((f) => f.endsWith('.json'));
    const sessions: SessionMetadata[] = [];

    // Optimistically try to get key
    const encryptionKey = key || process.env.AUTHXTRACT_KEY || null;

    if (!encryptionKey) {
        logger.warn('No encryption key found. Listing sessions by filename only.');
    }

    for (const file of files) {
        const name = file.replace(/\.json$/, '');
        if (!encryptionKey) {
            sessions.push({
                name,
                url: '??? (Decryption Key Required)',
                capturedAt: '???',
            });
            continue;
        }
        try {
            const fileContents = fs.readFileSync(path.join(sessionsPath, file), 'utf-8');
            const decryptedData = decrypt(fileContents, encryptionKey);
            const parsed: unknown = JSON.parse(decryptedData);
            if (!isValidSessionData(parsed)) {
                sessions.push({
                    name,
                    url: '??? (Malformed Session Data)',
                    capturedAt: '???',
                });
                continue;
            }
            sessions.push(parsed.metadata);
        } catch (error) {
            logger.verbose(`Failed to read session "${name}"`, error);
            sessions.push({
                name,
                url:
                    error instanceof LegacySessionError
                        ? '??? (Legacy format — please re-run capture)'
                        : '??? (Decryption Failed)',
                capturedAt: '???',
            });
        }
    }

    return sessions;
}

/**
 * Delete a session
 */
export function deleteSession(name: string): boolean {
    const sessionPath = getSessionPath(name);

    if (!fs.existsSync(sessionPath)) {
        return false;
    }

    fs.unlinkSync(sessionPath);
    return true;
}
