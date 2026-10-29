import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function equal(left, right) { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && timingSafeEqual(a, b); }
function mac(payload, secret, purpose) { return createHmac('sha256', secret).update(`${purpose}:${payload}`).digest('hex'); }
export function loadSigningSecret({ envValue, filename }) {
  if (envValue) { if (envValue.length < 32) throw new Error('OPEN_LAB_COOKIE_SECRET must contain at least 32 characters.'); return envValue; }
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
  try { const saved = fs.readFileSync(filename, 'utf8').trim(); if (/^[a-f0-9]{64}$/i.test(saved)) return saved; } catch {}
  const secret = randomBytes(32).toString('hex'); fs.writeFileSync(filename, secret, { mode: 0o600 }); return secret;
}
export function createOperatorCookie(secret, now = Date.now(), secure = false) {
  const payload = `${now + 8 * 60 * 60 * 1000}.${randomBytes(18).toString('hex')}`;
  const value = `${Buffer.from(payload).toString('base64url')}.${mac(payload, secret, 'open-lab-operator')}`;
  return `ol_operator=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`;
}
export function verifyOperatorCookie(raw, secret, now = Date.now()) {
  if (!raw) return false;
  const [encoded, supplied, ...extra] = raw.split('.'); if (!encoded || !supplied || extra.length) return false;
  let payload; try { payload = Buffer.from(encoded, 'base64url').toString(); } catch { return false; }
  const [expiryText, nonce, ...rest] = payload.split('.'); const expiry = Number(expiryText);
  return rest.length === 0 && /^[a-f0-9]{36}$/i.test(nonce || '') && Number.isSafeInteger(expiry) && expiry > now && equal(mac(payload, secret, 'open-lab-operator'), supplied);
}
export function hashActor(actorId, salt) { return createHmac('sha256', salt).update(`actor:${actorId}`).digest('hex'); }
export function hashAddress(address, secret) { return mac(address || 'unknown', secret, 'open-lab-rate-limit'); }
export function readCookie(req, name) {
  const prefix = `${name}=`;
  return req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || null;
}
export function requireSameOrigin(req, { trustProxy = false } = {}) {
  const origin = req.headers.origin; const host = trustProxy ? (req.headers['x-forwarded-host'] || req.headers.host) : req.headers.host;
  const forwardedProto = trustProxy ? req.headers['x-forwarded-proto'] : null;
  const protocol = String((forwardedProto || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0]).trim().toLowerCase();
  if (!origin || !host || !['http','https'].includes(protocol)) { const error = new Error('A same-origin request is required.'); error.status = 403; throw error; }
  let parsed; try { parsed = new URL(origin); } catch { const error = new Error('Request origin was rejected.'); error.status = 403; throw error; }
  if (parsed.protocol !== `${protocol}:` || parsed.host.toLowerCase() !== String(host).split(',')[0].trim().toLowerCase()) { const error = new Error('Request origin was rejected.'); error.status = 403; throw error; }
}
