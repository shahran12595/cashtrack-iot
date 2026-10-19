// Generates ECDSA P-256 key pairs for local testing: the backend's signing key and a stand-in phone key.
// Usage: node scripts/gen-keys.js [outDir=keys]
// In the real app the phone key is created inside Android Keystore / iOS Secure Enclave and never exported.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeys } from '../core/src/secure.js';

const dir = process.argv[2] || 'keys';
mkdirSync(dir, { recursive: true });
for (const name of ['backend', 'phone']) {
  const k = generateKeys();
  writeFileSync(join(dir, `${name}-private.pem`), k.privateKey, { mode: 0o600 });
  writeFileSync(join(dir, `${name}-public.pem`), k.publicKey);
}
console.log(`Wrote backend and phone key pairs to ${dir}/ (keep the private keys out of git).`);
