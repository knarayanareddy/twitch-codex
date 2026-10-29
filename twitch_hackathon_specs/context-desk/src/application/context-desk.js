import { randomUUID, createHmac } from 'node:crypto';
import { SOURCE_PACK, getSource } from '../domain/source-pack.js';
import { classifyQuestion, normalizeQuestion, sanitizeQuestion, validatePublicText } from '../domain/question.js';
import { retrieveEvidence } from './retrieval.js';

const RETENTION_MS = SOURCE_PACK.policy.retentionHours * 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const REASONS = new Set(['not-relevant', 'poor-evidence', 'unsafe', 'out-of-scope', 'other']);

export class DeskError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'DeskError'; this.code = code; this.status = status; }
}

export function makeActor(role, principal, secret) {
  const hash = createHmac('sha256', secret).update(`${role}:${principal}`).digest('hex').slice(0, 32);
  return { role, hash, eventId: randomUUID() };
}

function actorCanReview(role) { return ['broadcaster', 'demo-broadcaster', 'verified-moderator'].includes(role); }
function actorCanPublish(role) { return ['broadcaster', 'demo-broadcaster'].includes(role); }

export class ContextDesk {
  constructor({ store, sessionId, actorSecret, clock = () => new Date(), limits = {}, retrieve = retrieveEvidence }) {
    this.store = store;
    this.sessionId = sessionId;
    this.actorSecret = actorSecret;
    this.clock = clock;
    this.retrieve = retrieve;
    this.globalLimit = limits.global ?? 30;
    this.actorLimit = limits.actor ?? 8;
    this.rateEntries = new Map();
  }
  actor(role, principal) { return makeActor(role, principal, this.actorSecret); }
  getCurrentTime() { return this.clock().toISOString(); }

  submit(rawQuestion, { actorRole = 'broadcaster', principal = 'studio', source = 'studio', sessionId = this.sessionId } = {}) {
    if (sessionId !== this.sessionId) throw new DeskError('SESSION_MISMATCH', 'This question belongs to a different session.', 403);
    if (!['broadcaster', 'demo-broadcaster', 'verified-moderator'].includes(actorRole)) throw new DeskError('SUBMISSION_FORBIDDEN', 'This role cannot submit questions.', 403);
    const text = sanitizeQuestion(rawQuestion);
    this.enforceRate(principal);
    const timestamp = this.clock();
    const createdAt = timestamp.toISOString();
    const duplicate = this.store.listQuestions(this.sessionId, createdAt).find((item) =>
      normalizeQuestion(item.text) === normalizeQuestion(text) && timestamp.getTime() - Date.parse(item.createdAt) < DUPLICATE_WINDOW_MS && item.state !== 'cancelled');
    if (duplicate) return { question: duplicate, duplicate: true, message: null };

    const id = randomUUID();
    const actor = this.actor(actorRole, principal);
    const classification = classifyQuestion(text);
    const initial = {
      id, sessionId: this.sessionId, text, source, state: 'queued', reasonCode: 'question-submitted',
      evidence: [], draft: null, createdAt, updatedAt: createdAt, expiresAt: new Date(timestamp.getTime() + RETENTION_MS).toISOString(),
      packVersion: SOURCE_PACK.version, duplicateOf: null,
    };
    this.store.createQuestion(initial, actor);

    if (classification.state === 'out-of-scope') {
      const question = this.store.transition(id, 'queued', 'out-of-scope', classification.reasonCode, this.actor(actorRole, principal), 'policy-blocked', this.getCurrentTime());
      return { question, duplicate: false, message: classification.message };
    }

    this.store.transition(id, 'queued', 'retrieving', 'retrieval-started', this.actor(actorRole, principal), 'retrieval-started', this.getCurrentTime());
    let found;
    try { found = this.retrieve(text); }
    catch {
      const question = this.store.transition(id, 'retrieving', 'failed', 'retrieval-failed', this.actor(actorRole, principal), 'retrieval-failed', this.getCurrentTime(), { evidence: [], draft: null });
      return { question, duplicate: false, message: 'Draft unavailable. No card was published. Retry or use a prepared sample.' };
    }
    const evidence = found.evidence;
    const draft = found.draft;
    let state = 'review-required';
    let reasonCode = 'retrieval-supported';
    let message = null;
    if (classification.state === 'insufficient-evidence' || !evidence.length || !draft) {
      state = 'insufficient-evidence'; reasonCode = classification.reasonCode ?? (!evidence.length ? 'no-matching-evidence' : 'no-safe-template');
      message = classification.message ?? 'Not enough evidence in this source pack. No card can be drafted.';
    }
    const question = this.store.transition(id, 'retrieving', state, reasonCode, this.actor(actorRole, principal), state === 'review-required' ? 'retrieval-completed' : 'insufficient-evidence', this.getCurrentTime(), { evidence, draft: state === 'review-required' ? draft : null });
    return { question, duplicate: false, message };
  }

  enforceRate(principal) {
    const now = this.clock().getTime();
    for (const [key, times] of this.rateEntries) {
      const recent = times.filter((time) => now - time < 60_000);
      if (recent.length) this.rateEntries.set(key, recent); else this.rateEntries.delete(key);
    }
    const all = this.rateEntries.get('*') ?? [];
    const mine = this.rateEntries.get(principal) ?? [];
    if (all.length >= this.globalLimit || mine.length >= this.actorLimit) throw new DeskError('RATE_LIMITED', 'The question queue is busy. Please wait before adding another question.', 429);
    this.rateEntries.set('*', [...all, now]);
    this.rateEntries.set(principal, [...mine, now]);
  }

