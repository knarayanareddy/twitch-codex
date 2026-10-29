import { randomBytes, randomUUID } from 'node:crypto';
import { LESSON, choiceById, choiceByNumber } from '../domain/lesson.js';
import { LabRuleError, createLabState, reduceLab, snapshot } from '../domain/lab-engine.js';
import { hashActor } from '../adapters/security.js';

export const RETENTION_MS = 24 * 60 * 60 * 1000;
const CONTROL_TYPES = new Set(['START_PREDICTIONS','CLOSE_PREDICTIONS','SELECT_PARAMETER','RUN_EXPERIMENT','REVEAL_RESULT','PAUSE','RESUME','REPLAY','RESET','END_SESSION']);
export class LabError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'LabError'; this.code = code; this.status = status; }
}
export class LabService {
  constructor({ store, secret, lesson = LESSON, clock = () => Date.now(), onChange = () => {}, idFactory = randomUUID, seedFactory = () => randomBytes(12).toString('hex') }) {
    this.store = store; this.secret = secret; this.lesson = lesson; this.clock = clock; this.onChange = onChange; this.idFactory = idFactory; this.seedFactory = seedFactory;
  }
  now() { return Math.floor(this.clock()); }
  get(id) {
    const record = this.store.getSession(id); if (!record) return null;
    this.tick(id); return this.store.getSession(id);
  }
  current() {
    const record = this.store.latest(this.now()); if (!record) return null;
    this.tick(record.id); return this.store.getSession(record.id);
  }
  startDemo() {
    const now = this.now(); const id = this.idFactory(); const seed = this.seedFactory();
    const state = createLabState({ id, mode: 'demo', seed, now, lesson: this.lesson });
    const session = this.store.createSession({ state, identitySalt: randomBytes(32).toString('hex'), expiresAt: now + RETENTION_MS });
    this.notify(id); return session;
  }
  control(sessionId, type, details = {}) {
    if (!CONTROL_TYPES.has(type)) throw new LabError('INVALID_CONTROL', 'Unknown lab control.');
    const record = this.store.getSession(sessionId); if (!record || record.expiresAt <= this.now()) throw new LabError('SESSION_NOT_FOUND', 'Lab session not found or expired.', 404);
    try {
      const result = this.store.applyEvent(sessionId, { type, now: this.now(), ...details }, (state, event) => reduceLab(state, event, { lesson: this.lesson }));
      if (!result.session) throw new LabError('SESSION_NOT_FOUND', 'Lab session not found or expired.', 404);
      if (result.changed) this.notify(sessionId);
      return result.session;
    } catch (error) { if (error instanceof LabRuleError) throw new LabError(error.code, error.message, 409); throw error; }
  }
  tick(sessionId) {
    const record = this.store.getSession(sessionId); if (!record || record.state.phase !== 'predict' || this.now() < record.state.deadlineAt) return record;
    const result = this.store.applyEvent(sessionId, { type: 'TICK', now: this.now() }, (state, event) => reduceLab(state, event, { lesson: this.lesson }));
    if (result.changed) this.notify(sessionId); return result.session;
  }
  tickAll() { for (const record of this.store.allUnexpired(this.now())) this.tick(record.id); }
  pruneExpired() { return this.store.prune(this.now()); }
  submitPrediction({ sessionId, choiceId, source, actorId, deliveryId = null }) {
    if (!['demo','twitch'].includes(source)) throw new LabError('INVALID_SOURCE', 'Prediction source is not allowed.');
    if (!choiceById(choiceId, this.lesson)) throw new LabError('INVALID_CHOICE', 'Choose one of the three numbered predictions.');
    if (typeof actorId !== 'string' || actorId.length < 1 || actorId.length > 256) throw new LabError('INVALID_ACTOR', 'Prediction identity is invalid.');
    if (deliveryId != null && (typeof deliveryId !== 'string' || deliveryId.length > 128)) throw new LabError('INVALID_DELIVERY_ID', 'Provider delivery ID is invalid.');
    const record = this.store.getSession(sessionId); if (!record || record.expiresAt <= this.now()) return { accepted: false, reason: 'session-expired', session: null };
    if (record.state.mode === 'demo' && source !== 'demo') return { accepted: false, reason: 'live-input-disabled', session: record };
    if (record.state.mode === 'live' && source !== 'twitch') return { accepted: false, reason: 'demo-input-disabled', session: record };
    const actorKey = hashActor(actorId, record.identitySalt);
    try {
      const result = this.store.acceptPrediction({ sessionId, cycle: record.state.cycle, source, actorKey, choiceId, deliveryId, now: this.now() }, (state, event) => reduceLab(state, event, { lesson: this.lesson }));
      if (result.accepted) this.notify(sessionId);
      return result;
    } catch (error) { if (error instanceof LabRuleError) return { accepted: false, reason: error.code.toLowerCase().replaceAll('_','-'), session: this.store.getSession(sessionId) }; throw error; }
  }
  simulatePrediction({ sessionId, voterId, choiceNumber }) {
    if (!/^sample-[1-5]$/.test(voterId || '')) throw new LabError('INVALID_FIXTURE', 'Choose one of the five labelled demo voters.');
    const choice = choiceByNumber(choiceNumber, this.lesson); if (!choice) throw new LabError('INVALID_CHOICE', 'Choose prediction 1, 2, or 3.');
    return this.submitPrediction({ sessionId, choiceId: choice.id, source: 'demo', actorId: `fixture:${voterId}` });
  }
  getSnapshot(id, { operator = false } = {}) { const record = this.get(id); return record ? snapshot(record.state, { lesson: this.lesson, now: this.now(), operator }) : null; }
  publicSnapshot(id) { return this.getSnapshot(id, { operator: false }); }
  operatorSnapshot(id) { return this.getSnapshot(id, { operator: true }); }
  recap() {
    const sessions = this.store.allUnexpired(this.now()); const reports = [];
    for (const record of sessions) for (const run of record.state.runs) {
      const selected = choiceById(run.selectedChoiceId, this.lesson); const predicted = choiceById(run.leadingChoiceId, this.lesson);
      reports.push({ schemaVersion: 1, sessionId: record.id, lessonId: run.lessonId, lessonVersion: run.lessonVersion, question: this.lesson.prompt, simulation: { id: this.lesson.simulation.id, formula: this.lesson.simulation.formula, unit: this.lesson.simulation.unit }, cycle: run.cycle, seed: run.seed, predictionTotal: run.predictionTotal, predictionCounts: { ...run.predictions }, leadingPrediction: predicted ? { id: predicted.id, label: predicted.label } : null, predictionOutcome: run.predictionResult, testedParameter: selected ? { id: selected.id, label: selected.label, albedoPercent: selected.albedoPercent } : null, result: run.result, assumptions: [...this.lesson.assumptions], source: { ...this.lesson.source }, revealedAt: run.revealedAt });
    }
    return reports.sort((a, b) => a.revealedAt - b.revealedAt);
  }
  notify(id) { try { this.onChange(id); } catch {} }
}
export { choiceById };
