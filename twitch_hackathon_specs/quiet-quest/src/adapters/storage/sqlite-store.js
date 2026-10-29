import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export class SqliteStore {
  constructor(filename = ':memory:') {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
    const prior = process.umask(0o077);
    try { this.db = new Database(filename); } finally { process.umask(prior); }
    if (filename !== ':memory:') { try { fs.chmodSync(filename, 0o600); } catch { /* SQLite reports actual I/O errors. */ } }
    this.db.pragma('journal_mode = WAL'); this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 3000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('demo','live')),
        state_json TEXT NOT NULL, companion_code_hash TEXT NOT NULL,
        twitch_salt TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS contributions (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        round INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('twitch','companion')),
        actor_key TEXT NOT NULL, action_id TEXT NOT NULL, delivery_id TEXT,
        accepted_at INTEGER NOT NULL,
        UNIQUE(session_id, round, source, actor_key)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS contribution_delivery ON contributions(session_id, delivery_id) WHERE delivery_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS contribution_round ON contributions(session_id, round, accepted_at);
      CREATE TABLE IF NOT EXISTS session_events (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        round INTEGER NOT NULL, event_type TEXT NOT NULL, source TEXT,
        action_id TEXT, reason_code TEXT, revision INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_session_time ON session_events(session_id, created_at);
      CREATE TABLE IF NOT EXISTS twitch_credentials (
        id TEXT PRIMARY KEY CHECK(id='primary'), encrypted_json TEXT NOT NULL,
        user_id TEXT NOT NULL, login TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
    `);
    this.sql = {
      getSession: this.db.prepare('SELECT * FROM sessions WHERE id=?'),
      listLive: this.db.prepare('SELECT * FROM sessions WHERE expires_at>? ORDER BY created_at DESC LIMIT 10'),
      byCode: this.db.prepare('SELECT * FROM sessions WHERE companion_code_hash=? AND expires_at>? LIMIT 1'),
      insertSession: this.db.prepare('INSERT INTO sessions(id,mode,state_json,companion_code_hash,twitch_salt,created_at,expires_at) VALUES(@id,@mode,@stateJson,@codeHash,@twitchSalt,@createdAt,@expiresAt)'),
      updateState: this.db.prepare('UPDATE sessions SET state_json=? WHERE id=?'),
      updateCode: this.db.prepare('UPDATE sessions SET companion_code_hash=? WHERE id=?'),
      findActor: this.db.prepare('SELECT 1 AS found FROM contributions WHERE session_id=? AND round=? AND source=? AND actor_key=?'),
      hasContribution: this.db.prepare('SELECT 1 AS found FROM contributions WHERE session_id=? AND round=? AND source=? AND actor_key=?'),
      findDelivery: this.db.prepare('SELECT 1 AS found FROM contributions WHERE session_id=? AND delivery_id=?'),
      insertContribution: this.db.prepare('INSERT INTO contributions(id,session_id,round,source,actor_key,action_id,delivery_id,accepted_at) VALUES(?,?,?,?,?,?,?,?)'),
      insertEvent: this.db.prepare('INSERT INTO session_events(id,session_id,round,event_type,source,action_id,reason_code,revision,created_at) VALUES(@id,@sessionId,@round,@eventType,@source,@actionId,@reasonCode,@revision,@createdAt)'),
      listEvents: this.db.prepare('SELECT round,event_type AS eventType,source,action_id AS actionId,reason_code AS reasonCode,revision,created_at AS createdAt FROM session_events WHERE session_id=? ORDER BY created_at,id'),
      contributions: this.db.prepare('SELECT round,source,action_id AS actionId,COUNT(*) AS count FROM contributions WHERE session_id=? GROUP BY round,source,action_id ORDER BY round,action_id'),
      prune: this.db.prepare('DELETE FROM sessions WHERE expires_at<=?'),
      getTwitch: this.db.prepare("SELECT * FROM twitch_credentials WHERE id='primary'"),
      saveTwitch: this.db.prepare("INSERT INTO twitch_credentials(id,encrypted_json,user_id,login,expires_at,updated_at) VALUES('primary',@encryptedJson,@userId,@login,@expiresAt,@updatedAt) ON CONFLICT(id) DO UPDATE SET encrypted_json=excluded.encrypted_json,user_id=excluded.user_id,login=excluded.login,expires_at=excluded.expires_at,updated_at=excluded.updated_at"),
      deleteTwitch: this.db.prepare("DELETE FROM twitch_credentials WHERE id='primary'"),
    };
  }
  mapSession(row) {
    return row ? { id: row.id, mode: row.mode, state: JSON.parse(row.state_json), codeHash: row.companion_code_hash, twitchSalt: row.twitch_salt, createdAt: row.created_at, expiresAt: row.expires_at } : null;
  }
  createSession({ id, mode, state, codeHash, twitchSalt, createdAt, expiresAt }) {
    this.sql.insertSession.run({ id, mode, stateJson: JSON.stringify(state), codeHash, twitchSalt, createdAt, expiresAt });
    this.addEvent({ sessionId: id, round: state.round, eventType: 'session-created', revision: state.revision, createdAt });
    return this.getSession(id);
  }
  getSession(id) { return this.mapSession(this.sql.getSession.get(id)); }
  listUnexpired(now) { return this.sql.listLive.all(now).map((row) => this.mapSession(row)); }
  findByCodeHash(hash, now) { return this.mapSession(this.sql.byCode.get(hash, now)); }
  updateInvite(sessionId, codeHash) { this.sql.updateCode.run(codeHash, sessionId); }
  addEvent({ sessionId, round, eventType, source = null, actionId = null, reasonCode = null, revision, createdAt }) {
    this.sql.insertEvent.run({ id: randomUUID(), sessionId, round, eventType, source, actionId, reasonCode, revision, createdAt });
  }
  events(sessionId) { return this.sql.listEvents.all(sessionId); }
  applyEvent(sessionId, event, reduce) {
    const tx = this.db.transaction(() => {
      const record = this.getSession(sessionId);
      if (!record) return { accepted: false, reason: 'session-not-found' };
      const state = reduce(record.state, event);
      if (state === record.state) return { accepted: true, changed: false, session: record };
      this.sql.updateState.run(JSON.stringify(state), sessionId);
      this.addEvent({ sessionId, round: state.round, eventType: event.type.toLowerCase().replaceAll('_','-'), source: event.source ?? null, actionId: event.actionId ?? null, reasonCode: event.reasonCode ?? null, revision: state.revision, createdAt: event.now });
      return { accepted: true, changed: true, session: { ...record, state } };
    });
    return tx();
  }
  acceptContribution(command, reduce) {
    const tx = this.db.transaction(() => {
      const record = this.getSession(command.sessionId);
      if (!record || record.expiresAt <= command.now) return { accepted: false, reason: 'session-expired' };
      if (command.deliveryId && this.sql.findDelivery.get(command.sessionId, command.deliveryId)) return { accepted: false, reason: 'duplicate-delivery', session: record };
      if (this.sql.findActor.get(command.sessionId, command.round, command.source, command.actorKey)) return { accepted: false, reason: 'already-contributed', session: record };
      const event = { type: 'CONTRIBUTE', now: command.now, round: command.round, source: command.source, actionId: command.actionId };
      const state = reduce(record.state, event);
      this.sql.insertContribution.run(randomUUID(), command.sessionId, command.round, command.source, command.actorKey, command.actionId, command.deliveryId ?? null, command.now);
      this.sql.updateState.run(JSON.stringify(state), command.sessionId);
      this.addEvent({ sessionId: command.sessionId, round: state.round, eventType: 'contribution-accepted', source: command.source, actionId: command.actionId, revision: state.revision, createdAt: command.now });
      return { accepted: true, reason: null, session: { ...record, state } };
    });
    return tx();
  }
  aggregate(sessionId) { return this.sql.contributions.all(sessionId); }
  hasContribution(sessionId, round, source, actorKey) { return Boolean(this.sql.hasContribution.get(sessionId, round, source, actorKey)); }
  prune(now = Date.now()) { return this.sql.prune.run(now).changes; }
  saveTwitchCredential({ encryptedJson, userId, login, expiresAt, updatedAt = Date.now() }) { this.sql.saveTwitch.run({ encryptedJson, userId, login, expiresAt, updatedAt }); }
  twitchCredential() { const row = this.sql.getTwitch.get(); return row ? { encryptedJson: row.encrypted_json, userId: row.user_id, login: row.login, expiresAt: row.expires_at, updatedAt: row.updated_at } : null; }
  deleteTwitchCredential() { return this.sql.deleteTwitch.run().changes > 0; }
  resetTestData() { const tx = this.db.transaction(() => { const sessions = this.db.prepare('DELETE FROM sessions').run().changes; this.sql.deleteTwitch.run(); return sessions; }); return tx(); }
  close() { this.db.close(); }
}
