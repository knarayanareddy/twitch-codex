import 'dotenv/config';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Store } from './adapters/store.js';
import { HabitatService, ServiceError } from './application/habitat-service.js';
import { TwitchAdapter, TwitchError } from './adapters/twitch.js';
import { makeOAuthState, parseEncryptionKey, safeEqual, SlidingWindowLimiter } from './adapters/security.js';
import { ACTIONS, SOURCES, ROUNDS, METRIC_LABELS, getAction } from './domain/scenario.js';
import { DomainError } from './domain/engine.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = resolve(ROOT, 'public');
const systemWallClock = () => Date.now();
const monotonicSystemClock = () => performance.now();
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'");
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
  }));
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  let originHost;
  try { originHost = new URL(origin).host; } catch { return false; }
  const forwarded = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim();
  const allowedHost = forwarded || req.headers.host;
  return originHost === allowedHost;
}

async function readJson(req, maxBytes = 32 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new ServiceError('BODY_TOO_LARGE', 'Request body is too large.', 413);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ServiceError('INVALID_JSON', 'Request body must be valid JSON.', 400); }
}

function sanitizeError(error) {
  if (error instanceof DomainError || error instanceof ServiceError || error instanceof TwitchError) {
    return { status: error.status ?? 400, code: error.code, message: error.message };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong. No session data was intentionally exposed.' };
}

export function createApp({
  dbPath = process.env.HABITAT_DB_PATH ?? resolve(ROOT, 'data/habitat-relay.sqlite'),
  env = process.env,
  store: providedStore,
  service: providedService,
  twitch: providedTwitch,
  now = systemWallClock,
  monotonicNow, 
  roundDurationMs,
  logger = console,
} = {}) {
  const store = providedStore ?? new Store(dbPath);
  const service = providedService ?? new HabitatService({ store, now, monotonicNow: monotonicNow ?? (now === systemWallClock ? monotonicSystemClock : now), roundDurationMs, voteSalt: env.HABITAT_ENCRYPTION_KEY ?? randomBytes(32).toString('hex'), onError: (e) => logger.error?.('[service]', e.message) });
  const encryptionKey = parseEncryptionKey(env.HABITAT_ENCRYPTION_KEY);
  const redirectUri = env.TWITCH_REDIRECT_URI ?? `http://localhost:${env.PORT ?? 3000}/auth/twitch/callback`;
  const twitch = providedTwitch ?? new TwitchAdapter({
    clientId: env.TWITCH_CLIENT_ID,
    clientSecret: env.TWITCH_CLIENT_SECRET,
    redirectUri,
    store,
    encryptionKey,
    onChat: (event) => service.handleChatEvent(event),
  });
  const protectLiveRound = (status) => {
    const phase = service.rawState.phase;
    if (service.rawState.mode === 'live' && ['voting', 'review'].includes(phase) && !status.ready) {
      try { service.execute('pause'); } catch (error) { logger.error?.('[live-pause]', error.message); }
    }
  };
  twitch.on('status', protectLiveRound);
  if (service.rawState.mode === 'live' && ['voting', 'review'].includes(service.rawState.phase) && !twitch.status().ready) setImmediate(() => protectLiveRound(twitch.status()));
  let overlaySessionId = service.rawState.id;
  let overlayToken = randomBytes(32).toString('base64url');
  const overlayClients = new Map();
  const validOverlayKey = (key) => overlaySessionId === service.rawState.id && safeEqual(key, overlayToken);
  const rotateOverlayKey = ({ data }) => {
    if (data.id === overlaySessionId) return;
    overlaySessionId = data.id;
    overlayToken = randomBytes(32).toString('base64url');
  };
  service.on('update', rotateOverlayKey);
  if (!providedTwitch && twitch.status().connected) setImmediate(() => twitch.connect());
  const studioLimiter = new SlidingWindowLimiter({ limit: 45, windowMs: 60_000, now });
  const voteLimiter = new SlidingWindowLimiter({ limit: 15, windowMs: 60_000, now });
  const clients = new Set();
  let closed = false;
  const timer = setInterval(() => service.expireRound(), 500);
  timer.unref?.();
  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    const requestUrl = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    try {
      if (req.method === 'GET' && requestUrl.pathname === '/' && requestUrl.searchParams.get('view') === 'overlay' && !validOverlayKey(requestUrl.searchParams.get('key'))) {
        const body = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Overlay link expired — Habitat Relay</title><body style="font:16px system-ui;background:#f5f3ec;color:#17251f;padding:3rem"><h1>Overlay link unavailable</h1><p>This session link is invalid or has been revoked. Copy the current OBS link from the Habitat Relay studio.</p></body></html>';
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(body);
      }
      if (req.method === 'GET' && requestUrl.pathname === '/api/operator/overlay-link') {
        const forwardedHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim();
        const host = forwardedHost || req.headers.host || 'localhost';
        const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
        const protocol = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
        const link = new URL('/', `${protocol}://${host}`);
        link.searchParams.set('view', 'overlay');
        link.searchParams.set('key', overlayToken);
        return json(res, 200, { url: link.toString(), sessionId: overlaySessionId, revokedOnReset: true });
      }
      if (req.method === 'GET' && requestUrl.pathname === '/api/health') {
        return json(res, 200, { ok: true, app: 'Habitat Relay', version: '1.0.0', database: 'ready', twitch: twitch.status().ready ? 'ready' : twitch.status().connected ? 'connecting' : 'disconnected', at: now() });
      }
      if (req.method === 'GET' && requestUrl.pathname === '/api/state') {
        if (requestUrl.searchParams.has('overlayKey') && !validOverlayKey(requestUrl.searchParams.get('overlayKey'))) return json(res, 403, { error: 'OVERLAY_LINK_REVOKED', message: 'This OBS link is invalid or has been revoked.' });
        return json(res, 200, service.getState());
      }
      if (req.method === 'GET' && requestUrl.pathname === '/api/content') {
        if (requestUrl.searchParams.has('overlayKey') && !validOverlayKey(requestUrl.searchParams.get('overlayKey'))) return json(res, 403, { error: 'OVERLAY_LINK_REVOKED', message: 'This OBS link is invalid or has been revoked.' });
        return json(res, 200, { rounds: ROUNDS, sources: Object.values(SOURCES), actions: ACTIONS, metrics: METRIC_LABELS, disclaimer: 'Authored simulation only. Metrics are game state, not ecological measurements.' });
      }
      if (req.method === 'GET' && requestUrl.pathname === '/api/events') return json(res, 200, service.getEvents());
      if (req.method === 'GET' && requestUrl.pathname === '/api/operator/status') return json(res, 200, service.getOperatorState());
      if (req.method === 'GET' && requestUrl.pathname === '/api/recap') {
        const markdown = requestUrl.searchParams.get('format') === 'markdown';
        const body = markdown ? service.exportRecapMarkdown() : JSON.stringify(service.exportRecap(), null, 2);
        const mime = markdown ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8';
        const filename = markdown ? 'habitat-relay-recap.md' : 'habitat-relay-recap.json';
        res.writeHead(200, { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
        return res.end(body);
      }
      if (req.method === 'GET' && requestUrl.pathname === '/api/twitch/status') return json(res, 200, twitch.status());
      if (req.method === 'GET' && requestUrl.pathname.startsWith('/action/')) {
        const actionId = requestUrl.pathname.slice('/action/'.length);
        const action = getAction(actionId);
        if (!action) return json(res, 404, { error: 'ACTION_NOT_FOUND', message: 'That optional action is not available.' });
        service.recordActionViewed(actionId);
        res.writeHead(302, { Location: action.url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        return res.end();
      }
      if (req.method === 'GET' && requestUrl.pathname === '/api/stream') {
        const isOverlay = requestUrl.searchParams.has('overlayKey');
        if (isOverlay && !validOverlayKey(requestUrl.searchParams.get('overlayKey'))) return json(res, 403, { error: 'OVERLAY_LINK_REVOKED', message: 'This OBS link is invalid or has been revoked.' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`event: state\ndata: ${JSON.stringify(service.getState())}\n\n`);
        if (!isOverlay) res.write(`event: twitch\ndata: ${JSON.stringify(twitch.status())}\n\n`);
        const boundSessionId = isOverlay ? overlaySessionId : null;
        const onUpdate = ({ data }) => {
          if (boundSessionId && data.id !== boundSessionId) {
            if (!res.writableEnded) { res.write('event: overlay-revoked\ndata: {}\n\n'); res.end(); }
            return;
          }
          if (!res.writableEnded) res.write(`event: state\ndata: ${JSON.stringify(data)}\n\n`);
        };
        const onStatus = (status) => { if (!isOverlay && !res.writableEnded) res.write(`event: twitch\ndata: ${JSON.stringify(status)}\n\n`); };
        const onActivity = (activity) => { if (!isOverlay && !res.writableEnded) res.write(`event: activity\ndata: ${JSON.stringify(activity)}\n\n`); };
        const heartbeat = setInterval(() => {
          const snapshot = service.getState();
          res.write(`event: clock\ndata: ${JSON.stringify({ phase: snapshot.phase, remainingMs: snapshot.remainingMs, sessionElapsedMs: snapshot.sessionElapsedMs })}\n\n`);
        }, 1_000);
        clients.add(res);
        overlayClients.set(res, boundSessionId);
        service.on('update', onUpdate);
        if (!isOverlay) service.on('activity', onActivity);
        if (!isOverlay) twitch.on('status', onStatus);
        req.on('close', () => {
          clearInterval(heartbeat);
          clients.delete(res);
          overlayClients.delete(res);
          service.off('update', onUpdate);
          if (!isOverlay) service.off('activity', onActivity);
          if (!isOverlay) twitch.off('status', onStatus);
        });
        return;
      }
      if (req.method === 'GET' && requestUrl.pathname === '/auth/twitch') {
        if (!twitch.isConfigured()) return json(res, 503, { error: 'Twitch integration needs app credentials and HABITAT_ENCRYPTION_KEY. See README.' });
        const state = makeOAuthState();
        const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
        res.setHeader('Set-Cookie', `habitat_oauth_state=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=/auth/twitch/callback; Max-Age=600${secure ? '; Secure' : ''}`);
        res.writeHead(302, { Location: twitch.authorizeUrl(state), 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (req.method === 'GET' && requestUrl.pathname === '/auth/twitch/callback') {
        const cookies = parseCookies(req.headers.cookie);
        const expectedState = cookies.habitat_oauth_state;
        res.setHeader('Set-Cookie', 'habitat_oauth_state=; HttpOnly; SameSite=Lax; Path=/auth/twitch/callback; Max-Age=0');
        const stateMatches = safeEqual(expectedState, requestUrl.searchParams.get('state'));
        if (requestUrl.searchParams.has('error')) {
          res.writeHead(303, { Location: '/?twitch_error=OAUTH_DENIED', 'Cache-Control': 'no-store' });
          return res.end();
        }
        try {
          await twitch.finishAuthorization({ code: requestUrl.searchParams.get('code'), stateMatches });
          res.writeHead(303, { Location: '/?connected=1', 'Cache-Control': 'no-store' });
          return res.end();
        } catch (error) {
          const safeCodes = new Set(['INVALID_STATE','INVALID_CODE','TOKEN_EXCHANGE_FAILED','TOKEN_INVALID','MISSING_SCOPE','USER_LOOKUP_FAILED','REFRESH_FAILED','SUBSCRIPTION_FAILED','NOT_CONFIGURED']);
          const code = safeCodes.has(error.code) ? error.code : 'CONNECT_FAILED';
          res.writeHead(303, { Location: `/?twitch_error=${encodeURIComponent(code)}`, 'Cache-Control': 'no-store' });
          return res.end();
        }
      }
      if (req.method === 'POST' && requestUrl.pathname.startsWith('/api/')) {
        if (!originAllowed(req)) return json(res, 403, { error: 'ORIGIN_REJECTED', message: 'This request must come from the Habitat Relay app.' });
        const remote = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'local').split(',')[0].trim();
        if (!studioLimiter.allow(remote)) return json(res, 429, { error: 'RATE_LIMITED', message: 'Please wait before trying another control.' });
        if (requestUrl.pathname === '/api/command') {
          const body = await readJson(req);
          const command = String(body.command ?? '');
          const payload = body.payload ?? {};
          if (command === 'resume' && service.rawState.mode === 'live' && !twitch.status().ready) {
            throw new ServiceError('TWITCH_NOT_READY', 'Reconnect Twitch and wait for chat to be ready before resuming a live round.', 409);
          }
          if (command === 'start' && payload.mode === 'live') {
            const status = twitch.status();
            if (!status.ready || !status.profile?.id || payload.confirmChannelId !== status.profile.id) {
              throw new ServiceError('LIVE_CONFIRMATION_REQUIRED', 'Confirm the connected broadcaster channel and wait for Twitch chat to be ready before starting live mode.', 409);
            }
          }
          const result = service.execute(command, command === 'start' && payload.mode === 'live' ? { mode: 'live' } : payload);
          return json(res, 200, { ok: true, result, state: service.getState() });
        }
        if (requestUrl.pathname === '/api/vote') {
          const body = await readJson(req);
          const state = service.rawState;
          if (state.mode !== 'demo') return json(res, 403, { error: 'LIVE_VOTES_FROM_TWITCH_ONLY', message: 'In live mode, votes must arrive through Twitch chat.' });
          const actor = String(body.actor ?? 'demo-viewer').slice(0, 80);
          if (!voteLimiter.allow(`${remote}:${actor}`)) return json(res, 429, { error: 'VOTE_RATE_LIMITED', message: 'Wait before adding another demo vote.' });
          const result = service.submitVote({ optionId: body.optionId, actorId: `demo:${actor}`, deliveryId: `manual:${randomBytes(12).toString('hex')}`, source: 'demo' });
          return json(res, result.committed ? 200 : 409, { ok: result.committed, result, state: service.getState() });
        }
        if (requestUrl.pathname === '/api/twitch/disconnect') {
          twitch.disconnect();
          return json(res, 200, { ok: true, status: twitch.status() });
        }
        return json(res, 404, { error: 'NOT_FOUND', message: 'No such API route.' });
      }
      if (req.method === 'GET') {
        const relative = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
        const target = resolve(PUBLIC, relative);
        if (!target.startsWith(PUBLIC + sep) && target !== resolve(PUBLIC, 'index.html')) return json(res, 403, { error: 'FORBIDDEN', message: 'Path is not available.' });
        let data;
        try { data = await readFile(target); }
        catch { return json(res, 404, { error: 'NOT_FOUND', message: 'Page not found.' }); }
        res.writeHead(200, { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream', 'Cache-Control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=300' });
        return res.end(data);
      }
      return json(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
    } catch (error) {
      const safe = sanitizeError(error);
      if (safe.status >= 500) logger.error?.('[http]', error?.stack ?? error);
      return json(res, safe.status, { error: safe.code, message: safe.message });
    }
  });

  server.on('close', () => {
    closed = true;
    clearInterval(timer);
    for (const res of clients) res.end();
    clients.clear();
    twitch.off('status', protectLiveRound);
    service.off('update', rotateOverlayKey);
    twitch.shutdown();
    if (!providedStore) store.close();
  });

  return { server, store, service, twitch, close: () => new Promise((resolveClose) => {
    if (closed) return resolveClose();
    server.close(() => resolveClose());
    for (const res of clients) res.end();
  }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  app.server.listen(port, host, () => {
    console.log(`Habitat Relay running at http://localhost:${port}`);
    if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET || !process.env.HABITAT_ENCRYPTION_KEY) {
      console.log('Demo mode is ready. To enable Twitch, configure the Twitch application and secrets described in README.md.');
    }
  });
  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
