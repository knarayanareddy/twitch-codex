import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class StoreError extends Error {
  constructor(code, message) { super(message); this.name = 'StoreError'; this.code = code; }
}

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS active_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        session_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_session_seq ON events(session_id, seq);
      CREATE TABLE IF NOT EXISTS accepted_voters (
        session_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        actor_hash TEXT NOT NULL,
        accepted_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, round_id, actor_hash)
      );
      CREATE TABLE IF NOT EXISTS delivery_ids (
        session_id TEXT NOT NULL,
        delivery_id TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, delivery_id)
      );
      CREATE TABLE IF NOT EXISTS encrypted_secrets (
        name TEXT PRIMARY KEY,
        nonce TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  loadState() {
    const row = this.db.prepare('SELECT state_json FROM active_state WHERE singleton = 1').get();
    if (!row) return null;
    try { return JSON.parse(row.state_json); }
    catch { throw new StoreError('CORRUPT_STATE', 'Saved session data is not valid JSON. Back up the database before repair.'); }
  }

  commitState(nextState, event, { expectedRevision, actorHash, roundId, deliveryId } = {}) {
    const transaction = this.db.transaction(() => {
      if (deliveryId) {
        const delivery = this.db.prepare('INSERT OR IGNORE INTO delivery_ids(session_id, delivery_id, received_at) VALUES (?, ?, ?)')
          .run(nextState.id, deliveryId, event.createdAt);
        if (delivery.changes === 0) return { committed: false, reason: 'duplicate-delivery' };
      }
      if (actorHash && roundId) {
        const vote = this.db.prepare('INSERT OR IGNORE INTO accepted_voters(session_id, round_id, actor_hash, accepted_at) VALUES (?, ?, ?, ?)')
          .run(nextState.id, roundId, actorHash, event.createdAt);
        if (vote.changes === 0) return { committed: false, reason: 'duplicate-vote' };
      }
      const current = this.db.prepare('SELECT revision FROM active_state WHERE singleton = 1').get();
      if (expectedRevision !== undefined && current && current.revision !== expectedRevision) {
        throw new StoreError('REVISION_CONFLICT', 'Session changed before this action could be saved. Refresh and try again.');
      }
      this.db.prepare(`INSERT INTO active_state(singleton, session_id, revision, state_json, updated_at)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET session_id=excluded.session_id, revision=excluded.revision, state_json=excluded.state_json, updated_at=excluded.updated_at`)
        .run(nextState.id, nextState.revision, JSON.stringify(nextState), nextState.updatedAt);
      this.db.prepare('INSERT INTO events(session_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)')
        .run(nextState.id, event.type, JSON.stringify(event.payload ?? {}), event.createdAt);
      return { committed: true };
    });
    return transaction();
  }

  appendEvent(sessionId, type, payload = {}, createdAt = Date.now()) {
    this.db.prepare('INSERT INTO events(session_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, type, JSON.stringify(payload), createdAt);
  }

  clearRoundVoteIdentity(sessionId, roundId) {
    this.db.prepare('DELETE FROM accepted_voters WHERE session_id = ? AND round_id = ?').run(sessionId, roundId);
  }

  clearVoteIdentity(sessionId) {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM accepted_voters WHERE session_id = ?').run(sessionId);
      this.db.prepare('DELETE FROM delivery_ids WHERE session_id = ?').run(sessionId);
    });
    tx();
  }

  listEvents(sessionId, limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.db.prepare('SELECT seq, type, payload_json, created_at FROM events WHERE session_id = ? ORDER BY seq DESC LIMIT ?')
      .all(sessionId, safeLimit).reverse().map((row) => ({ seq: row.seq, type: row.type, payload: JSON.parse(row.payload_json), createdAt: row.created_at }));
  }

  setEncryptedSecret(name, encrypted, now = Date.now()) {
    this.db.prepare(`INSERT INTO encrypted_secrets(name, nonce, ciphertext, auth_tag, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET nonce=excluded.nonce, ciphertext=excluded.ciphertext, auth_tag=excluded.auth_tag, updated_at=excluded.updated_at`)
      .run(name, encrypted.nonce, encrypted.ciphertext, encrypted.authTag, now);
  }

  getEncryptedSecret(name) {
    const row = this.db.prepare('SELECT nonce, ciphertext, auth_tag AS authTag FROM encrypted_secrets WHERE name = ?').get(name);
    return row ? { nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.authTag } : null;
  }

  deleteSecret(name) { this.db.prepare('DELETE FROM encrypted_secrets WHERE name = ?').run(name); }
  close() { this.db.close(); }
}
