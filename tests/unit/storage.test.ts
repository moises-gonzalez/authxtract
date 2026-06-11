/**
 * Unit tests for src/utils/storage.ts — Phase 0 security acceptance.
 *
 * Zero-dependency runner (node:test + ts-node). Run with: npm run test:unit
 * Tests run in a temporary working directory so the repo's own
 * .authxtract store is never touched.
 */

import { test, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    DecryptionError,
    LegacySessionError,
    deleteSession,
    ensureStorageDir,
    getSessionPath,
    listSessions,
    loadSession,
    saveSession,
    validateSessionName,
} from '../../src/utils/storage';

const PASSPHRASE = 'correct horse battery staple';
const STATE = { cookies: [{ name: 'sid', value: 's3cr3t' }], origins: [] };
const CAPTURE_URL = 'https://example.com/login';

let tmpDir: string;
let originalCwd: string;

before(() => {
    originalCwd = process.cwd();
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'authxtract-unit-')));
    process.chdir(tmpDir);
    // Isolate from any ambient key in the developer's shell.
    delete process.env.AUTHXTRACT_KEY;
    ensureStorageDir();
});

after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sessionsDir(): string {
    return path.join(tmpDir, '.authxtract', 'sessions');
}

interface Envelope {
    v: number;
    alg: string;
    kdf: string;
    salt: string;
    iv: string;
    tag: string;
    ct: string;
}

function readEnvelope(name: string): Envelope {
    return JSON.parse(fs.readFileSync(path.join(sessionsDir(), `${name}.json`), 'utf-8'));
}

function writeEnvelope(name: string, envelope: Envelope): void {
    fs.writeFileSync(path.join(sessionsDir(), `${name}.json`), JSON.stringify(envelope));
}

/** Change a single hex digit (= flip bits of one stored byte). */
function flipHexDigit(hex: string): string {
    const i = Math.floor(hex.length / 2);
    const flipped = hex[i] === '0' ? '1' : '0';
    return hex.slice(0, i) + flipped + hex.slice(i + 1);
}

/** Build an authentic v2 envelope around arbitrary plaintext (same scheme as storage.ts). */
function encryptEnvelope(plaintext: string, passphrase: string): Envelope {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(passphrase, salt, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
        v: 2,
        alg: 'aes-256-gcm',
        kdf: 'scrypt',
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
        ct: ct.toString('hex'),
    };
}

test('P0-1: validateSessionName accepts safe names', () => {
    for (const name of ['prod', 'My_Session-1.0', 'a', 'x'.repeat(64)]) {
        assert.equal(validateSessionName(name), name);
    }
});

test('P0-1: validateSessionName rejects traversal and unsafe names', () => {
    const bad = [
        '../../x',
        '..',
        '.',
        'a..b',
        'a/b',
        'a\\b',
        '/abs',
        'C:evil',
        'a:b',
        '',
        ' ',
        'name with space',
        'x'.repeat(65),
        'café',
    ];
    for (const name of bad) {
        assert.throws(
            () => validateSessionName(name),
            /Invalid session name/,
            `expected rejection of ${JSON.stringify(name)}`
        );
    }
});

test('P0-1: session operations with traversal names touch nothing outside the store', () => {
    const outside = path.join(tmpDir, 'x.json');
    fs.writeFileSync(outside, 'untouchable');

    assert.throws(() => getSessionPath('../../x'), /Invalid session name/);
    assert.throws(() => deleteSession('../../x'), /Invalid session name/);
    assert.throws(() => saveSession('../../x', STATE, CAPTURE_URL, PASSPHRASE), /Invalid session name/);
    assert.throws(() => loadSession('../../x', PASSPHRASE), /Invalid session name/);

    assert.equal(fs.readFileSync(outside, 'utf-8'), 'untouchable');
    fs.rmSync(outside);
});

test('P0-1: getSessionPath resolves to a direct child of .authxtract/sessions', () => {
    const sessionPath = getSessionPath('good-name');
    assert.equal(path.dirname(sessionPath), path.resolve(sessionsDir()));
    assert.equal(path.basename(sessionPath), 'good-name.json');
});

