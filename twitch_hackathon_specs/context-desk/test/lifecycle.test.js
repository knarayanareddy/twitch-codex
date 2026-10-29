import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SqliteStore } from '../src/adapters/storage/sqlite-store.js';
import { ContextDesk } from '../src/application/context-desk.js';

const sessionId = 'b'.repeat(40);
const actorSecret = 'lifecycle-test-key-with-enough-entropy';
function createDesk(options = {}) {
  const store = new SqliteStore(':memory:');
  const desk = new ContextDesk({ store, sessionId, actorSecret, ...options });
  return { store, desk };
}
function approve(desk, item, edits = {}) {
  return desk.decide(item.id, 'approve', {
    role: 'broadcaster', principal: 'test-broadcaster', publicQuestion: item.draft.publicQuestion,
    title: item.draft.title, summary: item.draft.summary, uncertainty: item.draft.uncertainty,
    bullets: item.draft.bullets, evidenceIds: item.evidence.map((source) => source.id), confirmed: true, ...edits,
  });
}

test('retrieval failure is a persisted, auditable non-publishing state', () => {
  const { store, desk } = createDesk({ retrieve: () => { throw new Error('simulated local retrieval fault'); } });
  const result = desk.submit('Why is Pluto called a dwarf planet?', { actorRole: 'broadcaster', principal: 'local-test' });
  assert.equal(result.question.state, 'failed');
  assert.match(result.message, /No card was published/);
  assert.deepEqual(store.events(result.question.id).map((event) => event.action), ['submitted', 'retrieval-started', 'retrieval-failed']);
  assert.equal(desk.overlay(), null);
  assert.equal(desk.recap().length, 0);
  assert.equal(desk.listQueue({ role: 'broadcaster' })[0].state, 'failed');
  store.close();
});

test('broadcaster cancellation is permission checked, reasoned, and visible in history', () => {
  const { store, desk } = createDesk();
  const item = desk.submit('Why is Pluto called a dwarf planet?', { actorRole: 'broadcaster', principal: 'local-test' }).question;
  assert.throws(() => desk.decide(item.id, 'cancel', { role: 'verified-moderator', reasonCode: 'other' }), (error) => error.code === 'CANCEL_FORBIDDEN');
  assert.throws(() => desk.decide(item.id, 'cancel', { role: 'broadcaster' }), (error) => error.code === 'REASON_REQUIRED');
  const result = desk.decide(item.id, 'cancel', { role: 'broadcaster', principal: 'local-test', reasonCode: 'not-relevant' });
  assert.equal(result.question.state, 'cancelled');
  assert.equal(store.events(item.id).at(-1).action, 'cancelled');
  assert.equal(store.events(item.id).at(-1).reasonCode, 'not-relevant');
  assert.equal(desk.overlay(), null);
  store.close();
});

test('published provenance distinguishes an unchanged deterministic draft from human edits', () => {
  const { store, desk } = createDesk();
  const exact = desk.submit('Why is Pluto called a dwarf planet?', { actorRole: 'broadcaster', principal: 'a' }).question;
  const exactResult = approve(desk, exact);
  assert.equal(exactResult.card.provenance, 'system-draft-human-approved');
  assert.match(exactResult.card.provenanceLabel, /Drafted by system/);
  const edited = desk.submit('What is the IAU definition of a planet?', { actorRole: 'broadcaster', principal: 'b' }).question;
  const editedResult = approve(desk, edited, { publicQuestion: 'Why is Pluto not a planet?', title: 'Pluto fails one classification criterion' });
  assert.equal(editedResult.card.provenance, 'human-edited');
  assert.match(editedResult.card.provenanceLabel, /Edited by human/);
  assert.equal(store.cards(sessionId, new Date().toISOString()).length, 2);
  store.close();
});

test('publishing a newer card archives the prior card and records an audit event', () => {
  const { store, desk } = createDesk();
  const first = desk.submit('Why is Pluto called a dwarf planet?', { actorRole: 'broadcaster', principal: 'a' }).question;
  approve(desk, first);
  const second = desk.submit('What is the difference between an AU and a light-year?', { actorRole: 'broadcaster', principal: 'b' }).question;
  approve(desk, second);
  const cards = store.cards(sessionId, new Date().toISOString());
  assert.deepEqual(cards.map((card) => card.state), ['archived', 'published']);
  assert.equal(desk.overlay().questionId, second.id);
  assert.ok(store.events(first.id).some((event) => event.action === 'archived'));
  store.close();
});

test('SQLite upgrade adds question, public prompt, bullets, provenance and lifecycle columns to an older card table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-desk-migration-'));
  const filename = path.join(dir, 'old.sqlite');
  const oldDb = new Database(filename);
  oldDb.exec(`CREATE TABLE published_cards (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
    uncertainty TEXT NOT NULL, evidence_json TEXT NOT NULL, published_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, reviewer_role TEXT NOT NULL, review_label TEXT NOT NULL
  );`);
  oldDb.close();
  const store = new SqliteStore(filename);
  const columns = store.db.prepare('PRAGMA table_info(published_cards)').all().map((column) => column.name);
  for (const column of ['question_id', 'public_question', 'bullets_json', 'provenance', 'state']) assert.ok(columns.includes(column), `missing migrated ${column}`);
  store.close(); fs.rmSync(dir, { recursive: true, force: true });
});
