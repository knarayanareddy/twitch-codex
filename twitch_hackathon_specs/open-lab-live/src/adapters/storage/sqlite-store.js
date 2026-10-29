import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export class SqliteStore {
  constructor(filename = ':memory:') {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
    const prior = process.umask(0o077); try { this.db = new Database(filename); } finally { process.umask(prior); }
    if (filename !== ':memory:') { try { fs.chmodSync(filename, 0o600); } catch {} }
    this.db.pragma('journal_mode = WAL'); this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 3000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lab_sessions (
        id TEXT PRIMARY KEY, state_json TEXT NOT NULL, identity_salt TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS lab_sessions_expiry ON lab_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS lab_predictions (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES lab_sessions(id) ON DELETE CASCADE,
        cycle INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('demo','twitch')),
        actor_key TEXT NOT NULL, choice_id TEXT NOT NULL, delivery_id TEXT,
        accepted_at INTEGER NOT NULL,
        UNIQUE(session_id, cycle, source, actor_key)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS lab_prediction_delivery ON lab_predictions(session_id, cycle, delivery_id) WHERE delivery_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS lab_prediction_aggregate ON lab_predictions(session_id, cycle, choice_id);
      CREATE TABLE IF NOT EXISTS lab_events (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES lab_sessions(id) ON DELETE CASCADE,
        cycle INTEGER NOT NULL, event_type TEXT NOT NULL, source TEXT, choice_id TEXT,
        revision INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS lab_events_time ON lab_events(session_id, created_at);
    `);
    this.sql = {
      session: this.db.prepare('SELECT * FROM lab_sessions WHERE id=?'),
      latest: this.db.prepare('SELECT * FROM lab_sessions WHERE expires_at>? ORDER BY created_at DESC LIMIT 1'),
      insertSession: this.db.prepare('INSERT INTO lab_sessions(id,state_json,identity_salt,created_at,expires_at) VALUES(?,?,?,?,?)'),
      saveState: this.db.prepare('UPDATE lab_sessions SET state_json=? WHERE id=?'),
      listEvents: this.db.prepare('SELECT cycle,event_type AS eventType,source,choice_id AS choiceId,revision,created_at AS createdAt FROM lab_events WHERE session_id=? ORDER BY created_at,id'),
      insertVote: this.db.prepare('INSERT INTO lab_predictions(id,session_id,cycle,source,actor_key,choice_id,delivery_id,accepted_at) VALUES(?,?,?,?,?,?,?,?)'),
      findActor: this.db.prepare('SELECT 1 FROM lab_predictions WHERE session_id=? AND cycle=? AND source=? AND actor_key=?'),
      findDelivery: this.db.prepare('SELECT 1 FROM lab_predictions WHERE session_id=? AND cycle=? AND delivery_id=?'),
      aggregate: this.db.prepare('SELECT cycle,choice_id AS choiceId,source,COUNT(*) AS count FROM lab_predictions WHERE session_id=? GROUP BY cycle,choice_id,source ORDER BY cycle,choice_id,source'),
      prune: this.db.prepare('DELETE FROM lab_sessions WHERE expires_at<=?'),
    };
  }
  map(row) { return row ? { id: row.id, state: JSON.parse(row.state_json), identitySalt: row.identity_salt, createdAt: row.created_at, expiresAt: row.expires_at } : null; }
  createSession({ state, identitySalt, expiresAt }) {
    this.sql.insertSession.run(state.id, JSON.stringify(state), identitySalt, state.createdAt, expiresAt);
    this.addEvent({ sessionId: state.id, cycle: 0, type: 'session-created', revision: state.revision, now: state.createdAt });
    return this.getSession(state.id);
  }
  getSession(id) { return this.map(this.sql.session.get(id)); }
  latest(now = Date.now()) { return this.map(this.sql.latest.get(now)); }
  allUnexpired(now = Date.now()) { return this.db.prepare('SELECT * FROM lab_sessions WHERE expires_at>? ORDER BY created_at DESC').all(now).map((row) => this.map(row)); }
  addEvent({ sessionId, cycle, type, source = null, choiceId = null, revision, now }) {
    this.db.prepare('INSERT INTO lab_events(id,session_id,cycle,event_type,source,choice_id,revision,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), sessionId, cycle, type, source, choiceId, revision, now);
  }
  events(sessionId) { return this.sql.listEvents.all(sessionId); }
  aggregates(sessionId) { return this.sql.aggregate.all(sessionId); }
  applyEvent(sessionId, event, reduce) {
    return this.db.transaction(() => {
      const record = this.getSession(sessionId); if (!record) return { changed: false, session: null };
      const next = reduce(record.state, event); if (next === record.state) return { changed: false, session: record };
      this.sql.saveState.run(JSON.stringify(next), sessionId);
      this.addEvent({ sessionId, cycle: next.cycle, type: event.type.toLowerCase().replaceAll('_','-'), source: event.source ?? null, choiceId: event.choiceId ?? null, revision: next.revision, now: event.now });
      return { changed: true, session: { ...record, state: next } };
    })();
  }
  acceptPrediction({ sessionId, cycle, source, actorKey, choiceId, deliveryId = null, now }, reduce) {
    return this.db.transaction(() => {
      const record = this.getSession(sessionId); if (!record || record.expiresAt <= now) return { accepted: false, reason: 'session-expired', session: record };
      if (deliveryId && this.sql.findDelivery.get(sessionId, cycle, deliveryId)) return { accepted: false, reason: 'duplicate-delivery', session: record };
      if (this.sql.findActor.get(sessionId, cycle, source, actorKey)) return { accepted: false, reason: 'already-predicted', session: record };
      const next = reduce(record.state, { type: 'PREDICTION_ACCEPTED', now, cycle, source, choiceId });
      this.sql.insertVote.run(randomUUID(), sessionId, cycle, source, actorKey, choiceId, deliveryId, now);
      this.sql.saveState.run(JSON.stringify(next), sessionId);
      this.addEvent({ sessionId, cycle, type: 'prediction-accepted', source, choiceId, revision: next.revision, now });
      return { accepted: true, reason: null, session: { ...record, state: next } };
    })();
  }
  prune(now = Date.now()) { return this.sql.prune.run(now).changes; }
  close() { this.db.close(); }
}
