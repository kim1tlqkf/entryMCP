import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = import.meta.dirname;
const secretPath = join(dir, 'pairing-secret');
const extensionPath = join(dir, 'extension', 'pairing.js');
let secret;
try { secret = (await readFile(secretPath, 'utf8')).trim(); }
catch { secret = randomBytes(32).toString('hex'); }
if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('PAIRING_SECRET_INVALID');
await writeFile(secretPath, `${secret}\n`, { mode: 0o600 });
await writeFile(extensionPath, `self.ENTRY_MCP_PAIRING = ${JSON.stringify(secret)};\n`);
process.stdout.write('Pairing files ready. Load the extension folder once in your usual Chrome profile.\n');
