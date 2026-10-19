// Starts the backend. Configuration comes from environment variables (see .env.example).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createBackend } from './app.js';
import { generateKeys } from '../../core/src/secure.js';

const env = process.env;
const readKey = (name) => {
  const v = env[name];
  if (!v) return null;
  return existsSync(v) ? readFileSync(v, 'utf8') : v.replace(/\\n/g, '\n');
};

let phonePublicKey = readKey('PHONE_PUBLIC_KEY');
let backendPrivateKey = readKey('BACKEND_PRIVATE_KEY');
if (!phonePublicKey || !backendPrivateKey) {
  if (env.NODE_ENV === 'production') {
    console.error('PHONE_PUBLIC_KEY and BACKEND_PRIVATE_KEY must be set in production.');
    process.exit(1);
  }
  const phone = generateKeys();
  const backend = generateKeys();
  phonePublicKey ||= phone.publicKey;
  backendPrivateKey ||= backend.privateKey;
  console.warn('DEV MODE: generated throwaway keys. Never use this in production.');
  console.warn('Backend public key (give this to the vault):\n' + backend.publicKey);
}

const inventory = env.VAULT_INVENTORY ? JSON.parse(env.VAULT_INVENTORY) : {
  'BDT:1000': 4, 'BDT:500': 6, 'BDT:200': 5, 'BDT:100': 10,
  'USD:100': 1, 'USD:50': 2, 'USD:20': 3, 'USD:10': 4,
  'CNY:100': 5, 'CNY:50': 4, 'CNY:20': 5, 'CNY:10': 5,
};

const app = createBackend({
  vaultId: env.VAULT_ID || 'vault-1',
  phonePublicKey,
  backendPrivateKey,
  dailyLimitBDT: Number(env.DAILY_LIMIT_BDT || 20000),
  vaultInventory: inventory,
});

const port = Number(env.PORT || 3000);
createServer(app.handler).listen(port, () => console.log(`CashTrack IoT backend on http://localhost:${port}`));
