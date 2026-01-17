import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { encrypt, decrypt, type EncryptedData } from '../core/crypto';

const STORE_DIR = path.join(os.homedir(), '.authxtract');
const SESSIONS_DIR = path.join(STORE_DIR, 'sessions');
const INDEX_FILE = path.join(STORE_DIR, 'index.json');

export interface SessionMetadata {
    name: string;
    url: string;
    createdAt: string;
    updatedAt: string;
}

export interface SessionIndex {
    sessions: SessionMetadata[];
}

/**
 * Ensures the storage directories exist
 */
export function ensureStorageExists(): void {
    if (!fs.existsSync(STORE_DIR)) {
        fs.mkdirSync(STORE_DIR, { recursive: true });
    }
    if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    if (!fs.existsSync(INDEX_FILE)) {
        fs.writeFileSync(INDEX_FILE, JSON.stringify({ sessions: [] }, null, 2));
    }
}

/**
 * Gets the index of all sessions
 */
export function getSessionIndex(): SessionIndex {
    ensureStorageExists();
    const content = fs.readFileSync(INDEX_FILE, 'utf-8');
    return JSON.parse(content);
}

/**
 * Updates the session index
 */
function updateSessionIndex(index: SessionIndex): void {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

/**
 * Saves an encrypted session
 */
export function saveSession(
    name: string,
    url: string,
    storageState: string,
    password: string
): void {
    ensureStorageExists();

    const encryptedData = encrypt(storageState, password);
    const sessionFile = path.join(SESSIONS_DIR, `${name}.enc.json`);
    fs.writeFileSync(sessionFile, JSON.stringify(encryptedData, null, 2));

    // Update index
    const index = getSessionIndex();
    const now = new Date().toISOString();
    const existingIndex = index.sessions.findIndex((s) => s.name === name);

    if (existingIndex >= 0) {
        index.sessions[existingIndex] = {
            name,
            url,
            createdAt: index.sessions[existingIndex].createdAt,
            updatedAt: now,
        };
    } else {
        index.sessions.push({
            name,
            url,
            createdAt: now,
            updatedAt: now,
        });
    }

    updateSessionIndex(index);
}

/**
 * Loads and decrypts a session
 */
export function loadSession(name: string, password: string): string {
    const sessionFile = path.join(SESSIONS_DIR, `${name}.enc.json`);

    if (!fs.existsSync(sessionFile)) {
        throw new Error(`Session "${name}" not found`);
    }

    const content = fs.readFileSync(sessionFile, 'utf-8');
    const encryptedData: EncryptedData = JSON.parse(content);

    return decrypt(encryptedData, password);
}

/**
 * Deletes a session
 */
export function deleteSession(name: string): boolean {
    const sessionFile = path.join(SESSIONS_DIR, `${name}.enc.json`);

    if (!fs.existsSync(sessionFile)) {
        return false;
    }

    fs.unlinkSync(sessionFile);

    // Update index
    const index = getSessionIndex();
    index.sessions = index.sessions.filter((s) => s.name !== name);
    updateSessionIndex(index);

    return true;
}

/**
 * Checks if a session exists
 */
export function sessionExists(name: string): boolean {
    const sessionFile = path.join(SESSIONS_DIR, `${name}.enc.json`);
    return fs.existsSync(sessionFile);
}

/**
 * Exports a session to a file
 */
export function exportSession(name: string, password: string, outputPath: string): void {
    const storageState = loadSession(name, password);
    fs.writeFileSync(outputPath, storageState);
}

/**
 * Gets the storage directory path
 */
export function getStorageDir(): string {
    return STORE_DIR;
}
