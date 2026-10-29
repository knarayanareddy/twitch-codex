import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SECONDS = 24 * 60 * 60;
function safeEqual(leftText, rightText) {
  const left = Buffer.from(String(leftText)); const right = Buffer.from(String(rightText));
  return left.length === right.length && timingSafeEqual(left, right);
}
function signature(payload, secret) { return createHmac('sha256', secret).update(`viewer-vote:${payload}`).digest('hex'); }
function voterHash(nonce, secret) { return createHmac('sha256', secret).update(`viewer-id:${nonce}`).digest('hex'); }

export function resolveVoterCookie(raw, { secret, now = Date.now(), secure = false } = {}) {
  if (typeof secret !== 'string' || secret.length < 24) throw new Error('Voter cookie signing requires a strong server secret.');
  if (raw) {
    const [nonce, expiresText, suppliedSignature, ...extra] = raw.split('.');
    const payload = `${nonce}.${expiresText}`;
    const expiry = Number(expiresText);
    if (!extra.length && /^[a-f0-9]{48}$/i.test(nonce || '') && Number.isSafeInteger(expiry) && expiry > now && expiry <= now + (MAX_AGE_SECONDS + 60) * 1000 && safeEqual(signature(payload, secret), suppliedSignature || '')) {
      return { hash: voterHash(nonce, secret), cookie: null, expiresAt: expiry };
    }
  }
  const nonce = randomBytes(24).toString('hex');
  const expiresAt = now + MAX_AGE_SECONDS * 1000;
  const payload = `${nonce}.${expiresAt}`;
  const signed = `${payload}.${signature(payload, secret)}`;
  const cookie = `context_desk_voter=${signed}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`;
  return { hash: voterHash(nonce, secret), cookie, expiresAt };
}
