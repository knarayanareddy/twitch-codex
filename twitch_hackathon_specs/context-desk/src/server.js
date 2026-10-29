import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual, createHmac, randomUUID } from 'node:crypto';
import { SqliteStore } from './adapters/storage/sqlite-store.js';
import { ContextDesk, DeskError } from './application/context-desk.js';
import { ViewerPoll } from './application/viewer-poll.js';
import { SOURCE_PACK, SOURCES, validateSourcePack } from './domain/source-pack.js';
import { EventSubReplayGuard, parseChatMessage, verifyEventSubSignature } from './adapters/twitch/eventsub.js';
import { TwitchOAuthManager, TwitchOAuthError } from './adapters/twitch/oauth-manager.js';
import { resolveVoterCookie } from './adapters/security/voter-cookie.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
function loadSessionId() {
  if (process.env.CONTEXT_DESK_SESSION_ID) {
    if (!/^[a-f0-9]{24,64}$/i.test(process.env.CONTEXT_DESK_SESSION_ID)) throw new Error('CONTEXT_DESK_SESSION_ID must be 24–64 hexadecimal characters.');
    return process.env.CONTEXT_DESK_SESSION_ID;
  }
  const sessionPath = path.resolve(process.cwd(), 'data/.context-desk-session-key');
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
  try {
    const saved = fs.readFileSync(sessionPath, 'utf8').trim();
    if (/^[a-f0-9]{40}$/i.test(saved)) return saved;
  } catch { /* first boot */ }
  const generated = randomBytes(20).toString('hex');
  fs.writeFileSync(sessionPath, generated, { mode: 0o600 });
  return generated;
}
const SESSION_ID = loadSessionId();
function loadCookieSecret() {
  if (process.env.CONTEXT_DESK_COOKIE_SECRET) {
    if (process.env.CONTEXT_DESK_COOKIE_SECRET.length < 32) throw new Error('CONTEXT_DESK_COOKIE_SECRET must contain at least 32 characters.');
    return process.env.CONTEXT_DESK_COOKIE_SECRET;
  }
  const secretPath = path.resolve(process.cwd(), 'data/.context-desk-cookie-secret');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true, mode: 0o700 });
  try {
    const saved = fs.readFileSync(secretPath, 'utf8').trim();
    if (/^[a-f0-9]{64}$/i.test(saved)) return saved;
  } catch { /* first boot */ }
  const generated = randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}
const COOKIE_SECRET = loadCookieSecret();
const configuredPasscode = process.env.CONTEXT_DESK_ACCESS_TOKEN || process.env.DEMO_PASSCODE || '';
const demoMode = process.env.DEMO_MODE === '1' && configuredPasscode.length >= 12;
const authReady = demoMode || (configuredPasscode.length >= 24 && Boolean(process.env.CONTEXT_DESK_COOKIE_SECRET));
const passcodeRole = demoMode ? 'demo-broadcaster' : 'broadcaster';
const dbPath = process.env.DATABASE_PATH || './data/context-desk.sqlite';
const store = new SqliteStore(dbPath);
const desk = new ContextDesk({ store, sessionId: SESSION_ID, actorSecret: COOKIE_SECRET });
const viewerPoll = new ViewerPoll({ store, sessionId: SESSION_ID });
const twitch = new TwitchOAuthManager({ store, sessionId: SESSION_ID });
const twitchRefreshTimer = twitch.startRefreshLoop();
const replayGuard = new EventSubReplayGuard();
const loginAttempts = new Map();
let lastTwitchEventAt = null;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
};