test('P0-2/P0-3: round-trip works and the file is decryptable with an independently scrypt-derived 32-byte key', () => {
    saveSession('roundtrip', STATE, CAPTURE_URL, PASSPHRASE);

    const loaded = loadSession('roundtrip', PASSPHRASE);
    assert.ok(loaded, 'session should load');
    assert.deepEqual(loaded.state, STATE);
    assert.equal(loaded.metadata.name, 'roundtrip');
    assert.equal(loaded.metadata.url, CAPTURE_URL);

    // Independent proof the file was encrypted with scrypt(passphrase, salt) → 32-byte AES-GCM key.
    const envelope = readEnvelope('roundtrip');
    const key = crypto.scryptSync(PASSPHRASE, Buffer.from(envelope.salt, 'hex'), 32);
    assert.equal(key.length, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ct, 'hex')),
        decipher.final(),
    ]).toString('utf8');
    assert.deepEqual(JSON.parse(plaintext).state, STATE);
});

test('P0-4: on-disk format is a versioned, self-describing v2 envelope', () => {
    saveSession('envelope', STATE, CAPTURE_URL, PASSPHRASE);
    const envelope = readEnvelope('envelope');
    assert.equal(envelope.v, 2);
    assert.equal(envelope.alg, 'aes-256-gcm');
    assert.equal(envelope.kdf, 'scrypt');
    assert.match(envelope.salt, /^[0-9a-f]{32}$/); // 16-byte salt
    assert.match(envelope.iv, /^[0-9a-f]{24}$/); // 12-byte GCM nonce
    assert.match(envelope.tag, /^[0-9a-f]{32}$/); // 16-byte auth tag
    assert.match(envelope.ct, /^[0-9a-f]+$/);
});

test('P0-3: same passphrase produces a fresh salt and different ciphertext per save', () => {
    saveSession('salt-a', STATE, CAPTURE_URL, PASSPHRASE);
    saveSession('salt-b', STATE, CAPTURE_URL, PASSPHRASE);
    const a = readEnvelope('salt-a');
    const b = readEnvelope('salt-b');
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ct, b.ct);
});

test('P0-3: any-length passphrases are accepted; empty is rejected', () => {
    saveSession('short-key', STATE, CAPTURE_URL, 'pw');
    const loaded = loadSession('short-key', 'pw');
    assert.ok(loaded);
    assert.deepEqual(loaded.state, STATE);

    // Empty explicit key falls back to env, which is unset here.
    assert.throws(() => saveSession('empty-key', STATE, CAPTURE_URL, ''), /AUTHXTRACT_KEY|key/i);
});

test('P0-2: flipping a ciphertext byte makes decryption fail with an authentication error', () => {
    saveSession('tamper-ct', STATE, CAPTURE_URL, PASSPHRASE);
    const envelope = readEnvelope('tamper-ct');
    envelope.ct = flipHexDigit(envelope.ct);
    writeEnvelope('tamper-ct', envelope);
    assert.throws(() => loadSession('tamper-ct', PASSPHRASE), DecryptionError);
});

test('P0-2: flipping an auth-tag byte makes decryption fail with an authentication error', () => {
    saveSession('tamper-tag', STATE, CAPTURE_URL, PASSPHRASE);
    const envelope = readEnvelope('tamper-tag');
    envelope.tag = flipHexDigit(envelope.tag);
    writeEnvelope('tamper-tag', envelope);
    assert.throws(() => loadSession('tamper-tag', PASSPHRASE), DecryptionError);
});

