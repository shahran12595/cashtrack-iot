// CashTrack IoT backend: checks and co-signs vault withdrawals.
// It never holds the phone's private key, so on its own it cannot create a valid withdrawal.
// Zero dependencies: Node's http and crypto modules only.

import { validateWithdrawal } from '../../core/src/dispense.js';
import { COMMAND_TTL_MS, signObject, verifyObject } from '../../core/src/secure.js';
import { SAMPLE_RATES } from '../../core/src/currency.js';

const MAX_BODY = 16 * 1024;
const MAX_REQUEST_AGE_MS = 120_000;

/**
 * @param {object} cfg
 * @param {string} cfg.vaultId
 * @param {string} cfg.phonePublicKey PEM of the owner's registered phone key
 * @param {string} cfg.backendPrivateKey PEM of the backend signing key
 * @param {number} cfg.dailyLimitBDT daily withdrawal limit in taka (all currencies converted)
 * @param {Record<string, number>} cfg.vaultInventory notes in the vault (reported by the vault)
 * @param {() => number} [cfg.clock]
 */
export function createBackend(cfg) {
  const clock = cfg.clock || Date.now;
  const rates = cfg.rates || SAMPLE_RATES;
  const usedNonces = new Map(); // nonce -> time first seen
  const withdrawals = []; // {t, bdt}
  const audit = [];

  const dayStart = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const spentToday = (now) => withdrawals.filter((w) => w.t >= dayStart(now)).reduce((a, w) => a + w.bdt, 0);

  function handleWithdraw(body) {
    const now = clock();
    const { request, phoneSig } = body || {};
    if (!request || typeof phoneSig !== 'string') return [400, { error: 'request and phoneSig are required' }];
    if (request.type !== 'WITHDRAW_REQUEST') return [400, { error: 'wrong request type' }];
    if (!verifyObject(request, phoneSig, cfg.phonePublicKey)) {
      audit.push({ t: now, event: 'REJECT', reason: 'bad phone signature' });
      return [401, { error: 'bad phone signature' }];
    }
    if (request.vaultId !== cfg.vaultId) return [400, { error: 'unknown vault' }];
    if (Math.abs(now - request.issuedAt) > MAX_REQUEST_AGE_MS) return [400, { error: 'request too old' }];
    for (const [n, t] of usedNonces) if (now - t > 24 * 3600_000) usedNonces.delete(n);
    if (usedNonces.has(request.nonce)) {
      audit.push({ t: now, event: 'REJECT', reason: 'nonce reused' });
      return [409, { error: 'nonce already used' }];
    }
    const check = validateWithdrawal(request.cur, request.amount, cfg.vaultInventory);
    if (!check.ok) return [422, { error: check.error }];
    const bdt = request.amount * (rates[request.cur] ?? NaN);
    if (spentToday(now) + bdt > cfg.dailyLimitBDT) {
      audit.push({ t: now, event: 'REJECT', reason: 'daily limit' });
      return [403, { error: 'daily withdrawal limit reached' }];
    }

    usedNonces.set(request.nonce, now);
    withdrawals.push({ t: now, bdt });
    for (const k of check.plan) cfg.vaultInventory[k] -= 1; // vault reports its real count after dispensing
    const command = {
      type: 'WITHDRAW',
      vaultId: cfg.vaultId,
      cur: request.cur,
      amount: request.amount,
      nonce: request.nonce,
      plan: check.plan,
      expiresAt: now + COMMAND_TTL_MS,
    };
    audit.push({ t: now, event: 'CO-SIGNED', cur: request.cur, amount: request.amount });
    return [200, { request, phoneSig, command, backendSig: signObject(command, cfg.backendPrivateKey) }];
  }

  async function handler(req, res) {
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    try {
      if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
      if (req.method === 'GET' && req.url === '/api/audit') return send(200, { audit });
      if (req.method === 'POST' && req.url === '/api/withdrawals') {
        let size = 0;
        const chunks = [];
        for await (const c of req) {
          size += c.length;
          if (size > MAX_BODY) return send(413, { error: 'body too large' });
          chunks.push(c);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        } catch {
          return send(400, { error: 'invalid JSON' });
        }
        const [status, out] = handleWithdraw(body);
        return send(status, out);
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      return send(500, { error: 'internal error' });
    }
  }

  return { handler, handleWithdraw, audit };
}