function secureCompare(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function signSession(payload) { return createHmac('sha256', COOKIE_SECRET).update(payload).digest('hex'); }
function sessionCookie(role) {
  const payload = `${Date.now() + 60 * 60 * 1000}:${role}:${randomBytes(12).toString('hex')}`;
  const value = `${Buffer.from(payload).toString('base64url')}.${signSession(payload)}`;
  return `context_desk_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY_HTTPS === '1' ? '; Secure' : ''}`;
}
function cookieValue(req, name) {
  const prefix = `${name}=`;
  return req.headers.cookie?.split(';').map((p) => p.trim()).find((p) => p.startsWith(prefix))?.slice(prefix.length) || null;
}
function clearTwitchStateCookie() { return `context_desk_twitch_state=; HttpOnly; SameSite=Lax; Path=/auth/twitch/callback; Max-Age=0${process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY_HTTPS === '1' ? '; Secure' : ''}`; }
function readSession(req) {
  const raw = cookieValue(req, 'context_desk_session');
  if (!raw) return null;
  const [encoded, signature] = raw.split('.');
  if (!encoded || !signature) return null;
  let payload;
  try { payload = Buffer.from(encoded, 'base64url').toString(); } catch { return null; }
  if (!secureCompare(signSession(payload), signature)) return null;
  const [expiryText, role] = payload.split(':');
  if (!Number.isFinite(Number(expiryText)) || Number(expiryText) <= Date.now() || !['broadcaster', 'demo-broadcaster'].includes(role)) return null;
  return { role };
}
function send(res, status, data, headers = {}) {
  const body = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  res.writeHead(status, { ...securityHeaders, 'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function sendError(res, error) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(`[context-desk] ${error.name}: ${error.message}`);
  send(res, status, { error: { code: error.code || 'INTERNAL_ERROR', message: status >= 500 ? 'Context Desk could not complete that action. No card was published.' : error.message } });
}
async function readBody(req, limit = 12 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new DeskError('BODY_TOO_LARGE', 'Request body exceeds the allowed size.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new DeskError('CONTENT_TYPE_REQUIRED', 'Send a JSON request.', 415);
  const raw = await readBody(req);
  try { return JSON.parse(raw); } catch { throw new DeskError('INVALID_JSON', 'Request body is not valid JSON.', 400); }
}
function requireSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!origin || !host) throw new DeskError('ORIGIN_REQUIRED', 'A same-origin request is required.', 403);
  let parsed;
  try { parsed = new URL(origin); } catch { throw new DeskError('ORIGIN_FORBIDDEN', 'Request origin was rejected.', 403); }
  if (parsed.host.toLowerCase() !== String(host).toLowerCase()) throw new DeskError('ORIGIN_FORBIDDEN', 'Request origin was rejected.', 403);
}
function requireAuth(req) {
  const session = readSession(req);
  if (!session) throw new DeskError('AUTH_REQUIRED', 'Sign in as the local broadcaster to use review controls.', 401);
  return session;
}
function safeOverlayCard(card) {
  if (!card) return null;
  return { publicQuestion: card.publicQuestion, title: card.title, summary: card.summary, bullets: card.bullets, uncertainty: card.uncertainty, provenanceLabel: card.provenanceLabel, evidence: card.evidence.map(({ sourceTitle, publisher, url }) => ({ sourceTitle, publisher, url })), publishedAt: card.publishedAt, expiresAt: card.expiresAt, reviewLabel: card.reviewLabel };
}
function markdownExport(cards) {
  const lines = ['# Context Desk recap', '', `Exported: ${new Date().toISOString()}`, '', 'Original submission wording and viewer identities are intentionally omitted. Approved public prompts are included. Cards expire after 24 hours.', ''];
  for (const card of cards) {
    lines.push(`## ${card.publicQuestion}`, '', `### ${card.title}`, '', ...card.bullets.map((bullet) => `- ${bullet}`), '', card.summary, '', `**What we cannot conclude:** ${card.uncertainty}`, '', `**Review:** ${card.reviewLabel} · ${card.provenanceLabel} · ${card.publishedAt}`, '', '**Sources:**');
    for (const source of card.evidence) lines.push(`- [${source.sourceTitle} — ${source.publisher}](${source.url}) · checked ${source.checkedAt}`);
    lines.push('');
  }
  return lines.join('\n');
}
function sourcesPublic() {
  return SOURCES.map(({ id, sourceTitle, publisher, url, checkedAt, licenseUsageNote, excerpt }) => ({ id, sourceTitle, publisher, url, checkedAt, licenseUsageNote, excerpt }));
}
function staticFile(res, file) {
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, { ...securityHeaders, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { send(res, 404, 'Not found'); }
}

validateSourcePack(SOURCE_PACK);
const server = http.createServer(async (req, res) => {
  const base = `http://${req.headers.host || 'localhost'}`;
  let url;
  try { url = new URL(req.url || '/', base); } catch { send(res, 400, { error: { code: 'BAD_URL', message: 'Invalid request URL.' } }); return; }
  const method = req.method || 'GET';
  try {
    if (method === 'POST' && url.pathname === '/api/test/reset') {
      if (process.env.NODE_ENV !== 'test' || process.env.CONTEXT_DESK_TEST_MODE !== '1') throw new DeskError('NOT_FOUND', 'Not found.', 404);
      requireSameOrigin(req); requireAuth(req);
      return send(res, 200, { reset: store.resetSession(SESSION_ID) });
    }
    if (method === 'GET' && url.pathname === '/api/health') {
      const dbOk = store.db.prepare('SELECT 1 AS ok').get().ok === 1;
      return send(res, dbOk ? 200 : 503, { status: dbOk ? 'ok' : 'degraded', database: dbOk ? 'ready' : 'unavailable', sourcePack: SOURCE_PACK.version, modelProvider: 'none', twitch: twitch.status.state });
    }
    if (method === 'GET' && url.pathname === '/api/auth/status') {
      const session = readSession(req);
      return send(res, 200, { authenticated: Boolean(session), role: session?.role ?? null, authReady, demoMode, setupRequired: !authReady, trustMessage: 'Nothing appears on stream until you approve it.' });
    }
    if (method === 'POST' && url.pathname === '/api/auth/login') {
      requireSameOrigin(req);
      if (!authReady) throw new DeskError('AUTH_NOT_CONFIGURED', 'Set a local access passphrase in .env before using the review controls.', 503);
      const key = req.socket.remoteAddress || 'unknown';
      const tries = (loginAttempts.get(key) ?? []).filter((time) => Date.now() - time < 10 * 60_000);
      if (tries.length >= 8) throw new DeskError('LOGIN_RATE_LIMITED', 'Too many sign-in attempts. Wait ten minutes and try again.', 429);
      const input = await readJson(req);
      loginAttempts.set(key, [...tries, Date.now()]);
      if (!secureCompare(input.passcode || '', configuredPasscode)) throw new DeskError('LOGIN_FAILED', 'That passphrase was not accepted.', 401);
      loginAttempts.delete(key);
      return send(res, 200, { authenticated: true, role: passcodeRole, demoMode }, { 'Set-Cookie': sessionCookie(passcodeRole) });
    }
    if (method === 'POST' && url.pathname === '/api/auth/logout') {
      requireSameOrigin(req);
      return send(res, 200, { loggedOut: true }, { 'Set-Cookie': 'context_desk_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (method === 'POST' && url.pathname === '/api/twitch/connect/start') {
      requireSameOrigin(req);
      const auth = requireAuth(req);
      if (auth.role !== 'broadcaster' || demoMode) throw new DeskError('BROADCASTER_AUTH_REQUIRED', 'Only a configured, non-demo broadcaster session can authorize Twitch.', 403);
      const { state, url: authorizeUrl } = twitch.begin(SESSION_ID);
      const stateCookie = `context_desk_twitch_state=${state}; HttpOnly; SameSite=Lax; Path=/auth/twitch/callback; Max-Age=600${process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY_HTTPS === '1' ? '; Secure' : ''}`;
      return send(res, 200, { authorizeUrl }, { 'Set-Cookie': stateCookie });
    }
    if (method === 'POST' && url.pathname === '/api/twitch/disconnect') {
      requireSameOrigin(req);
      const auth = requireAuth(req);
      if (auth.role !== 'broadcaster' || demoMode) throw new DeskError('BROADCASTER_AUTH_REQUIRED', 'Only the configured broadcaster can disconnect Twitch.', 403);
      await twitch.disconnect();
      return send(res, 200, { connected: false });
    }
    if (method === 'GET' && url.pathname === '/auth/twitch/callback') {
      const state = url.searchParams.get('state') || '';
      const cookieState = cookieValue(req, 'context_desk_twitch_state') || '';
      const code = url.searchParams.get('code') || '';
      try {
        if (url.searchParams.has('error') || !secureCompare(state, cookieState)) throw new TwitchOAuthError('OAUTH_STATE_INVALID', 'Twitch authorization did not complete for this browser session.', 403);
        await twitch.complete({ state, sessionId: SESSION_ID, code });
        res.writeHead(302, { ...securityHeaders, Location: '/?twitch=connected', 'Set-Cookie': clearTwitchStateCookie(), 'Cache-Control': 'no-store' });
        return res.end();
      } catch (error) {
        if (error instanceof TwitchOAuthError) console.warn(`[context-desk] Twitch connect failed: ${error.code}`);
        else console.error('[context-desk] Twitch connect failed safely.');
        res.writeHead(302, { ...securityHeaders, Location: '/?twitch=failed', 'Set-Cookie': clearTwitchStateCookie(), 'Cache-Control': 'no-store' });
        return res.end();
      }
    }
    if (method === 'POST' && url.pathname === '/api/twitch/eventsub') {
      if (!twitch.ready) throw new DeskError('TWITCH_NOT_CONFIGURED', 'Twitch OAuth/EventSub is not configured.', 503);
      const rawBody = await readBody(req, 128 * 1024);
      const verified = verifyEventSubSignature({ headers: req.headers, rawBody, secret: twitch.config.eventSubSecret });
      if (!verified.valid) throw new DeskError('EVENTSUB_REJECTED', `EventSub request rejected (${verified.reason}).`, 403);
      if (!replayGuard.accept(verified.messageId)) throw new DeskError('EVENTSUB_REPLAY', 'Duplicate EventSub delivery was ignored.', 409);
      let payload;
      try { payload = JSON.parse(rawBody); } catch { throw new DeskError('INVALID_EVENTSUB_BODY', 'EventSub body is not valid JSON.', 400); }
      const messageType = req.headers['twitch-eventsub-message-type'];
      if (messageType === 'webhook_callback_verification') {
        if (typeof payload.challenge !== 'string') throw new DeskError('INVALID_CHALLENGE', 'Invalid verification challenge.', 400);
        twitch.markWebhookVerified(); lastTwitchEventAt = new Date().toISOString();
        return send(res, 200, payload.challenge, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      if (messageType === 'revocation') {
        twitch.markRevoked(); lastTwitchEventAt = new Date().toISOString();
        return send(res, 202, { accepted: false, reason: 'subscription-revoked' });
      }
      if (messageType !== 'notification') throw new DeskError('INVALID_EVENTSUB_TYPE', 'Unsupported EventSub message type.', 400);
      if (!twitch.canAcceptMessages) return send(res, 202, { accepted: false, reason: 'twitch-not-authorized' });
      const parsed = parseChatMessage(payload, { broadcasterId: twitch.broadcasterId });
      lastTwitchEventAt = new Date().toISOString();
      if (!parsed.accepted) return send(res, 202, { accepted: false, reason: parsed.reason });
      try {
        const result = desk.submit(parsed.text, { actorRole: parsed.role, principal: `twitch:${parsed.actorId}`, source: 'twitch-eventsub' });
        return send(res, 202, { accepted: true, duplicate: result.duplicate, questionId: result.question.id, state: result.question.state });
      } catch (error) {
        if (error instanceof DeskError) return send(res, 202, { accepted: false, reason: error.code });
        throw error;
      }
    }
    if (method === 'GET' && url.pathname === '/api/config') {
      const session = requireAuth(req);
      return send(res, 200, { session: SESSION_ID, role: session.role, demoMode, pack: { id: SOURCE_PACK.id, title: SOURCE_PACK.title, version: SOURCE_PACK.version, scope: SOURCE_PACK.scope, retentionHours: SOURCE_PACK.policy.retentionHours }, sources: sourcesPublic(), twitch: { ...twitch.status, oauthReady: twitch.ready, lastEventAt: lastTwitchEventAt, moderatorRoleVerification: twitch.canAcceptMessages ? 'badge-verified-per-message; submission only' : 'unavailable; fail closed' }, overlayPath: `/overlay?session=${encodeURIComponent(SESSION_ID)}`, viewerVotePath: `/vote?session=${encodeURIComponent(SESSION_ID)}` });
    }
    if (method === 'POST' && url.pathname === '/api/questions') {
      requireSameOrigin(req); const auth = requireAuth(req); const input = await readJson(req);
      const result = desk.submit(input.question, { actorRole: auth.role, source: 'studio', principal: 'local-broadcaster' });
      return send(res, 201, { ...result, question: { ...result.question, events: store.events(result.question.id) } });
    }
    if (method === 'POST' && url.pathname === '/api/demo/samples') {
      requireSameOrigin(req); const auth = requireAuth(req);
      const results = [];
      for (const sample of SOURCE_PACK.samples) results.push(desk.submit(sample.question, { actorRole: auth.role, source: 'demo-fixture', principal: `demo-fixture:${sample.id}` }));
      return send(res, 201, { questions: results.map((result) => result.question) });
    }
    if (method === 'GET' && url.pathname === '/api/review-queue') {
      const auth = requireAuth(req); return send(res, 200, { questions: desk.listQueue({ role: auth.role }) });
    }
    if (method === 'GET' && url.pathname === '/api/vote-results') {
      requireAuth(req); return send(res, 200, viewerPoll.results());
    }
    if (method === 'POST' && url.pathname === '/api/vote/promote') {
      requireSameOrigin(req); const auth = requireAuth(req); const leader = viewerPoll.leader();
      if (!leader) throw new DeskError('NO_VOTES_YET', 'There are no viewer votes to promote yet.', 409);
      const result = desk.submit(leader.question, { actorRole: auth.role, source: 'viewer-poll', principal: 'viewer-poll' });
      return send(res, 201, { ...result, promotedChoiceId: leader.id, promotedQuestion: leader.question });
    }
    if ((method === 'GET' || method === 'POST') && url.pathname.startsWith('/api/vote/')) {
      const match = url.pathname.match(/^\/api\/vote\/([a-f0-9]{24,64})$/i);
      if (!match || match[1] !== SESSION_ID) throw new DeskError('POLL_NOT_FOUND', 'Viewer poll not found.', 404);
      if (method === 'GET') {
        const voter = resolveVoterCookie(cookieValue(req, 'context_desk_voter'), { secret: COOKIE_SECRET, secure: process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY_HTTPS === '1' });
        return send(res, 200, viewerPoll.snapshot(voter.hash), voter.cookie ? { 'Set-Cookie': voter.cookie } : {});
      }
      requireSameOrigin(req); const voter = resolveVoterCookie(cookieValue(req, 'context_desk_voter'), { secret: COOKIE_SECRET, secure: process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY_HTTPS === '1' }); const input = await readJson(req);
      const result = viewerPoll.cast(voter.hash, input.choiceId);
      return send(res, 200, result, voter.cookie ? { 'Set-Cookie': voter.cookie } : {});
    }
    if (method === 'POST' && url.pathname.startsWith('/api/questions/')) {
      requireSameOrigin(req); const auth = requireAuth(req);
      const match = url.pathname.match(/^\/api\/questions\/([a-f0-9-]+)\/(approve|reject|insufficient-evidence|cancel)$/i);
      if (!match) throw new DeskError('NOT_FOUND', 'Action not found.', 404);
      const input = await readJson(req);
      const result = desk.decide(match[1], match[2], { ...input, role: auth.role, principal: 'local-broadcaster' });
      return send(res, 200, result);
    }
    if (method === 'GET' && url.pathname === '/api/recap') {
      requireAuth(req); return send(res, 200, { cards: desk.recap() });
    }
    if (method === 'GET' && url.pathname === '/api/recap/export') {
      requireAuth(req); const cards = desk.recap();
      const markdown = markdownExport(cards);
      res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="context-desk-recap.md"', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(markdown) });
      return res.end(markdown);
    }
    if (method === 'GET' && url.pathname.startsWith('/api/overlay/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const key = parts[2];
      if (key !== SESSION_ID) throw new DeskError('OVERLAY_NOT_FOUND', 'Overlay not found.', 404);
      const card = safeOverlayCard(desk.overlay());
      if (parts[3] === 'events') {
        res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
        res.write(`event: snapshot\ndata: ${JSON.stringify({ card })}\n\n`);
        let previous = JSON.stringify(card);
        const timer = setInterval(() => {
          const next = safeOverlayCard(desk.overlay()); const encoded = JSON.stringify(next);
          if (encoded !== previous) { previous = encoded; res.write(`event: snapshot\ndata: ${JSON.stringify({ card: next })}\n\n`); }
        }, 1200);
        const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
        req.on('close', () => { clearInterval(timer); clearInterval(keepAlive); });
        return;
      }
      return send(res, 200, { card });
    }
    if (method === 'GET' && url.pathname === '/') return staticFile(res, path.join(PUBLIC, 'index.html'));
    if (method === 'GET' && url.pathname === '/overlay') return staticFile(res, path.join(PUBLIC, 'overlay.html'));
    if (method === 'GET' && url.pathname === '/vote') return staticFile(res, path.join(PUBLIC, 'vote.html'));
    if (method === 'GET' && url.pathname.startsWith('/public/')) {
      const relative = path.normalize(url.pathname.slice('/public/'.length)).replace(/^\.\.(?:[\\/]|$)+/, '');
      const file = path.resolve(PUBLIC, relative);
      if (!file.startsWith(PUBLIC + path.sep)) throw new DeskError('NOT_FOUND', 'Not found.', 404);
      return staticFile(res, file);
    }
    if (method === 'GET' && url.pathname === '/favicon.svg') return staticFile(res, path.join(PUBLIC, 'favicon.svg'));
    send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
  } catch (error) { sendError(res, error); }
});

const pruneTimer = setInterval(() => { try { desk.prune(); } catch (error) { console.error('[context-desk] retention cleanup failed:', error.message); } }, 60_000);
pruneTimer.unref();
server.on('close', () => { clearInterval(pruneTimer); clearInterval(twitchRefreshTimer); store.close(); });
server.listen(PORT, HOST, () => console.log(`[context-desk] listening on http://${HOST}:${PORT}; pack=${SOURCE_PACK.version}; model=none; demo=${demoMode}; session=${SESSION_ID}`));