test('P0-9: wrong key and tampered file emit the same generic message with no crypto internals', () => {
    saveSession('generic-err', STATE, CAPTURE_URL, PASSPHRASE);

    let wrongKeyMessage = '';
    try {
        loadSession('generic-err', 'not-the-passphrase');
    } catch (error) {
        wrongKeyMessage = (error as Error).message;
    }

    const envelope = readEnvelope('generic-err');
    envelope.tag = flipHexDigit(envelope.tag);
    writeEnvelope('generic-err', envelope);
    let tamperedMessage = '';
    try {
        loadSession('generic-err', PASSPHRASE);
    } catch (error) {
        tamperedMessage = (error as Error).message;
    }

    assert.equal(wrongKeyMessage, 'Decryption failed — wrong key, or corrupted/legacy file.');
    assert.equal(tamperedMessage, wrongKeyMessage);
    assert.doesNotMatch(wrongKeyMessage, /unsupported state|bad decrypt|openssl|ERR_/i);
});

test('P0-4: legacy v1 (CBC) files are rejected with a friendly re-capture message', () => {
    const legacy = crypto.randomBytes(16).toString('hex') + ':' + crypto.randomBytes(64).toString('hex');
    fs.writeFileSync(path.join(sessionsDir(), 'legacy01.json'), legacy);

    assert.throws(
        () => loadSession('legacy01', PASSPHRASE),
        (error: unknown) =>
            error instanceof LegacySessionError &&
            /older, insecure format/.test(error.message) &&
            /re-run/.test(error.message)
    );
});

test('P0-8: authentic but structurally invalid session data is rejected', () => {
    const cases: Record<string, string> = {
        'bad-shape': JSON.stringify({ foo: 'bar' }),
        'bad-nonjson': 'not json at all',
        'bad-url': JSON.stringify({
            metadata: { name: 'bad-url', url: 'not a url', capturedAt: 'x' },
            state: {},
        }),
        'bad-state': JSON.stringify({
            metadata: { name: 'bad-state', url: CAPTURE_URL, capturedAt: 'x' },
            state: 'nope',
        }),
        'bad-noname': JSON.stringify({ metadata: { url: CAPTURE_URL, capturedAt: 'x' }, state: {} }),
    };
    for (const [name, payload] of Object.entries(cases)) {
        writeEnvelope(name, encryptEnvelope(payload, PASSPHRASE));
        assert.throws(() => loadSession(name, PASSPHRASE), /malformed/i, `expected rejection of ${name}`);
    }
});

test('P0-6: store directories are 0o700 and session files 0o600 on POSIX', (t) => {
    if (process.platform === 'win32') {
        t.skip('POSIX file modes are not enforced on Windows (profile ACLs apply)');
        return;
    }
    const isolated = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'authxtract-perm-')));
    const previousCwd = process.cwd();
    try {
        process.chdir(isolated);
        saveSession('perm', STATE, CAPTURE_URL, PASSPHRASE);
        const mode = (p: string) => fs.statSync(p).mode & 0o777;
        assert.equal(mode(path.join(isolated, '.authxtract')), 0o700);
        assert.equal(mode(path.join(isolated, '.authxtract', 'sessions')), 0o700);
        assert.equal(mode(path.join(isolated, '.authxtract', 'sessions', 'perm.json')), 0o600);
    } finally {
        process.chdir(previousCwd);
        fs.rmSync(isolated, { recursive: true, force: true });
    }
});

test('listSessions surfaces legacy/tampered files without throwing and decrypts valid ones', () => {
    const sessions = listSessions(PASSPHRASE);
    const byName = new Map(sessions.map((s) => [s.name, s]));

    assert.equal(byName.get('roundtrip')?.url, CAPTURE_URL);
    assert.match(byName.get('legacy01')?.url ?? '', /Legacy format/);
    assert.match(byName.get('tamper-ct')?.url ?? '', /Decryption Failed/);
    assert.match(byName.get('bad-shape')?.url ?? '', /Malformed Session Data/);
});

test('deleteSession removes only the named session and reports missing ones', () => {
    saveSession('delete-me', STATE, CAPTURE_URL, PASSPHRASE);
    assert.equal(deleteSession('delete-me'), true);
    assert.equal(fs.existsSync(path.join(sessionsDir(), 'delete-me.json')), false);
    assert.equal(deleteSession('delete-me'), false);
    // Neighbours are untouched.
    assert.equal(fs.existsSync(path.join(sessionsDir(), 'roundtrip.json')), true);
});
