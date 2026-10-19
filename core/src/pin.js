// PIN fallback for vault withdrawals.
// A dry or wet finger can fail to scan. After 3 failed touches the app offers a 6-digit PIN.
// The PIN is checked on the phone only (stored as a salted scrypt hash, never sent anywhere).
// 5 wrong PINs lock withdrawals for 30 s; each further lockout doubles the wait (max 15 min).

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const PIN_LENGTH = 6;
export const FINGERPRINT_TRIES_BEFORE_PIN = 3;
export const MAX_WRONG_PINS = 5;
export const BASE_LOCK_MS = 30_000;
export const MAX_LOCK_MS = 15 * 60_000;

/** Whether the PIN pad should be offered after this many failed fingerprint touches. */
export function shouldOfferPin(failedTouches) {
  return failedTouches >= FINGERPRINT_TRIES_BEFORE_PIN;
}

/** Rejects PINs that are easy to guess. Returns null when the PIN is acceptable, or a reason. */
export function pinProblem(pin) {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return 'must be exactly 6 digits';
  if (/^(\d)\1{5}$/.test(pin)) return 'all digits are the same';
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'digits are in sequence';
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return 'repeating pattern';
  return null;
}

export function hashPin(pin, salt = randomBytes(16)) {
  const hash = scryptSync(pin, salt, 32);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

export class PinGuard {
  /** @param {{salt:string, hash:string}} record from hashPin */
  constructor(record, state = {}) {
    this.record = record;
    this.fails = state.fails || 0;
    this.lockouts = state.lockouts || 0;
    this.lockedUntil = state.lockedUntil || 0;
  }

  static create(pin) {
    const problem = pinProblem(pin);
    if (problem) throw new RangeError(`PIN rejected: ${problem}`);
    return new PinGuard(hashPin(pin));
  }

  isLocked(now = Date.now()) {
    return now < this.lockedUntil;
  }

  /** @returns {{ok:boolean, locked?:boolean, triesLeft?:number, lockedUntil?:number}} */
  verify(pin, now = Date.now()) {
    if (this.isLocked(now)) return { ok: false, locked: true, lockedUntil: this.lockedUntil };
    const salt = Buffer.from(this.record.salt, 'hex');
    const expected = Buffer.from(this.record.hash, 'hex');
    const got = scryptSync(String(pin), salt, 32);
    if (timingSafeEqual(got, expected)) {
      this.fails = 0;
      this.lockouts = 0;
      return { ok: true };
    }
    this.fails += 1;
    if (this.fails >= MAX_WRONG_PINS) {
      this.fails = 0;
      this.lockouts += 1;
      const wait = Math.min(BASE_LOCK_MS * 2 ** (this.lockouts - 1), MAX_LOCK_MS);
      this.lockedUntil = now + wait;
      return { ok: false, locked: true, lockedUntil: this.lockedUntil };
    }
    return { ok: false, triesLeft: MAX_WRONG_PINS - this.fails };
  }

  /** Changing the PIN needs the current PIN (or a fresh fingerprint, checked by the caller). */
  change(newPin) {
    const problem = pinProblem(newPin);
    if (problem) throw new RangeError(`PIN rejected: ${problem}`);
    this.record = hashPin(newPin);
    this.fails = 0;
  }

  toJSON() {
    return { record: this.record, fails: this.fails, lockouts: this.lockouts, lockedUntil: this.lockedUntil };
  }
}
