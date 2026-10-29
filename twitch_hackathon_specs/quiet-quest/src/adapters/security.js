import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function loadSigningSecret({ envValue, filename }) {
  if (envValue) {
    if (envValue.length < 32) throw new Error('QUIET_QUEST_COOKIE_SECRET must contain at least 32 characters.');
    return envValue;
  }
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
  try { const saved = fs.readFileSync(filename, 'utf8').trim(); if (/^[a-f0-9]{64}$/i.test(saved)) return saved; } catch { /* first boot */ }
  const secret = randomBytes(32).toString('hex'); fs.writeFileSync(filename, secret, { mode: 0o600 }); return secret;
}
function equal(a, b) { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && timingSafeEqual(left, right); }
function mac(payload, secret, purpose) { return createHmac('sha256', secret).update(`${purpose}:${payload}`).digest('hex'); }
export function hashActor(identity, salt) { return createHmac('sha256', salt).update(`actor:${identity}`).digest('hex'); }
export function hashInvite(code, secret) { return mac(String(code), secret, 'quiet-quest-invite'); }
export function createOperatorCookie(secret, now = Date.now(), secure = false) {
  const payload = `${now + 8 * 60 * 60 * 1000}.${randomBytes(18).toString('hex')}`;
  const cookie = `qq_operator=${Buffer.from(payload).toString('base64url')}.${mac(payload, secret, 'operator')}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`;
  return cookie;
}
export function verifyOperatorCookie(raw, secret, now = Date.now()) {
  if (!raw) return false;
  const [encoded, supplied, ...extra] = raw.split('.');
  if (extra.length || !encoded || !supplied) return false;
  let payload; try { payload = Buffer.from(encoded, 'base64url').toString(); } catch { return false; }
  const [expiry, nonce, ...rest] = payload.split('.');
  return rest.length === 0 && /^[a-f0-9]{36}$/i.test(nonce || '') && Number.isSafeInteger(Number(expiry)) && Number(expiry) > now && equal(mac(payload, secret, 'operator'), supplied);
}
export function createParticipantCookie(sessionId, secret, now = Date.now(), secure = false) {
  const nonce = randomBytes(24).toString('hex'); const expires = now + 24 * 60 * 60 * 1000;
  const payload = `${sessionId}.${nonce}.${expires}`;
  const value = `${payload}.${mac(payload, secret, 'participant')}`;
  return { nonce, expiresAt: expires, cookie: `qq_participant=${value}; HttpOnly; SameSite=Strict; Path=/api/companion; Max-Age=86400${secure ? '; Secure' : ''}` };
}
export function verifyParticipantCookie(raw, secret, now = Date.now()) {
  if (!raw) return null;
  const [sessionId, nonce, expiryText, supplied, ...extra] = raw.split('.');
  const payload = `${sessionId}.${nonce}.${expiryText}`; const expiry = Number(expiryText);
  if (extra.length || !/^[a-f0-9-]{36}$/i.test(sessionId || '') || !/^[a-f0-9]{48}$/i.test(nonce || '') || !Number.isSafeInteger(expiry) || expiry <= now || !equal(mac(payload, secret, 'participant'), supplied || '')) return null;
  return { sessionId, nonce, expiresAt: expiry };
}
export function readCookie(req, name) {
  const prefix = `${name}=`;
  return req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || null;
}
export function requireSameOrigin(req, { trustProxy = false } = {}) {
  const origin = req.headers.origin;
  const host = trustProxy ? (req.headers['x-forwarded-host'] || req.headers.host) : req.headers.host;
  const forwardedProto = trustProxy ? req.headers['x-forwarded-proto'] : null;
  const protocol = String((forwardedProto || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0]).trim().toLowerCase();
  if (!origin || !host || !['http', 'https'].includes(protocol)) { const error = new Error('A same-origin request is required.'); error.status = 403; throw error; }
  let parsed; try { parsed = new URL(origin); } catch { const error = new Error('Request origin was rejected.'); error.status = 403; throw error; }
  const requestHost = String(host).split(',')[0].trim();
  if (parsed.protocol !== `${protocol}:` || parsed.host.toLowerCase() !== requestHost.toLowerCase()) { const error = new Error('Request origin was rejected.'); error.status = 403; throw error; }
}
export function hashNetworkAddress(address, secret) { return mac(address || 'unknown', secret, 'rate-limit'); }
