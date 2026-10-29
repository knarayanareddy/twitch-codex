import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/adapters/storage/sqlite-store.js';
import { ContextDesk, DeskError } from '../src/application/context-desk.js';
import { SAMPLES } from '../src/domain/source-pack.js';

function makeDesk({ start = '2026-10-28T12:00:00.000Z', limits } = {}) {
  let timestamp = new Date(start);
  const store = new SqliteStore(':memory:');
  const desk = new ContextDesk({ store, sessionId: 'a'.repeat(40), actorSecret: 'test-hmac-key-that-is-long-enough', clock: () => new Date(timestamp), limits });
  return { desk, store, advance: (ms) => { timestamp = new Date(timestamp.getTime() + ms); } };
}
const question = 'Why is Pluto called a dwarf planet?';
function submitReviewable(desk, raw = question) { return desk.submit(raw, { actorRole: 'broadcaster', principal: 'local-test' }).question; }
function draftedCardFields(item) { return { publicQuestion: item.draft.publicQuestion, bullets: item.draft.bullets }; }

 test('evidence-backed question enters review-required with immutable manifest refs', () => {
  const { desk, store } = makeDesk(); const result = desk.submit(question, { actorRole: 'broadcaster', principal: 'test' });
  assert.equal(result.question.state, 'review-required');
  assert.equal(result.question.evidence.length, 2);
  assert.equal(result.question.draft.modelProvider, undefined);
  assert.equal(result.question.packVersion, '1.0.0');
  assert.equal(store.events(result.question.id)[0].action, 'submitted');
  assert.match(result.question.evidence[0].contentHash, /^[a-f0-9]{64}$/);
});

test('out-of-scope and insufficient evidence are successful non-publishing outcomes', () => {
  const { desk } = makeDesk();
  const unsafe = desk.submit('Can you diagnose these symptoms and recommend a treatment?', { actorRole: 'broadcaster', principal: 'a' }).question;
  const unknown = desk.submit('What is the current count of Saturn moons right now?', { actorRole: 'broadcaster', principal: 'b' }).question;
  assert.equal(unsafe.state, 'out-of-scope');
  assert.equal(unsafe.evidence.length, 0);
  assert.equal(unknown.state, 'insufficient-evidence');
  assert.equal(unknown.reasonCode, 'volatile-current-count');
  assert.equal(unknown.evidence[0].id, 'nasa-moons-facts');
  assert.equal(desk.overlay(), null);
});

test('same question is coalesced within two minutes, other questions remain distinct', () => {
  const { desk } = makeDesk();
  const first = desk.submit(question, { actorRole: 'broadcaster', principal: 'one' });
  const second = desk.submit(' WHY IS PLUTO CALLED A DWARF PLANET? ', { actorRole: 'broadcaster', principal: 'two' });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.question.id, second.question.id);
  const third = desk.submit('What is a light-year, and how is it different from an AU?', { actorRole: 'broadcaster', principal: 'three' });
  assert.notEqual(third.question.id, first.question.id);
});

test('question intake enforces session ownership, trusted roles and per-actor/global rate limits', () => {
  const { desk } = makeDesk({ limits: { global: 2, actor: 1 } });
  assert.throws(() => desk.submit(question, { sessionId: 'other' }), (error) => error instanceof DeskError && error.status === 403);
  assert.throws(() => desk.submit(question, { actorRole: 'viewer' }), (error) => error.code === 'SUBMISSION_FORBIDDEN');
  desk.submit(question, { actorRole: 'broadcaster', principal: 'a' });
  assert.throws(() => desk.submit('What is a light-year, and how is it different from an AU?', { actorRole: 'broadcaster', principal: 'a' }), (error) => error.code === 'RATE_LIMITED');
  const next = desk.submit('What is a light-year, and how is it different from an AU?', { actorRole: 'broadcaster', principal: 'b' });
  assert.equal(next.question.state, 'review-required');
  assert.throws(() => desk.submit('What do comets contain and how do tails form?', { actorRole: 'broadcaster', principal: 'c' }), (error) => error.status === 429);
});

test('a verified moderator can review but cannot publish; broadcaster can reject or mark insufficient', () => {
  const { desk } = makeDesk(); const item = submitReviewable(desk);
  assert.throws(() => desk.listQueue({ role: 'viewer' }), (error) => error.code === 'REVIEW_FORBIDDEN');
  assert.throws(() => desk.decide(item.id, 'approve', { role: 'verified-moderator', title: 'A planet definition', summary: 'This is a sufficiently long context summary about the formal definition.', uncertainty: 'It does not settle every terminology debate.', evidenceIds: [item.evidence[0].id], confirmed: true }), (error) => error.code === 'PUBLISH_FORBIDDEN');
  const denied = desk.decide(item.id, 'insufficient-evidence', { role: 'verified-moderator', principal: 'mod-a', reasonCode: 'poor-evidence' });
  assert.equal(denied.question.state, 'insufficient-evidence');
  assert.equal(denied.published, false);
  assert.equal(desk.overlay(), null);
  assert.equal(desk.recap().length, 0);
});

