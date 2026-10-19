// Security building blocks, as described in the technical documentation (section 6).
//
// 1. Wallet → phone events: AES-128-GCM with a session key, plus a monotonic `seq` counter.
// 2. Vault withdrawals need two ECDSA P-256 signatures:
//      phone key (unlocked by fingerprint or PIN)  → signs the request
//      backend key (after limit + nonce checks)     → co-signs the command
//    The vault verifies both itself, so neither a hacked server nor a copied request can release cash.

import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';

export const COMMAND_TTL_MS = 60_000;

/** Stable JSON with sorted keys, so both sides sign exactly the same bytes. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function generateKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

export const signObject = (obj, privateKeyPem) => sign('sha256', Buffer.from(canonical(obj)), privateKeyPem).toString('base64');

export function verifyObject(obj, signatureB64, publicKeyPem) {
  try {
    return verify('sha256', Buffer.from(canonical(obj)), publicKeyPem, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

// ---------- Wallet events over BLE ----------

/** Encrypts one wallet event. The seq counter is inside the authenticated data. */
export function sealEvent(event, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-128-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(event)), cipher.final()]);
  return { iv: iv.toString('base64'), body: body.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

/** Phone-side receiver: decrypts, authenticates and rejects repeated or out-of-order events. */
export class EventReceiver {
  constructor(key, lastSeq = 0) {
    this.key = key;
    this.lastSeq = lastSeq;
  }

  open(packet) {
    return this.#accept(Buffer.from(packet.iv, 'base64'), Buffer.from(packet.body, 'base64'), Buffer.from(packet.tag, 'base64'));
  }

  /** Binary packet exactly as the wallet firmware sends it over BLE: iv(12) | ciphertext | tag(16). */
  openBytes(bytes) {
    const b = Buffer.from(bytes);
    if (b.length < 29) return { ok: false, error: 'packet too short' };
    return this.#accept(b.subarray(0, 12), b.subarray(12, b.length - 16), b.subarray(b.length - 16));
  }

  #accept(iv, body, tag) {
    let event;
    try {
      const d = createDecipheriv('aes-128-gcm', this.key, iv);
      d.setAuthTag(tag);
      event = JSON.parse(Buffer.concat([d.update(body), d.final()]).toString());
    } catch {
      return { ok: false, error: 'authentication failed' };
    }
    if (!Number.isInteger(event.seq) || event.seq <= this.lastSeq) return { ok: false, error: 'replayed or out-of-order event' };
    this.lastSeq = event.seq;
    return { ok: true, event };
  }
}

// ---------- Vault withdrawals ----------

/** Phone: build and sign a withdrawal request (after a fingerprint or PIN unlocked the key). */
export function createWithdrawRequest({ vaultId, cur, amount, now = Date.now(), nonce = randomBytes(16).toString('hex') }, phonePrivateKey) {
  const request = { type: 'WITHDRAW_REQUEST', vaultId, cur, amount, nonce, issuedAt: now };
  return { request, phoneSig: signObject(request, phonePrivateKey) };
}

/** Vault firmware logic (mirrored in C on the ESP32): verify both signatures, freshness and nonce. */
export class VaultVerifier {
  constructor({ vaultId, phonePublicKey, backendPublicKey }) {
    this.vaultId = vaultId;
    this.phonePublicKey = phonePublicKey;
    this.backendPublicKey = backendPublicKey;
    this.usedNonces = new Set();
  }

  /** @returns {{ok:true, plan:string[]} | {ok:false, error:string}} */
  verify(signed, now = Date.now()) {
    const { command, backendSig, request, phoneSig } = signed || {};
    if (!command || !request) return { ok: false, error: 'malformed command' };
    if (!verifyObject(request, phoneSig, this.phonePublicKey)) return { ok: false, error: 'bad phone signature' };
    if (!verifyObject(command, backendSig, this.backendPublicKey)) return { ok: false, error: 'bad backend signature' };
    if (command.vaultId !== this.vaultId || request.vaultId !== this.vaultId) return { ok: false, error: 'wrong vault' };
    if (command.cur !== request.cur || command.amount !== request.amount || command.nonce !== request.nonce) {
      return { ok: false, error: 'command does not match the signed request' };
    }
    if (now > command.expiresAt) return { ok: false, error: 'command expired' };
    if (this.usedNonces.has(command.nonce)) return { ok: false, error: 'nonce already used' };
    this.usedNonces.add(command.nonce);
    return { ok: true, plan: command.plan };
  }
}
