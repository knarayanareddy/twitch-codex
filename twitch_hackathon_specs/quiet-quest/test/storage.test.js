import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../src/adapters/storage/sqlite-store.js';
import { QuestService, RETENTION_MS } from '../src/application/quest-service.js';

const now = 1_800_000_000_000; const secret = 'persistent-test-secret-with-more-than-thirty-two-characters';

test('file-backed SQLite restores an active demo and invite, keeps dedupe transactional, then prunes the full session graph', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-quest-store-')); const filename = path.join(directory, 'quest.sqlite');
  let store = new SqliteStore(filename); let service = new QuestService({ store, secret, clock: () => now });
  const { session, code } = service.start('demo');
  assert.equal(service.contribute({ sessionId: session.id, round: 1, source: 'companion', identity: 'browser-token', actionId: 'water' }).accepted, true);
  store.close();

  store = new SqliteStore(filename); service = new QuestService({ store, secret, clock: () => now });
  const restored = service.snapshot(session.id);
  assert.equal(restored.phase, 'active'); assert.equal(restored.total, 1); assert.equal(restored.actions.find((item) => item.id === 'water').count, 1);
  assert.equal(service.resolveInvite(code).id, session.id);
  const duplicate = service.contribute({ sessionId: session.id, round: 1, source: 'companion', identity: 'browser-token', actionId: 'flowers' });
  assert.equal(duplicate.reason, 'already-contributed'); assert.equal(service.snapshot(session.id).total, 1);
  assert.equal(store.events(session.id).length >= 3, true);
  assert.equal(store.prune(now + RETENTION_MS), 1); assert.equal(service.snapshot(session.id), null);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM contributions').get().count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM session_events').get().count, 0);
  store.close(); fs.rmSync(directory, { recursive: true, force: true });
});
