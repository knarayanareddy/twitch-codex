import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function parseEncryptionKey(value) {
  if (!value) return null;
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(value)) key = Buffer.from(value, 'hex');
  else key = Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

export function encryptSecret(plaintext, key, { nonce = randomBytes(12) } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('Encryption key must be 32 bytes.');
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return { nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

export function decryptSecret(record, key) {
  if (!record || !Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('Encrypted secret or key is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function hashActor(actorId, salt) {
  return createHmac('sha256', salt).update(String(actorId)).digest('hex');
}

export function makeOAuthState() { return randomBytes(32).toString('base64url'); }

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function parseVoteCommand(text) {
  if (typeof text !== 'string' || text.length > 300) return null;
  const match = text.trim().match(/^!habitat\s+([12])\s*$/i);
  return match ? Number(match[1]) - 1 : null;
}

export class SlidingWindowLimiter {
  constructor({ limit = 12, windowMs = 60_000, now = () => Date.now() } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
  }
  allow(key) {
    const now = this.now();
    const recent = (this.entries.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) { this.entries.set(key, recent); return false; }
    recent.push(now);
    this.entries.set(key, recent);
    for (const [entryKey, times] of this.entries) {
      if (times.every((time) => now - time >= this.windowMs)) this.entries.delete(entryKey);
    }
    if (this.entries.size > 2000) {
      const oldest = [...this.entries.keys()].slice(0, this.entries.size - 2000);
      for (const entryKey of oldest) this.entries.delete(entryKey);
    }
    return true;
  }
}
