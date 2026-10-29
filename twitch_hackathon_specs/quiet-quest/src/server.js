import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { SqliteStore } from './adapters/storage/sqlite-store.js';
import { loadSigningSecret, readCookie, requireSameOrigin, createOperatorCookie, verifyOperatorCookie, createParticipantCookie, verifyParticipantCookie, hashActor, hashInvite, hashNetworkAddress } from './adapters/security.js';
import { loadEncryptionKey, decryptJson } from './adapters/secret-vault.js';
import { QuestService, QuestError } from './application/quest-service.js';
import { TwitchManager } from './application/twitch-manager.js';
import { ACTIONS } from './domain/game.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)); const PUBLIC = path.resolve(HERE, '../public');
const PORT = Number(process.env.PORT || 4180); const HOST = process.env.HOST || '0.0.0.0';
const COOKIE_SECRET = loadSigningSecret({ envValue: process.env.QUIET_QUEST_COOKIE_SECRET, filename: path.resolve(process.cwd(), 'data/.quiet-quest-cookie-key') });
const TOKEN_KEY = loadEncryptionKey({ envValue: process.env.TWITCH_TOKEN_ENCRYPTION_KEY, filename: path.resolve(process.cwd(), 'data/.quiet-quest-twitch-key') });
const PASSCODE = process.env.QUIET_QUEST_OPERATOR_PASSCODE || (process.env.DEMO_MODE === '1' ? process.env.DEMO_PASSCODE : '') || '';
const demoLogin = process.env.DEMO_MODE === '1' && PASSCODE.length >= 12;
const productionAuthReady = PASSCODE.length >= 24 && Boolean(process.env.QUIET_QUEST_COOKIE_SECRET);
const authReady = demoLogin || productionAuthReady;
const isSecure = process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY_HTTPS === '1';
const store = new SqliteStore(process.env.DATABASE_PATH || './data/quiet-quest.sqlite');
const streamClients = new Map(); const oauthStates = new Map(); const requestLimits = new Map();
const twitchConfig = { clientId: process.env.TWITCH_CLIENT_ID || '', clientSecret: process.env.TWITCH_CLIENT_SECRET || '', redirectUri: process.env.TWITCH_REDIRECT_URI || '' };
const service = new QuestService({ store, secret: COOKIE_SECRET, onChange: (id) => broadcast(id) });
const twitch = new TwitchManager({ store, service, clientId: twitchConfig.clientId, clientSecret: twitchConfig.clientSecret, redirectUri: twitchConfig.redirectUri, encryptionKey: TOKEN_KEY });
twitch.restore(); const twitchRefreshTimer = twitch.startRefreshLoop();
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
const headers = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
};

