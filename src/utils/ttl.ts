/**
 * Session TTL parsing and formatting.
 */

import { UsageError } from './errors';

const TTL_PATTERN = /^(\d+)([mhd])$/;

const UNIT_MS: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
};

const MAX_TTL_MS = 365 * UNIT_MS.d;

/**
 * Parse a TTL like "30m", "12h", "7d", or "none" (no expiry).
 * Returns milliseconds, or null when expiry is disabled.
 */
export function parseTtl(value: string): number | null {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'none' || normalized === '0') {
        return null;
    }
    const match = TTL_PATTERN.exec(normalized);
    if (!match) {
        throw new UsageError(
            `Invalid --ttl "${value}". Use <number><unit> with unit m/h/d (e.g. 30m, 12h, 7d) or "none".`
        );
    }
    const amount = Number(match[1]);
    const ms = amount * UNIT_MS[match[2]];
    if (amount === 0 || ms > MAX_TTL_MS) {
        throw new UsageError(`Invalid --ttl "${value}". Must be greater than 0 and at most 365d.`);
    }
    return ms;
}

/** ISO timestamp `ttlMs` from now, or undefined when expiry is disabled. */
export function expiresAtFrom(ttlMs: number | null, now: Date = new Date()): string | undefined {
    if (ttlMs === null) return undefined;
    return new Date(now.getTime() + ttlMs).toISOString();
}

/** Whether an ISO `expiresAt` lies in the past. Missing/invalid values never expire. */
export function isExpired(expiresAt: string | undefined, now: Date = new Date()): boolean {
    if (!expiresAt) return false;
    const ts = Date.parse(expiresAt);
    if (Number.isNaN(ts)) return false;
    return ts <= now.getTime();
}