  listQueue({ role, sessionId = this.sessionId }) {
    if (!actorCanReview(role)) throw new DeskError('REVIEW_FORBIDDEN', 'Review access is restricted to the broadcaster.', 403);
    if (sessionId !== this.sessionId) throw new DeskError('SESSION_MISMATCH', 'Session not found.', 404);
    return this.store.listQuestions(sessionId, this.getCurrentTime()).map((question) => ({
      ...question, events: this.store.events(question.id),
    }));
  }

  findReviewable(id, role) {
    if (!actorCanReview(role)) throw new DeskError('REVIEW_FORBIDDEN', 'Review access is restricted to the broadcaster.', 403);
    const question = this.store.getQuestion(id);
    if (!question || question.sessionId !== this.sessionId || Date.parse(question.expiresAt) <= this.clock().getTime()) throw new DeskError('QUESTION_NOT_FOUND', 'Question not found or expired.', 404);
    if (question.state !== 'review-required') throw new DeskError('INVALID_STATE', `This question is ${question.state}; only review-required questions can be changed here.`, 409);
    return question;
  }

  decide(id, action, { role, principal = 'studio', reasonCode, publicQuestion, title, summary, uncertainty, bullets, evidenceIds, confirmed } = {}) {
    const question = this.findReviewable(id, role);
    const actor = this.actor(role, principal);
    const at = this.getCurrentTime();
    if (action === 'reject' || action === 'insufficient-evidence') {
      if (!REASONS.has(reasonCode)) throw new DeskError('REASON_REQUIRED', 'Choose a review reason.', 422);
      const target = action === 'reject' ? 'rejected' : 'insufficient-evidence';
      const updated = this.store.transition(id, 'review-required', target, reasonCode, actor, action, at);
      return { question: updated, published: false };
    }
    if (action === 'cancel') {
      if (!actorCanPublish(role)) throw new DeskError('CANCEL_FORBIDDEN', 'Only the broadcaster can cancel a review item.', 403);
      if (!REASONS.has(reasonCode)) throw new DeskError('REASON_REQUIRED', 'Choose a cancellation reason.', 422);
      const updated = this.store.transition(id, 'review-required', 'cancelled', reasonCode, actor, 'cancelled', at);
      return { question: updated, published: false };
    }
    if (action !== 'approve') throw new DeskError('INVALID_ACTION', 'Choose approve, reject, insufficient evidence, or cancel.');
    if (!actorCanPublish(role)) throw new DeskError('PUBLISH_FORBIDDEN', 'Only the authenticated broadcaster can approve a public card.', 403);
    if (confirmed !== true) throw new DeskError('CONFIRMATION_REQUIRED', 'Review the preview and confirm approval before publishing.', 422);
    if (!Array.isArray(evidenceIds) || !evidenceIds.length || evidenceIds.length > 2) throw new DeskError('CITATION_REQUIRED', 'Select one or two evidence sources for the public card.', 422);
    const allowed = new Map(question.evidence.map((item) => [item.id, item]));
    const selectedEvidence = [...new Set(evidenceIds)].map((sourceId) => {
      const evidence = allowed.get(sourceId);
      const source = getSource(sourceId);
      if (!evidence || !source || evidence.url !== source.url || evidence.contentHash !== source.contentHash) throw new DeskError('INVALID_CITATION', 'A citation is not part of this question’s retrieved evidence.', 422);
      return { id: source.id, sourceTitle: source.sourceTitle, publisher: source.publisher, url: source.url, checkedAt: source.checkedAt, sourcePackVersion: source.sourcePackVersion };
    });
    const publicPrompt = validatePublicText(publicQuestion, 'Public question', { min: 12, max: 160 });
    const publicTitle = validatePublicText(title, 'Card title', { min: 8, max: 90 });
    const publicSummary = validatePublicText(summary, 'Context summary', { min: 30, max: 420 });
    const caveat = validatePublicText(uncertainty, 'Uncertainty note', { min: 10, max: 240 });
    if (!Array.isArray(bullets) || bullets.length < 1 || bullets.length > 3) throw new DeskError('BULLETS_REQUIRED', 'Include one to three concise context bullets.', 422);
    const publicBullets = bullets.map((bullet, index) => validatePublicText(bullet, `Context bullet ${index + 1}`, { min: 8, max: 140 }));
    const isHumanEdited = publicPrompt !== question.draft?.publicQuestion || publicTitle !== question.draft?.title || publicSummary !== question.draft?.summary || caveat !== question.draft?.uncertainty || JSON.stringify(publicBullets) !== JSON.stringify(question.draft?.bullets);
    const provenance = isHumanEdited ? 'human-edited' : 'system-draft-human-approved';
    const provenanceLabel = isHumanEdited ? 'Edited by human · approved by broadcaster' : 'Drafted by system · approved by broadcaster';
    const card = {
      id: randomUUID(), sessionId: this.sessionId, questionId: id, publicQuestion: publicPrompt, title: publicTitle, summary: publicSummary, uncertainty: caveat, bullets: publicBullets,
      evidence: selectedEvidence, expiresAt: new Date(this.clock().getTime() + RETENTION_MS).toISOString(),
      reviewerRole: role, reviewLabel: role === 'verified-moderator' ? 'Human reviewed' : 'Broadcaster reviewed', provenance, provenanceLabel,
    };
    const updated = this.store.publish({ card, actor, questionId: id, at });
    return { question: updated, card: this.store.currentCard(this.sessionId, at), published: true };
  }

  overlay() { return this.store.currentCard(this.sessionId, this.getCurrentTime()); }
  recap() { return this.store.cards(this.sessionId, this.getCurrentTime()); }
  prune() { return this.store.prune(this.getCurrentTime()); }
}

export { RETENTION_MS };