function secureEqual(left, right) { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && timingSafeEqual(a, b); }
function admin(req) { return verifyOperatorCookie(readCookie(req, 'qq_operator'), COOKIE_SECRET); }
function requireAdmin(req) { if (!admin(req)) throw new QuestError('AUTH_REQUIRED', 'Sign in to the Quiet Quest studio.', 401); }
function send(res, status, value, extra = {}) {
  const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  res.writeHead(status, { ...headers, 'Content-Type': typeof value === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...extra }); res.end(body);
}
function fail(res, error) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(`[quiet-quest] ${error.name || 'Error'}: ${error.message}`);
  send(res, status, { error: { code: error.code || 'INTERNAL_ERROR', message: status >= 500 ? 'Quiet Quest could not complete that action. No participant data was exposed.' : error.message } });
}
function cookieValue(name, value, maxAge, pathName = '/', sameSite = 'Strict') { return `${name}=${value}; HttpOnly; SameSite=${sameSite}; Path=${pathName}; Max-Age=${maxAge}${isSecure ? '; Secure' : ''}`; }
function clearCookie(name, pathName = '/') { return `${name}=; HttpOnly; SameSite=Strict; Path=${pathName}; Max-Age=0${isSecure ? '; Secure' : ''}`; }
async function bodyText(req, max = 8 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new QuestError('BODY_TOO_LARGE', 'Request body exceeds the allowed size.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
async function jsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new QuestError('CONTENT_TYPE_REQUIRED', 'Send a JSON request.', 415);
  try { return JSON.parse(await bodyText(req)); } catch (error) { if (error instanceof QuestError) throw error; throw new QuestError('INVALID_JSON', 'Request body is not valid JSON.', 400); }
}
function rateLimit(req, key, max = 35) {
  const now = Date.now(); const hashed = hashNetworkAddress(`${key}:${req.socket.remoteAddress || 'unknown'}`, COOKIE_SECRET);
  const recent = (requestLimits.get(hashed) || []).filter((stamp) => now - stamp < 60_000);
  if (recent.length >= max) throw new QuestError('RATE_LIMITED', 'Please wait a moment before trying again.', 429);
  recent.push(now); requestLimits.set(hashed, recent);
  if (requestLimits.size > 5000) for (const [id, values] of requestLimits) if (!values.some((stamp) => now - stamp < 60_000)) requestLimits.delete(id);
}
function publicSnapshot(recordOrId) { const id = typeof recordOrId === 'string' ? recordOrId : recordOrId?.id; return id ? service.snapshot(id) : null; }
function currentSessions() { return store.listUnexpired(Date.now()).map((record) => ({ snapshot: publicSnapshot(record), createdAt: record.createdAt, expiresAt: record.expiresAt })); }
function broadcast(sessionId) {
  const clients = streamClients.get(sessionId); if (!clients?.size) return;
  const data = JSON.stringify({ snapshot: service.snapshot(sessionId) });
  for (const res of clients) { try { res.write(`event: snapshot\ndata: ${data}\n\n`); } catch { clients.delete(res); } }
}
function openStream(req, res, sessionId, { publicAccess = false } = {}) {
  if (!publicAccess) requireAdmin(req);
  const record = service.get(sessionId); if (!record) throw new QuestError('SESSION_NOT_FOUND', 'Session not found or expired.', 404);
  res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  res.write(`event: snapshot\ndata: ${JSON.stringify({ snapshot: service.snapshot(sessionId) })}\n\n`);
  if (!streamClients.has(sessionId)) streamClients.set(sessionId, new Set()); streamClients.get(sessionId).add(res);
  const keepAlive = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch {} }, 20_000); keepAlive.unref?.();
  req.on('close', () => { clearInterval(keepAlive); streamClients.get(sessionId)?.delete(res); });
}
function makeOauthCookie(state, verifier, now) {
  const expires = now + 10 * 60 * 1000; const payload = `${state}.${verifier}.${expires}`;
  const sig = createHmac('sha256', COOKIE_SECRET).update(`oauth:${payload}`).digest('hex');
  const value = `${Buffer.from(payload).toString('base64url')}.${sig}`;
  return cookieValue('qq_oauth_state', value, 600, '/auth/twitch/callback', 'Lax');
}
function pruneOauthStates(now = Date.now()) { for (const [state, expiresAt] of oauthStates) if (expiresAt <= now) oauthStates.delete(state); }
function consumeOauthCookie(req, state) {
  pruneOauthStates();
  const raw = readCookie(req, 'qq_oauth_state'); if (!raw) return null;
  const [encoded, sig, ...extra] = raw.split('.'); if (!encoded || !sig || extra.length) return null;
  let payload; try { payload = Buffer.from(encoded, 'base64url').toString(); } catch { return null; }
  const expected = createHmac('sha256', COOKIE_SECRET).update(`oauth:${payload}`).digest('hex'); if (!secureEqual(expected, sig)) return null;
  const [savedState, verifier, expiryText, ...rest] = payload.split('.'); const expiry = Number(expiryText);
  if (rest.length || savedState !== state || !/^[a-f0-9]{64}$/i.test(verifier || '') || !Number.isSafeInteger(expiry) || expiry <= Date.now()) return null;
  if (oauthStates.has(savedState)) return null;
  oauthStates.set(savedState, expiry); return { verifier, clear: clearCookie('qq_oauth_state', '/auth/twitch/callback') };
}
async function twitchUser(accessToken) {
  const response = await fetch('https://api.twitch.tv/helix/users', { headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': twitchConfig.clientId } });
  if (!response.ok) throw new Error('Twitch account verification failed.'); const data = await response.json();
  const user = data.data?.[0]; if (!user?.id || !user.login) throw new Error('Twitch did not return an account identity.'); return user;
}
function roundAggregate(rows, round) {
  const actions = Object.fromEntries(ACTIONS.map(({ id }) => [id, 0])); let twitch = 0; let companion = 0;
  for (const row of rows.filter((item) => item.round === round)) { actions[row.actionId] = row.count; if (row.source === 'twitch') twitch += row.count; if (row.source === 'companion') companion += row.count; }
  return { actions, total: twitch + companion, twitch, companion };
}
function recapCsv() {
  const sessions = service.history(); const lines = ['session,mode,round,phase,total,goal,chat,companion,flowers,shade,water,outcome'];
  for (const record of sessions) {
    const snapshot = record.snapshot; const agg = roundAggregate(record.aggregate, snapshot.round);
    lines.push([snapshot.sessionId, snapshot.mode, snapshot.round, snapshot.phase, agg.total, snapshot.goal, agg.twitch, agg.companion, agg.actions.flowers, agg.actions.shade, agg.actions.water, snapshot.outcome?.text || ''].map((value) => `"${String(value ?? '').replaceAll('"','""')}"`).join(','));
  }
  return lines.join('\r\n');
}

store.prune(Date.now());
twitch.restore();
for (const saved of store.listUnexpired(Date.now())) {
  if (saved.mode === 'live' && ['active', 'paused'].includes(saved.state.phase)) {
    if (twitch.isAuthorized()) void twitch.startForSession(saved.id).catch(() => service.control(saved.id, 'SET_CONNECTION', { connectionState: 'reauthorization-required' }));
    else try { service.control(saved.id, 'SET_CONNECTION', { connectionState: 'reauthorization-required' }); } catch {}
    break;
  }
}

const server = http.createServer(async (req, res) => {
  let url; try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); } catch { return send(res, 400, { error: { code: 'BAD_URL', message: 'Invalid URL.' } }); }
  const method = req.method || 'GET';
  try {
    if (method === 'POST' && url.pathname === '/api/test/reset') {
      if (process.env.NODE_ENV !== 'test' || process.env.QUIET_QUEST_TEST_MODE !== '1') throw new QuestError('NOT_FOUND', 'Not found.', 404);
      requireSameOrigin(req, { trustProxy: process.env.TRUST_PROXY_HTTPS === '1' }); requireAdmin(req); twitch.stopSocket(); twitch.activeSessionId = null; const removed = store.resetTestData(); requestLimits.clear(); oauthStates.clear(); return send(res, 200, { reset: removed });
    }
    if (method === 'GET' && url.pathname === '/api/health') return send(res, 200, { status: 'ok', database: 'ready', game: 'quiet-quest-v1', modelProvider: 'none' });
    if (method === 'GET' && url.pathname === '/api/auth/status') return send(res, 200, { authenticated: admin(req), authReady, demoMode: demoLogin, twitch: twitch.publicStatus(), activeSessions: admin(req) ? currentSessions() : undefined });
    if (method === 'POST' && url.pathname === '/api/auth/login') {
      requireSameOrigin(req, { trustProxy: process.env.TRUST_PROXY_HTTPS === '1' }); rateLimit(req, 'login', 8); const input = await jsonBody(req);
      if (!authReady) throw new QuestError('AUTH_NOT_CONFIGURED', 'Set a local operator passphrase before opening the studio.', 503);
      if (typeof input.passcode !== 'string' || !secureEqual(input.passcode, PASSCODE)) throw new QuestError('AUTH_INVALID', 'That passphrase did not match.', 401);
      return send(res, 200, { authenticated: true, demoMode: demoLogin }, { 'Set-Cookie': createOperatorCookie(COOKIE_SECRET, Date.now(), isSecure) });
    }
    if (method === 'POST' && url.pathname === '/api/auth/logout') { requireSameOrigin(req, { trustProxy: process.env.TRUST_PROXY_HTTPS === '1' }); return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie('qq_operator') }); }
    if (method === 'GET' && url.pathname === '/auth/twitch/start') {
      pruneOauthStates(); requireAdmin(req); if (!twitch.oauthReady() || !twitchConfig.redirectUri) throw new QuestError('TWITCH_OAUTH_NOT_CONFIGURED', 'Set Twitch client credentials and redirect URL in .env first.', 503);
      const redirect = new URL(twitchConfig.redirectUri); if (!['https:', 'http:'].includes(redirect.protocol) || (isSecure && redirect.protocol !== 'https:')) throw new QuestError('TWITCH_REDIRECT_INVALID', 'Production Twitch redirects must use HTTPS.', 503);
      const state = randomBytes(24).toString('hex'); const verifier = randomBytes(32).toString('hex'); const challenge = createHash('sha256').update(verifier).digest('base64url');
      const target = new URL('https://id.twitch.tv/oauth2/authorize'); target.searchParams.set('client_id', twitchConfig.clientId); target.searchParams.set('redirect_uri', twitchConfig.redirectUri); target.searchParams.set('response_type', 'code'); target.searchParams.set('scope', 'user:read:chat'); target.searchParams.set('state', state); target.searchParams.set('code_challenge', challenge); target.searchParams.set('code_challenge_method', 'S256'); target.searchParams.set('force_verify', 'true');
      res.writeHead(302, { ...headers, Location: target.href, 'Set-Cookie': makeOauthCookie(state, verifier, Date.now()), 'Cache-Control': 'no-store' }); return res.end();
    }
    if (method === 'GET' && url.pathname === '/auth/twitch/callback') {
      try {
        requireAdmin(req); const state = url.searchParams.get('state'); const consumed = state && consumeOauthCookie(req, state);
        if (!consumed || url.searchParams.has('error')) throw new QuestError('TWITCH_OAUTH_STATE_INVALID', 'Twitch authorization was cancelled or could not be verified.', 400);
        const code = url.searchParams.get('code'); if (!code) throw new QuestError('TWITCH_CODE_MISSING', 'Twitch did not return an authorization code.', 400);
        const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: twitchConfig.clientId, client_secret: twitchConfig.clientSecret, code, grant_type: 'authorization_code', redirect_uri: twitchConfig.redirectUri, code_verifier: consumed.verifier }) });
        if (!response.ok) throw new QuestError('TWITCH_TOKEN_EXCHANGE_FAILED', 'Twitch authorization could not be completed.', 502);
        const tokens = await response.json(); const user = await twitchUser(tokens.access_token); twitch.saveOAuth({ user, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in, scopes: tokens.scope || [] });
        res.writeHead(302, { ...headers, Location: '/', 'Set-Cookie': [consumed.clear], 'Cache-Control': 'no-store' }); return res.end();
      } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error(`[quiet-quest] OAuth callback failed: ${error.message}`);
        return send(res, status, { error: { code: error.code || 'TWITCH_OAUTH_FAILED', message: status >= 500 ? 'Twitch authorization could not be completed.' : error.message } }, { 'Set-Cookie': clearCookie('qq_oauth_state', '/auth/twitch/callback') });
      }
    }
    if (method === 'GET' && url.pathname === '/api/studio') {
      requireAdmin(req); return send(res, 200, { demoMode: demoLogin, authReady, twitch: twitch.publicStatus(), sessions: currentSessions(), actions: ACTIONS, privacy: 'Twitch names and raw chat messages are not stored. Companion browser tokens are temporary and not linked to Twitch identities.' });
    }
    if (method === 'POST' && url.pathname === '/api/sessions') {
      requireSameOrigin(req, { trustProxy: process.env.TRUST_PROXY_HTTPS === '1' }); requireAdmin(req); const input = await jsonBody(req); const mode = input.mode;
      if (store.listUnexpired(Date.now()).some((session) => !['closed'].includes(session.state.phase))) throw new QuestError('SESSION_ALREADY_ACTIVE', 'End or reset the current session before starting another.', 409);
      if (mode === 'live' && !twitch.isAuthorized()) throw new QuestError('TWITCH_AUTH_REQUIRED', 'Authorize Twitch chat before starting a Live session.', 409);
      const created = service.start(mode); if (mode === 'live') void twitch.startForSession(created.session.id).catch(() => {});
      return send(res, 201, { snapshot: publicSnapshot(created.session), companionCode: created.code, companionUrl: `/companion#${created.code}`, overlayUrl: `/overlay?session=${created.session.id}` });
    }
    if (method === 'POST' && url.pathname.startsWith('/api/sessions/')) {
      requireSameOrigin(req, { trustProxy: process.env.TRUST_PROXY_HTTPS === '1' }); requireAdmin(req); const match = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]+)\/(pause|resume|close-round|end|next|reset|invite|companion|demo-chat)$/i);
      if (!match) throw new QuestError('NOT_FOUND', 'Session action not found.', 404);
      const [, id, action] = match; const input = await jsonBody(req); const record = store.getSession(id);
      if (!record || record.expiresAt <= Date.now()) throw new QuestError('SESSION_NOT_FOUND', 'Session not found or expired.', 404);
      if (action === 'pause') return send(res, 200, { snapshot: publicSnapshot(service.control(id, 'PAUSE')) });
      if (action === 'resume') return send(res, 200, { snapshot: publicSnapshot(service.control(id, 'RESUME')) });
      if (action === 'close-round') return send(res, 200, { snapshot: publicSnapshot(service.control(id, 'CLOSE_ROUND')) });
      if (action === 'end') { const snapshot = publicSnapshot(service.control(id, 'END_SESSION')); twitch.stopSession(id); return send(res, 200, { snapshot }); }
      if (action === 'next') return send(res, 200, { snapshot: publicSnapshot(service.nextRound(id)) });
      if (action === 'companion') return send(res, 200, { snapshot: publicSnapshot(service.setCompanion(id, input.enabled)) });
      if (action === 'invite') { const code = service.invite(id); return send(res, 200, { companionCode: code, companionUrl: `/companion#${code}` }); }
      if (action === 'demo-chat') {
        if (record.mode !== 'demo') throw new QuestError('DEMO_ONLY', 'Simulated chat commands are available in Demo mode only.', 409);
        const result = service.simulateChat({ sessionId: id, actorId: input.actorId, actionId: input.actionId }); return send(res, result.accepted ? 200 : 409, { ...result, snapshot: publicSnapshot(id) });
      }
      if (action === 'reset') {
        if (record.state.phase !== 'closed') service.control(id, 'END_SESSION'); twitch.stopSession(id); const created = service.start(record.mode); if (record.mode === 'live') void twitch.startForSession(created.session.id).catch(() => {});
        return send(res, 200, { snapshot: publicSnapshot(created.session), companionCode: created.code, companionUrl: `/companion#${created.code}`, overlayUrl: `/overlay?session=${created.session.id}` });
      }
    }
    if (method === 'GET' && url.pathname === '/api/recap') { requireAdmin(req); return send(res, 200, { sessions: service.history(), eventsIncluded: false }); }
    if (method === 'GET' && url.pathname === '/api/recap/export') {
      requireAdmin(req); const csv = recapCsv(); res.writeHead(200, { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="quiet-quest-recap.csv"', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(csv) }); return res.end(csv);
    }
    if (method === 'GET' && url.pathname.startsWith('/api/studio/')) {
      const match = url.pathname.match(/^\/api\/studio\/([a-f0-9-]+)\/events$/i); if (!match) throw new QuestError('NOT_FOUND', 'Not found.', 404); return openStream(req, res, match[1]);
    }
    if (method === 'GET' && url.pathname.startsWith('/api/overlay/')) {
      const match = url.pathname.match(/^\/api\/overlay\/([a-f0-9-]+)(?:\/events)?$/i); if (!match) throw new QuestError('NOT_FOUND', 'Overlay not found.', 404);
      if (url.pathname.endsWith('/events')) return openStream(req, res, match[1], { publicAccess: true });
      const snapshot = service.snapshot(match[1]); if (!snapshot) throw new QuestError('SESSION_NOT_FOUND', 'Overlay session not found.', 404); return send(res, 200, { snapshot });
    }
    if (method === 'POST' && url.pathname === '/api/companion/join') {
      requireSameOrigin(req, { trustProxy: process.env.TRUST_PROXY_HTTPS === '1' }); rateLimit(req, 'companion-join', 35); const input = await jsonBody(req); const record = service.resolveInvite(input.code);
      if (!record) throw new QuestError('INVITE_INVALID', 'That session code is invalid, expired, or disabled. Ask the streamer for the current companion link.', 404);
      const participant = createParticipantCookie(record.id, COOKIE_SECRET, Date.now(), isSecure);
      return send(res, 200, { snapshot: publicSnapshot(record), privacy: 'This temporary browser token is not linked to a Twitch identity.' }, { 'Set-Cookie': participant.cookie });
    }
    if (method === 'GET' && url.pathname === '/api/companion/snapshot') {
      const participant = verifyParticipantCookie(readCookie(req, 'qq_participant'), COOKIE_SECRET); if (!participant) throw new QuestError('COMPANION_SESSION_REQUIRED', 'Enter the current session code to join.', 401);
      const record = service.participantSession(participant.sessionId); if (!record) throw new QuestError('COMPANION_SESSION_CLOSED', 'This companion link is closed or has been disabled.', 410);
      return send(res, 200, { snapshot: publicSnapshot(record), alreadyContributed: service.participantAlreadyContributed(record.id, participant.nonce) });
    }
    if (method === 'POST' && url.pathname === '/api/companion/contribute') {
      requireSameOrigin(req, { trustProxy: process.env.TRUST_PROXY_HTTPS === '1' }); rateLimit(req, 'companion-submit', 35); const participant = verifyParticipantCookie(readCookie(req, 'qq_participant'), COOKIE_SECRET); if (!participant) throw new QuestError('COMPANION_SESSION_REQUIRED', 'Enter the current session code to join.', 401);
      const input = await jsonBody(req); const record = service.participantSession(participant.sessionId); if (!record) throw new QuestError('COMPANION_SESSION_CLOSED', 'This companion link is closed or has been disabled.', 410);
      const result = service.contribute({ sessionId: participant.sessionId, round: input.round, source: 'companion', identity: participant.nonce, actionId: input.actionId });
      return send(res, result.accepted ? 200 : 409, { accepted: result.accepted, reason: result.reason, snapshot: publicSnapshot(result.session || participant.sessionId), alreadyContributed: result.accepted || result.reason === 'already-contributed' });
    }
    if (method === 'GET' && url.pathname === '/api/companion/events') {
      const participant = verifyParticipantCookie(readCookie(req, 'qq_participant'), COOKIE_SECRET); if (!participant) throw new QuestError('COMPANION_SESSION_REQUIRED', 'Join the active session to see its progress.', 401);
      if (!service.participantSession(participant.sessionId)) throw new QuestError('COMPANION_SESSION_CLOSED', 'This companion link is closed or has been disabled.', 410);
      return openStream(req, res, participant.sessionId, { publicAccess: true });
    }
    if (method === 'POST' && url.pathname === '/api/twitch/disconnect') { requireSameOrigin(req, { trustProxy: process.env.TRUST_PROXY_HTTPS === '1' }); requireAdmin(req); await twitch.disconnect(); return send(res, 200, { twitch: twitch.publicStatus() }); }
    if (method === 'GET' && url.pathname === '/') return staticFile(res, 'index.html');
    if (method === 'GET' && url.pathname === '/companion') return staticFile(res, 'companion.html');
    if (method === 'GET' && url.pathname === '/overlay') return staticFile(res, 'overlay.html');
    if (method === 'GET' && url.pathname === '/privacy') return staticFile(res, 'privacy.html');
    if (method === 'GET' && url.pathname.startsWith('/public/')) {
      const relative = path.normalize(url.pathname.slice('/public/'.length)).replace(/^\.\.(?:[\\/]|$)+/, ''); const file = path.resolve(PUBLIC, relative);
      if (!file.startsWith(PUBLIC + path.sep)) throw new QuestError('NOT_FOUND', 'Not found.', 404); return staticFile(res, file);
    }
    send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
  } catch (error) { fail(res, error); }
});
function staticFile(res, relative) {
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found');
  try { const data = fs.readFileSync(file); res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-cache' }); res.end(data); }
  catch { send(res, 404, 'Not found'); }
}

const tickTimer = setInterval(() => { service.tickAll(); for (const id of streamClients.keys()) broadcast(id); }, 1_000); tickTimer.unref?.();
const pruneTimer = setInterval(() => { store.prune(Date.now()); }, 60_000); pruneTimer.unref?.();
const rateCleanTimer = setInterval(() => { const now = Date.now(); for (const [key, times] of requestLimits) { const fresh = times.filter((time) => now - time < 60_000); if (fresh.length) requestLimits.set(key, fresh); else requestLimits.delete(key); } }, 60_000); rateCleanTimer.unref?.();
server.on('close', () => { clearInterval(tickTimer); clearInterval(pruneTimer); clearInterval(rateCleanTimer); clearInterval(twitchRefreshTimer); twitch.stopSocket(); store.close(); for (const clients of streamClients.values()) for (const client of clients) client.end(); });
server.listen(PORT, HOST, () => console.log(`[quiet-quest] listening on http://${HOST}:${PORT}; authReady=${authReady}; twitchOAuth=${twitch.oauthReady()}`));
