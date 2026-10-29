import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export function loadEncryptionKey({ envValue, filename }) {
  if (envValue) {
    if (!/^[a-f0-9]{64}$/i.test(envValue)) throw new Error('TWITCH_TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters.');
    return Buffer.from(envValue, 'hex');
  }
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
  try { const saved = fs.readFileSync(filename, 'utf8').trim(); if (/^[a-f0-9]{64}$/i.test(saved)) return Buffer.from(saved, 'hex'); } catch { /* first boot */ }
  const key = randomBytes(32); fs.writeFileSync(filename, key.toString('hex'), { mode: 0o600 }); return key;
}
export function encryptJson(value, key) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${ciphertext.toString('base64')}`;
}
export function decryptJson(envelope, key) {
  const [ivHex, tagHex, body, ...extra] = String(envelope).split('.');
  if (extra.length || !/^[a-f0-9]{24}$/i.test(ivHex || '') || !/^[a-f0-9]{32}$/i.test(tagHex || '') || !body) throw new Error('Encrypted Twitch credential envelope is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex')); decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8'));
}
