/**
 * Storage utilities for saving and loading authentication state
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const AUTHXTRACT_DIR = '.authxtract';
const SESSIONS_DIR = 'sessions';
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // For AES, this is always 16

export interface SessionMetadata {
    name: string;
    url: string;
    capturedAt: string;
    expiresAt?: string;
}

/**
 * Get the encryption key from environment variables
 */
function getEncryptionKey(): string {
    const key = process.env.AUTHXTRACT_KEY;
    if (!key) {
        throw new Error('❌ AUTHXTRACT_KEY environment variable is not set. Encryption key is required.');
    }
    // Key must be 32 bytes (256 bits)
    if (key.length !== 32) {
        throw new Error(`❌ AUTHXTRACT_KEY must be exactly 32 characters long (currently ${key.length}).`);
    }
    return key;
}

/**
 * Encrypt text
 */
function encrypt(text: string, key: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(key), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    // Return IV:EncryptedData
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypt text
 */
function decrypt(text: string, key: string): string {
    const textParts = text.split(':');
    const ivHex = textParts.shift();
    if (!ivHex) throw new Error('Invalid encrypted text format');
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(key), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

/**
 * Ensure the .authxtract directory structure exists
 */
export function ensureStorageDir(): string {
    const sessionsPath = path.join(process.cwd(), AUTHXTRACT_DIR, SESSIONS_DIR);

    if (!fs.existsSync(sessionsPath)) {
        fs.mkdirSync(sessionsPath, { recursive: true });
    }

    return sessionsPath;
}

/**
 * Get the path for a session file
 */
export function getSessionPath(name: string): string {
    const sessionsPath = ensureStorageDir();
    return path.join(sessionsPath, `${name}.json`);
}

/**
 * Save storage state to a session file
 */
export function saveSession(name: string, state: object, url: string, key?: string): void {
    const sessionPath = getSessionPath(name);

    // Use provided key or get from env
    const encryptionKey = key || getEncryptionKey();

    const sessionData = {
        metadata: {
            name,
            url,
            capturedAt: new Date().toISOString(),
        } as SessionMetadata,
        state,
    };

    const jsonString = JSON.stringify(sessionData, null, 2);
    const encryptedData = encrypt(jsonString, encryptionKey);

    fs.writeFileSync(sessionPath, encryptedData);
    console.log(`✅ Session saved (encrypted): ${sessionPath}`);
}

/**
 * Load a session file
 */
export function loadSession(name: string, key?: string): { metadata: SessionMetadata; state: object } | null {
    const sessionPath = getSessionPath(name);

    if (!fs.existsSync(sessionPath)) {
        return null;
    }

    const encryptedData = fs.readFileSync(sessionPath, 'utf-8');
    try {
        const encryptionKey = key || getEncryptionKey();
        const decryptedData = decrypt(encryptedData, encryptionKey);
        return JSON.parse(decryptedData);
    } catch (error) {
        console.error('❌ Failed to decrypt session. Check your AUTHXTRACT_KEY.');
        throw error;
    }
}

/**
 * List all saved sessions
 */
export function listSessions(key?: string): SessionMetadata[] {
    const sessionsPath = path.join(process.cwd(), AUTHXTRACT_DIR, SESSIONS_DIR);

    if (!fs.existsSync(sessionsPath)) {
        return [];
    }

    const files = fs.readdirSync(sessionsPath).filter(f => f.endsWith('.json'));
    const sessions: SessionMetadata[] = [];

    // Optimistically try to get key
    const encryptionKey = key || process.env.AUTHXTRACT_KEY || null;

    if (!encryptionKey) {
        console.warn('⚠️ No encryption key found. Listing sessions by filename only.');
    }

    for (const file of files) {
        try {
            if (encryptionKey) {
                const sessionPath = path.join(sessionsPath, file);
                const encryptedData = fs.readFileSync(sessionPath, 'utf-8');
                const decryptedData = decrypt(encryptedData, encryptionKey);
                const session = JSON.parse(decryptedData);
                sessions.push(session.metadata);
            } else {
                sessions.push({
                    name: file.replace('.json', ''),
                    url: '??? (Decryption Key Required)',
                    capturedAt: '???',
                });
            }
        } catch (e) {
            sessions.push({
                name: file.replace('.json', ''),
                url: '??? (Decryption Failed)',
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
