import { randomBytes, randomUUID } from 'node:crypto';
import { ACTION_BY_ID, ACTIONS, GameRuleError, createGameState, makeSnapshot, reduceGame } from '../domain/game.js';
import { hashActor, hashInvite } from '../adapters/security.js';

const RETENTION_MS = 24 * 60 * 60 * 1000;
export class QuestError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'QuestError'; this.code = code; this.status = status; }
}
export class QuestService {
  constructor({ store, secret, clock = () => Date.now(), onChange = () => {} }) { this.store = store; this.secret = secret; this.clock = clock; this.onChange = onChange; }
  now() { return Math.floor(this.clock()); }
  get(id) {
    this.tickSession(id);
    return this.store.getSession(id);
  }
  snapshot(id) {
    const record = this.get(id); if (!record) return null;
    return makeSnapshot(record.state, this.now());
  }
  start(mode) {
    if (!['demo', 'live'].includes(mode)) throw new QuestError('INVALID_MODE', 'Choose Demo or Live.');
    const now = this.now(); const id = randomUUID(); const code = randomBytes(20).toString('base64url');
    const record = this.store.createSession({
      id, mode, state: createGameState({ sessionId: id, mode, now, connectionState: mode === 'demo' ? 'simulated' : 'reconnecting' }),
      codeHash: hashInvite(code, this.secret), twitchSalt: randomBytes(32).toString('hex'), createdAt: now, expiresAt: now + RETENTION_MS,
    });
    const started = this.store.applyEvent(id, { type: 'START', now }, reduceGame).session;
    this.notify(id);
    return { session: started, code };
  }
  invite(id) {
    const record = this.get(id); if (!record || record.state.phase === 'closed') throw new QuestError('SESSION_NOT_ACTIVE', 'Start an active session before creating a companion link.', 409);
    const code = randomBytes(20).toString('base64url'); this.store.updateInvite(id, hashInvite(code, this.secret)); this.notify(id); return code;
  }
  resolveInvite(code) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{24,64}$/.test(code)) return null;
    const record = this.store.findByCodeHash(hashInvite(code, this.secret), this.now());
    return record && record.state.phase !== 'closed' && record.state.companionEnabled ? record : null;
  }
  participantSession(cookieSessionId) {
    const record = this.get(cookieSessionId);
    if (!record || record.state.phase === 'closed' || !record.state.companionEnabled) return null;
    return record;
  }
  participantAlreadyContributed(sessionId, nonce) {
    const record = this.store.getSession(sessionId); if (!record) return false;
    return this.store.hasContribution(sessionId, record.state.round, 'companion', hashActor(nonce, record.twitchSalt));
  }
  contribute({ sessionId, round, source, identity, actionId, deliveryId = null }) {
    if (!['twitch', 'companion'].includes(source)) throw new QuestError('INVALID_SOURCE', 'Contribution source is not permitted.');
    if (!ACTION_BY_ID.has(actionId)) throw new QuestError('INVALID_ACTION', 'Choose one of the three listed actions.');
    if (typeof identity !== 'string' || identity.length < 1 || identity.length > 256) throw new QuestError('INVALID_IDENTITY', 'Contribution identity is invalid.');
    if (deliveryId != null && (typeof deliveryId !== 'string' || deliveryId.length > 128)) throw new QuestError('INVALID_DELIVERY_ID', 'Message delivery identifier is invalid.');
    const record = this.store.getSession(sessionId); if (!record || record.expiresAt <= this.now()) return { accepted: false, reason: 'session-expired', session: null };
    if (source === 'companion' && !record.state.companionEnabled) return { accepted: false, reason: 'companion-disabled', session: record };
    if (source === 'twitch' && record.state.mode !== 'live' && !identity.startsWith('simulator:')) return { accepted: false, reason: 'live-chat-disabled', session: record };
    const actorKey = hashActor(identity, record.twitchSalt);
    try {
      const result = this.store.acceptContribution({ sessionId, round, source, actorKey, actionId, deliveryId, now: this.now() }, reduceGame);
      if (result.accepted) this.notify(sessionId);
      return result;
    } catch (error) {
      if (error instanceof GameRuleError) return { accepted: false, reason: error.code.toLowerCase().replaceAll('_', '-'), detail: error.message, session: this.store.getSession(sessionId) };
      throw error;
    }
  }
  simulateChat({ sessionId, actorId, actionId }) {
    if (typeof actorId !== 'string' || !/^sample-[1-3]$/.test(actorId)) throw new QuestError('INVALID_FIXTURE', 'Choose one of the labelled demo participants.');
    return this.contribute({ sessionId, round: this.store.getSession(sessionId)?.state.round, source: 'twitch', identity: `simulator:${actorId}`, actionId, deliveryId: `demo-${randomUUID()}` });
  }
  control(sessionId, type, details = {}) {
    const types = new Set(['START', 'PAUSE', 'RESUME', 'CLOSE_ROUND', 'END_SESSION', 'SET_COMPANION', 'SET_CONNECTION', 'TICK']);
    if (!types.has(type)) throw new QuestError('INVALID_CONTROL', 'Unknown session control.');
    const event = { type, now: this.now(), ...details };
    try {
      const result = this.store.applyEvent(sessionId, event, reduceGame);
      if (!result.session) throw new QuestError('SESSION_NOT_FOUND', 'Session not found or expired.', 404);
      if (result.changed) this.notify(sessionId);
      return result.session;
    } catch (error) {
      if (error instanceof GameRuleError) throw new QuestError(error.code, error.message, 409);
      throw error;
    }
  }
  nextRound(sessionId) { return this.control(sessionId, 'START'); }
  setCompanion(sessionId, enabled) { return this.control(sessionId, 'SET_COMPANION', { enabled }); }
  tickSession(sessionId) {
    const record = this.store.getSession(sessionId); if (!record || record.state.phase !== 'active' || this.now() < record.state.deadlineAt) return record;
    const result = this.store.applyEvent(sessionId, { type: 'TICK', now: this.now() }, reduceGame);
    if (result.changed) this.notify(sessionId); return result.session;
  }
  tickAll() { for (const record of this.store.listUnexpired(this.now())) this.tickSession(record.id); }
  closeExpired() { return this.store.prune(this.now()); }
  aggregate(sessionId) { return this.store.aggregate(sessionId); }
  history() {
    const rows = [];
    for (const record of this.store.listUnexpired(this.now())) {
        const aggregate = this.aggregate(record.id);
      for (let round = 1; round <= record.state.round; round++) {
        const counts = Object.fromEntries(ACTIONS.map(({ id }) => [id, 0])); let twitchCount = 0; let companionCount = 0;
        for (const row of aggregate.filter((item) => item.round === round)) { counts[row.actionId] = row.count; if (row.source === 'twitch') twitchCount += row.count; if (row.source === 'companion') companionCount += row.count; }
        const total = twitchCount + companionCount; const phase = round < record.state.round ? 'revealed' : record.state.phase;
        const outcome = ['revealed', 'closed'].includes(phase) ? { completed: total >= 12, reason: phase === 'closed' ? 'session-ended' : 'round-complete', text: total >= 12 ? 'The shared goal was reached.' : `The garden grew through ${total} contributions.`, contributions: total, goal: 12 } : null;
        const roundState = { ...record.state, round, phase, total, counts, sourceCounts: { twitch: twitchCount, companion: companionCount }, outcome, deadlineAt: round === record.state.round ? record.state.deadlineAt : null, pausedRemainingMs: round === record.state.round ? record.state.pausedRemainingMs : null };
        rows.push({ snapshot: makeSnapshot(roundState, this.now()), aggregate: aggregate.filter((event) => event.round === round) });
      }
    }
    return rows;
  }
  notify(sessionId) { try { this.onChange(sessionId); } catch { /* state persistence does not depend on subscribers */ } }
}

export { ACTIONS, RETENTION_MS };
