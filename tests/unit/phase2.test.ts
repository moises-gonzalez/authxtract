/**
 * Unit tests for Phase 2 features: session TTL, --storage-dir override,
 * and key-provider resolution (env / command / flag precedence).
 *
 * Runs in its own process with a temporary working directory.
 */

import { test, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    SessionExpiredError,
    getSessionsRoot,
    listSessions,
    loadSession,
    saveSession,
    setStorageDir,
} from '../../src/utils/storage';
import { parseTtl, expiresAtFrom, isExpired } from '../../src/utils/ttl';
import {
    CommandKeyProvider,
    EnvKeyProvider,
    FlagKeyProvider,
    KEY_CMD_ENV,
    resolveKeyProvider,
} from '../../src/utils/key-provider';
import { UsageError } from '../../src/utils/errors';

const PASSPHRASE = 'correct horse battery staple';
const STATE = { cookies: [{ name: 'sid', value: 's3cr3t' }], origins: [] };
const CAPTURE_URL = 'https://example.com/login';

let tmpDir: string;
let originalCwd: string;

before(() => {
    originalCwd = process.cwd();
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'authxtract-phase2-')));
    process.chdir(tmpDir);
    // Isolate from ambient configuration in the developer's shell.
    delete process.env.AUTHXTRACT_KEY;
    delete process.env[KEY_CMD_ENV];
});

after(() => {
    setStorageDir(null);
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sessionsDir(): string {
    return path.join(tmpDir, '.authxtract', 'sessions');
}

// ---------- TTL parsing ----------

test('TTL: parseTtl accepts m/h/d units and "none"', () => {
    assert.equal(parseTtl('30m'), 30 * 60_000);
    assert.equal(parseTtl('12h'), 12 * 3_600_000);
    assert.equal(parseTtl('7d'), 7 * 86_400_000);
    assert.equal(parseTtl('none'), null);
    assert.equal(parseTtl('NONE'), null);
    assert.equal(parseTtl('0'), null);
});

test('TTL: parseTtl rejects malformed or out-of-range values with a usage error', () => {
    for (const bad of ['', '5w', '1.5h', '-1h', 'abc', '0h', '400d', '24', 'h']) {
        assert.throws(() => parseTtl(bad), UsageError, `expected rejection of ${JSON.stringify(bad)}`);
    }
});

test('TTL: expiresAtFrom and isExpired round-trip', () => {
    const now = new Date('2026-06-10T12:00:00.000Z');
    assert.equal(expiresAtFrom(null, now), undefined);
    assert.equal(expiresAtFrom(3_600_000, now), '2026-06-10T13:00:00.000Z');

    assert.equal(isExpired(undefined), false);
    assert.equal(isExpired('not-a-date'), false);
    assert.equal(isExpired('2026-06-10T13:00:00.000Z', new Date('2026-06-10T12:59:59.000Z')), false);
    assert.equal(isExpired('2026-06-10T13:00:00.000Z', new Date('2026-06-10T13:00:01.000Z')), true);
});

// ---------- TTL enforcement in storage ----------

test('TTL: sessions with a future expiry save and load normally', () => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    saveSession('fresh', STATE, CAPTURE_URL, PASSPHRASE, { expiresAt });
    const loaded = loadSession('fresh', PASSPHRASE);
    assert.ok(loaded);
    assert.equal(loaded.metadata.expiresAt, expiresAt);
});

test('TTL: expired sessions are refused on load with a re-capture message', () => {
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    saveSession('stale', STATE, CAPTURE_URL, PASSPHRASE, { expiresAt });
    assert.throws(
        () => loadSession('stale', PASSPHRASE),
        (error: unknown) =>
            error instanceof SessionExpiredError &&
            /expired on/.test(error.message) &&
            /re-run/.test(error.message)
    );
});

test('TTL: sessions without expiresAt never expire', () => {
    saveSession('immortal', STATE, CAPTURE_URL, PASSPHRASE);
    const loaded = loadSession('immortal', PASSPHRASE);
    assert.ok(loaded);
    assert.equal(loaded.metadata.expiresAt, undefined);
});

test('TTL: list still shows expired sessions (with their expiry) without throwing', () => {
    const sessions = listSessions(PASSPHRASE);
    const stale = sessions.find((s) => s.name === 'stale');
    assert.ok(stale, 'expired session should still be listed');
    assert.ok(stale.expiresAt && Date.parse(stale.expiresAt) < Date.now());
});

test('TTL: authentic data with a non-string expiresAt is rejected as malformed', () => {
    // Craft an authentic envelope (same scheme as storage.ts) around bad metadata.
    const payload = JSON.stringify({
        metadata: { name: 'bad-ttl', url: CAPTURE_URL, capturedAt: 'x', expiresAt: 12345 },
        state: {},
    });
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(PASSPHRASE, salt, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const envelope = {
        v: 2,
        alg: 'aes-256-gcm',
        kdf: 'scrypt',
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
        ct: ct.toString('hex'),
    };
    fs.writeFileSync(path.join(sessionsDir(), 'bad-ttl.json'), JSON.stringify(envelope));
    assert.throws(() => loadSession('bad-ttl', PASSPHRASE), /malformed/i);
});

// ---------- --storage-dir override ----------

test('storage-dir: setStorageDir relocates the store and round-trips', () => {
    const altDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'authxtract-altstore-')));
    try {
        setStorageDir(altDir);
        assert.equal(getSessionsRoot(), path.join(altDir, 'sessions'));

        saveSession('relocated', STATE, CAPTURE_URL, PASSPHRASE);
        assert.equal(fs.existsSync(path.join(altDir, 'sessions', 'relocated.json')), true);
        assert.equal(fs.existsSync(path.join(sessionsDir(), 'relocated.json')), false);

        const loaded = loadSession('relocated', PASSPHRASE);
        assert.ok(loaded);
        assert.deepEqual(loaded.state, STATE);

        const names = listSessions(PASSPHRASE).map((s) => s.name);
        assert.deepEqual(names, ['relocated']);
    } finally {
        setStorageDir(null);
        fs.rmSync(altDir, { recursive: true, force: true });
    }
});

