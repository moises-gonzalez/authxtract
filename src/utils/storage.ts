/**
 * Storage utilities for saving and loading authentication state
 */

import * as fs from 'fs';
import * as path from 'path';

const AUTHXTRACT_DIR = '.authxtract';
const SESSIONS_DIR = 'sessions';

export interface SessionMetadata {
    name: string;
    url: string;
    capturedAt: string;
    expiresAt?: string;
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
export function saveSession(name: string, state: object, url: string): void {
    const sessionPath = getSessionPath(name);

    const sessionData = {
        metadata: {
            name,
            url,
            capturedAt: new Date().toISOString(),
        } as SessionMetadata,
        state,
    };

    fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
    console.log(`✅ Session saved: ${sessionPath}`);
}

/**
 * Load a session file
 */
export function loadSession(name: string): { metadata: SessionMetadata; state: object } | null {
    const sessionPath = getSessionPath(name);

    if (!fs.existsSync(sessionPath)) {
        return null;
    }

    const data = fs.readFileSync(sessionPath, 'utf-8');
    return JSON.parse(data);
}

/**
 * List all saved sessions
 */
export function listSessions(): SessionMetadata[] {
    const sessionsPath = path.join(process.cwd(), AUTHXTRACT_DIR, SESSIONS_DIR);

    if (!fs.existsSync(sessionsPath)) {
        return [];
    }

    const files = fs.readdirSync(sessionsPath).filter(f => f.endsWith('.json'));

    return files.map(file => {
        const data = fs.readFileSync(path.join(sessionsPath, file), 'utf-8');
        const session = JSON.parse(data);
        return session.metadata;
    });
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