test('approval requires explicit confirmation, bounded prose and retrieved pack citations', () => {
  const { desk } = makeDesk(); const item = submitReviewable(desk);
  const payload = { ...draftedCardFields(item), role: 'broadcaster', principal: 'owner', title: 'A formal definition of a planet', summary: 'Under the International Astronomical Union definition, Pluto does not meet the third criterion because it has not cleared its orbital neighbourhood.', uncertainty: 'The wording is a classification, not a universal agreement.', evidenceIds: [item.evidence[0].id], confirmed: true };
  assert.throws(() => desk.decide(item.id, 'approve', { ...payload, confirmed: false }), (error) => error.code === 'CONFIRMATION_REQUIRED');
  assert.throws(() => desk.decide(item.id, 'approve', { ...payload, evidenceIds: ['forged-source'] }), (error) => error.code === 'INVALID_CITATION');
  assert.throws(() => desk.decide(item.id, 'approve', { ...payload, summary: '<script>cite nothing</script>' }), (error) => error.code === 'PUBLIC_TEXT_UNSAFE');
  assert.equal(desk.store.getQuestion(item.id).state, 'review-required');
});

test('approval publishes one allowlisted card; overlay receives only public-approved fields', () => {
  const { desk, store } = makeDesk(); const item = submitReviewable(desk);
  const result = desk.decide(item.id, 'approve', { ...draftedCardFields(item), role: 'broadcaster', principal: 'owner', title: 'Pluto under the IAU definition', summary: 'Under the IAU definition, a planet orbits the Sun, is nearly round, and has cleared its orbital neighbourhood. Pluto does not meet that third criterion.', uncertainty: 'This classification wording does not settle every discussion about planet definitions.', evidenceIds: item.evidence.map((e) => e.id), confirmed: true });
  assert.equal(result.published, true);
  assert.equal(result.question.state, 'published');
  assert.equal(result.card.reviewLabel, 'Broadcaster reviewed');
  assert.equal(desk.overlay().title, result.card.title);
  assert.equal(Object.hasOwn(desk.overlay(), 'question'), false);
  assert.equal(Object.hasOwn(desk.overlay(), 'viewer'), false);
  assert.ok(desk.overlay().evidence.every((item) => /^https:\/\/(science\.nasa\.gov|ssd\.jpl\.nasa\.gov)\//.test(item.url)));
  assert.equal(desk.recap().length, 1);
  assert.equal(store.events(item.id).at(-1).action, 'published');
  assert.equal(desk.decide, desk.decide); // service has a single command path; state guard below enforces one publish
  assert.throws(() => desk.decide(item.id, 'approve', { role: 'broadcaster', confirmed: true }), (error) => error.code === 'INVALID_STATE');
});

test('reject path is auditable and does not leak decision notes to the overlay', () => {
  const { desk, store } = makeDesk(); const item = submitReviewable(desk);
  assert.throws(() => desk.decide(item.id, 'reject', { role: 'broadcaster', reasonCode: 'made-up-reason' }), (error) => error.code === 'REASON_REQUIRED');
  const result = desk.decide(item.id, 'reject', { role: 'broadcaster', principal: 'owner', reasonCode: 'unsafe' });
  assert.equal(result.question.state, 'rejected');
  assert.equal(store.events(item.id).at(-1).reasonCode, 'unsafe');
  assert.equal(desk.overlay(), null);
});

test('raw question and cards expire at the policy window; recap and overlay clear', () => {
  const { desk, store, advance } = makeDesk(); const item = submitReviewable(desk);
  desk.decide(item.id, 'approve', { ...draftedCardFields(item), role: 'broadcaster', title: 'Pluto under the IAU definition', summary: 'Under the IAU definition, Pluto does not meet the third criterion for a planet because it has not cleared its orbital neighbourhood.', uncertainty: 'This classification wording does not settle every debate about the definition.', evidenceIds: [item.evidence[0].id], confirmed: true });
  assert.ok(desk.overlay());
  advance(24 * 60 * 60 * 1000 + 1);
  assert.equal(desk.overlay(), null);
  assert.deepEqual(desk.recap(), []);
  assert.deepEqual(desk.prune(), { questions: 1, cards: 1, votes: 0 });
  assert.equal(store.getQuestion(item.id), null);
});

test('read queue is scoped to the app session and excludes expired items', () => {
  const { desk } = makeDesk(); const item = submitReviewable(desk);
  assert.equal(desk.listQueue({ role: 'broadcaster' }).length, 1);
  assert.throws(() => desk.listQueue({ role: 'broadcaster', sessionId: 'wrong' }), (error) => error.status === 404);
  assert.throws(() => desk.findReviewable(item.id, 'viewer'), (error) => error.status === 403);
});