test('storage-dir: default store root is cwd-relative ./.authxtract', () => {
    assert.equal(getSessionsRoot(), path.join(tmpDir, '.authxtract', 'sessions'));
});

// ---------- Key provider resolution ----------

test('key-provider: explicit --key flag wins over everything', async () => {
    process.env.AUTHXTRACT_KEY = 'env-secret';
    process.env[KEY_CMD_ENV] = 'node -p "\'cmd-secret\'"';
    try {
        const provider = resolveKeyProvider('flag-secret');
        assert.ok(provider instanceof FlagKeyProvider);
        assert.equal(await provider.getPassphrase(), 'flag-secret');
    } finally {
        delete process.env.AUTHXTRACT_KEY;
        delete process.env[KEY_CMD_ENV];
    }
});

test('key-provider: AUTHXTRACT_KEY env wins over the key command', async () => {
    process.env.AUTHXTRACT_KEY = 'env-secret';
    process.env[KEY_CMD_ENV] = 'node -p "\'cmd-secret\'"';
    try {
        const provider = resolveKeyProvider();
        assert.ok(provider instanceof EnvKeyProvider);
        assert.equal(await provider.getPassphrase(), 'env-secret');
    } finally {
        delete process.env.AUTHXTRACT_KEY;
        delete process.env[KEY_CMD_ENV];
    }
});

test('key-provider: AUTHXTRACT_KEY_CMD output (trimmed) becomes the passphrase', async () => {
    process.env[KEY_CMD_ENV] = 'node -p "\'cmd-secret\'"';
    try {
        const provider = resolveKeyProvider();
        assert.ok(provider instanceof CommandKeyProvider);
        assert.equal(await provider.getPassphrase(), 'cmd-secret');
    } finally {
        delete process.env[KEY_CMD_ENV];
    }
});

test('key-provider: a failing or silent key command is a clear usage error', async () => {
    await assert.rejects(new CommandKeyProvider('node -e "process.exit(3)"').getPassphrase(), UsageError);
    await assert.rejects(new CommandKeyProvider('node -e "0"').getPassphrase(), UsageError);
});
