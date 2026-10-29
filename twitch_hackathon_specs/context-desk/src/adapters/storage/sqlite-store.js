import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const STATES = new Set(['queued', 'retrieving', 'review-required', 'approved', 'published', 'insufficient-evidence', 'rejected', 'out-of-scope', 'failed', 'cancelled']);
const TRANSITIONS = { queued: new Set(['retrieving', 'out-of-scope', 'cancelled', 'failed']), retrieving: new Set(['review-required', 'insufficient-evidence', 'out-of-scope', 'failed', 'cancelled']), 'review-required': new Set(['approved', 'rejected', 'insufficient-evidence', 'cancelled']), approved: new Set(['published', 'failed']) };

export class SqliteStore {
  constructor(filename = ':memory:') {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
    const previousUmask = process.umask(0o077);
    try { this.db = new Database(filename); } finally { process.umask(previousUmask); }
    if (filename !== ':memory:') { try { fs.chmodSync(filename, 0o600); } catch { /* SQLite reports readiness on actual I/O. */ } }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 3000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','retrieving','review-required','approved','published','insufficient-evidence','rejected','out-of-scope','failed','cancelled')),
        reason_code TEXT, evidence_json TEXT NOT NULL DEFAULT '[]', draft_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        pack_version TEXT NOT NULL, duplicate_of TEXT
      );
      CREATE INDEX IF NOT EXISTS questions_session_state ON questions(session_id, state, created_at);
      CREATE INDEX IF NOT EXISTS questions_expiry ON questions(expires_at);
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        actor_hash TEXT NOT NULL, actor_role TEXT NOT NULL, action TEXT NOT NULL, state TEXT, reason_code TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_question ON audit_events(question_id, created_at);
      CREATE TABLE IF NOT EXISTS published_cards (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, question_id TEXT NOT NULL, public_question TEXT NOT NULL,
        title TEXT NOT NULL, summary TEXT NOT NULL, uncertainty TEXT NOT NULL, bullets_json TEXT NOT NULL DEFAULT '[]', evidence_json TEXT NOT NULL,
        published_at TEXT NOT NULL, expires_at TEXT NOT NULL, reviewer_role TEXT NOT NULL, review_label TEXT NOT NULL,
        provenance TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'published'
      );
      CREATE INDEX IF NOT EXISTS cards_session_expiry ON published_cards(session_id, expires_at, published_at);
      CREATE TABLE IF NOT EXISTS viewer_votes (
        session_id TEXT NOT NULL, voter_hash TEXT NOT NULL, choice_id TEXT NOT NULL,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(session_id, voter_hash)
      );
      CREATE INDEX IF NOT EXISTS vote_expiry ON viewer_votes(expires_at);
      CREATE TABLE IF NOT EXISTS twitch_connections (
        session_id TEXT PRIMARY KEY, broadcaster_id TEXT NOT NULL, broadcaster_login TEXT NOT NULL,
        encrypted_tokens TEXT NOT NULL, scopes_json TEXT NOT NULL, connected_at TEXT NOT NULL,
        token_expires_at TEXT NOT NULL, eventsub_id TEXT, eventsub_state TEXT NOT NULL
      );
    `);
    const ensureColumn = (table, name, definition) => {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
      if (!columns.includes(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };
    ensureColumn('audit_events', 'state', 'TEXT');
    ensureColumn('published_cards', 'question_id', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('published_cards', 'public_question', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('published_cards', 'provenance', "TEXT NOT NULL DEFAULT 'system-draft-human-approved'");
    ensureColumn('published_cards', 'bullets_json', "TEXT NOT NULL DEFAULT '[]'");
    ensureColumn('published_cards', 'state', "TEXT NOT NULL DEFAULT 'published'");
    this.statements = {
      insertQuestion: this.db.prepare(`INSERT INTO questions(id,session_id,text,source,state,reason_code,evidence_json,draft_json,created_at,updated_at,expires_at,pack_version,duplicate_of) VALUES(@id,@sessionId,@text,@source,@state,@reasonCode,@evidenceJson,@draftJson,@createdAt,@updatedAt,@expiresAt,@packVersion,@duplicateOf)`),
      getQuestion: this.db.prepare('SELECT * FROM questions WHERE id=?'),
      listQuestions: this.db.prepare('SELECT * FROM questions WHERE session_id=? AND expires_at>? ORDER BY CASE state WHEN \'review-required\' THEN 0 WHEN \'queued\' THEN 1 WHEN \'insufficient-evidence\' THEN 2 ELSE 3 END, created_at DESC LIMIT 100'),
      updateState: this.db.prepare('UPDATE questions SET state=@state, reason_code=@reasonCode, updated_at=@updatedAt, evidence_json=COALESCE(@evidenceJson,evidence_json), draft_json=CASE WHEN @hasDraft=1 THEN @draftJson ELSE draft_json END WHERE id=@id AND state=@expectedState'),
      insertEvent: this.db.prepare('INSERT INTO audit_events(id,question_id,actor_hash,actor_role,action,state,reason_code,created_at) VALUES(@id,@questionId,@actorHash,@actorRole,@action,@state,@reasonCode,@createdAt)'),
      listEvents: this.db.prepare('SELECT actor_role AS actorRole, action, state, reason_code AS reasonCode, created_at AS createdAt FROM audit_events WHERE question_id=? ORDER BY created_at'),
      insertCard: this.db.prepare('INSERT INTO published_cards(id,session_id,question_id,public_question,title,summary,uncertainty,bullets_json,evidence_json,published_at,expires_at,reviewer_role,review_label,provenance,state) VALUES(@id,@sessionId,@questionId,@publicQuestion,@title,@summary,@uncertainty,@bulletsJson,@evidenceJson,@publishedAt,@expiresAt,@reviewerRole,@reviewLabel,@provenance,\'published\')'),
      listCards: this.db.prepare('SELECT * FROM published_cards WHERE session_id=? AND expires_at>? ORDER BY published_at ASC LIMIT 50'),
      getCurrentCard: this.db.prepare("SELECT * FROM published_cards WHERE session_id=? AND expires_at>? AND state='published' ORDER BY published_at DESC LIMIT 1"),
      findCurrentCards: this.db.prepare("SELECT id, question_id AS questionId FROM published_cards WHERE session_id=? AND state='published'"),
      archiveCard: this.db.prepare("UPDATE published_cards SET state='archived' WHERE id=? AND state='published'"),
      insertVote: this.db.prepare('INSERT INTO viewer_votes(session_id,voter_hash,choice_id,created_at,expires_at) VALUES(@sessionId,@voterHash,@choiceId,@createdAt,@expiresAt) ON CONFLICT(session_id,voter_hash) DO UPDATE SET choice_id=excluded.choice_id,created_at=excluded.created_at,expires_at=excluded.expires_at WHERE viewer_votes.expires_at<=excluded.created_at'),
      findVote: this.db.prepare('SELECT choice_id AS choiceId FROM viewer_votes WHERE session_id=? AND voter_hash=? AND expires_at>?'),
      countVotes: this.db.prepare('SELECT choice_id AS choiceId, COUNT(*) AS count FROM viewer_votes WHERE session_id=? AND expires_at>? GROUP BY choice_id'),
      deleteExpiredVotes: this.db.prepare('DELETE FROM viewer_votes WHERE expires_at<=?'),
      deleteExpiredQuestions: this.db.prepare('DELETE FROM questions WHERE expires_at<=?'),
      deleteExpiredCards: this.db.prepare('DELETE FROM published_cards WHERE expires_at<=?'),
      getTwitch: this.db.prepare('SELECT * FROM twitch_connections WHERE session_id=?'),
      putTwitch: this.db.prepare(`INSERT INTO twitch_connections(session_id,broadcaster_id,broadcaster_login,encrypted_tokens,scopes_json,connected_at,token_expires_at,eventsub_id,eventsub_state) VALUES(@sessionId,@broadcasterId,@broadcasterLogin,@encryptedTokens,@scopesJson,@connectedAt,@tokenExpiresAt,@eventsubId,@eventsubState) ON CONFLICT(session_id) DO UPDATE SET broadcaster_id=excluded.broadcaster_id,broadcaster_login=excluded.broadcaster_login,encrypted_tokens=excluded.encrypted_tokens,scopes_json=excluded.scopes_json,connected_at=excluded.connected_at,token_expires_at=excluded.token_expires_at,eventsub_id=excluded.eventsub_id,eventsub_state=excluded.eventsub_state`),
      updateTwitchState: this.db.prepare('UPDATE twitch_connections SET eventsub_state=?, eventsub_id=COALESCE(?,eventsub_id) WHERE session_id=?'),
      deleteTwitch: this.db.prepare('DELETE FROM twitch_connections WHERE session_id=?'),
    };
  }

  createQuestion(record, actor) {
    if (!STATES.has(record.state)) throw new Error('Invalid question state.');
    const tx = this.db.transaction(() => {
      this.statements.insertQuestion.run({
        ...record, evidenceJson: JSON.stringify(record.evidence ?? []), draftJson: record.draft ? JSON.stringify(record.draft) : null,
      });
      this.addEvent({ questionId: record.id, actor, action: 'submitted', state: record.state, reasonCode: record.reasonCode, at: record.createdAt });
      return this.getQuestion(record.id);
    });
    return tx();
  }

  getQuestion(id) {
    const row = this.statements.getQuestion.get(id);
    return row ? this.mapQuestion(row) : null;
  }
  listQuestions(sessionId, now) { return this.statements.listQuestions.all(sessionId, now).map((row) => this.mapQuestion(row)); }
  mapQuestion(row) {
    return {
      id: row.id, sessionId: row.session_id, text: row.text, source: row.source, state: row.state,
      reasonCode: row.reason_code, evidence: JSON.parse(row.evidence_json), draft: row.draft_json ? JSON.parse(row.draft_json) : null,
      createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at,
      packVersion: row.pack_version, duplicateOf: row.duplicate_of,
    };
  }
  addEvent({ questionId, actor, action, state = null, reasonCode = null, at = new Date().toISOString() }) {
    this.statements.insertEvent.run({ id: randomUUID(), questionId, actorHash: actor.hash, actorRole: actor.role, action, state, reasonCode, createdAt: at });
  }
  events(questionId) { return this.statements.listEvents.all(questionId); }
  transition(questionId, expectedState, state, reasonCode, actor, action, at, proposal = {}) {
    if (!STATES.has(state) || !TRANSITIONS[expectedState]?.has(state)) throw new Error(`Invalid state transition: ${expectedState} → ${state}.`);
    const tx = this.db.transaction(() => {
      const hasEvidence = Object.hasOwn(proposal, 'evidence');
      const hasDraft = Object.hasOwn(proposal, 'draft');
      const result = this.statements.updateState.run({ id: questionId, expectedState, state, reasonCode, updatedAt: at,
        evidenceJson: hasEvidence ? JSON.stringify(proposal.evidence) : null, hasDraft: hasDraft ? 1 : 0, draftJson: hasDraft && proposal.draft ? JSON.stringify(proposal.draft) : null });
      if (!result.changes) return null;
      this.addEvent({ questionId, actor, action, state, reasonCode, at });
      return this.getQuestion(questionId);
    });
    return tx();
  }
  publish({ card, actor, questionId, at }) {
    const tx = this.db.transaction(() => {
      const question = this.getQuestion(questionId);
      if (!question || question.state !== 'review-required') throw new Error('Question is no longer available for approval.');
      for (const previous of this.statements.findCurrentCards.all(card.sessionId)) {
        if (this.statements.archiveCard.run(previous.id).changes && previous.questionId && this.getQuestion(previous.questionId)) {
          this.addEvent({ questionId: previous.questionId, actor, action: 'archived', state: 'archived', reasonCode: 'superseded-by-newer-card', at });
        }
      }
      const approved = this.statements.updateState.run({ id: questionId, expectedState: 'review-required', state: 'approved', reasonCode: card.provenance, updatedAt: at, evidenceJson: null, hasDraft: 0, draftJson: null });
      if (!approved.changes) throw new Error('Question is no longer available for approval.');
      this.addEvent({ questionId, actor, action: 'approved', state: 'approved', reasonCode: card.provenance, at });
      this.statements.insertCard.run({ ...card, bulletsJson: JSON.stringify(card.bullets), evidenceJson: JSON.stringify(card.evidence), publishedAt: at });
      const published = this.statements.updateState.run({ id: questionId, expectedState: 'approved', state: 'published', reasonCode: 'published-to-overlay', updatedAt: at, evidenceJson: null, hasDraft: 0, draftJson: null });
      if (!published.changes) throw new Error('Approval transaction could not be published.');
      this.addEvent({ questionId, actor, action: 'published', state: 'published', reasonCode: 'published-to-overlay', at });
      return this.getQuestion(questionId);
    });
    return tx();
  }
  cards(sessionId, now) { return this.statements.listCards.all(sessionId, now).map((row) => this.mapCard(row)); }
  currentCard(sessionId, now) { const row = this.statements.getCurrentCard.get(sessionId, now); return row ? this.mapCard(row) : null; }
  mapCard(row) {
    return { id: row.id, questionId: row.question_id, publicQuestion: row.public_question, title: row.title, summary: row.summary, uncertainty: row.uncertainty, bullets: JSON.parse(row.bullets_json || '[]'),
      evidence: JSON.parse(row.evidence_json), publishedAt: row.published_at, expiresAt: row.expires_at,
      reviewLabel: row.review_label, reviewerRole: row.reviewer_role, provenance: row.provenance, provenanceLabel: row.provenance === 'human-edited' ? 'Edited by human · approved by broadcaster' : 'Drafted by system · approved by broadcaster', state: row.state };
  }
  prune(now = new Date().toISOString()) {
    const tx = this.db.transaction(() => ({ questions: this.statements.deleteExpiredQuestions.run(now).changes, cards: this.statements.deleteExpiredCards.run(now).changes, votes: this.statements.deleteExpiredVotes.run(now).changes }));
    return tx();
  }
  insertVote(vote) { return this.statements.insertVote.run(vote).changes > 0; }
  getVote(sessionId, voterHash, now) { return this.statements.findVote.get(sessionId, voterHash, now) ?? null; }
  voteCounts(sessionId, now) {
    return Object.fromEntries(this.statements.countVotes.all(sessionId, now).map((row) => [row.choiceId, row.count]));
  }
  saveTwitchConnection(connection) { this.statements.putTwitch.run({ ...connection, scopesJson: JSON.stringify(connection.scopes) }); }
  twitchConnection(sessionId) {
    const row = this.statements.getTwitch.get(sessionId);
    return row ? { sessionId: row.session_id, broadcasterId: row.broadcaster_id, broadcasterLogin: row.broadcaster_login,
      encryptedTokens: row.encrypted_tokens, scopes: JSON.parse(row.scopes_json), connectedAt: row.connected_at,
      tokenExpiresAt: row.token_expires_at, eventsubId: row.eventsub_id, eventsubState: row.eventsub_state } : null;
  }
  updateTwitchState(sessionId, state, eventsubId = null) { this.statements.updateTwitchState.run(state, eventsubId, sessionId); }
  deleteTwitchConnection(sessionId) { return this.statements.deleteTwitch.run(sessionId).changes > 0; }
  resetSession(sessionId) {
    const tx = this.db.transaction(() => {
      const cards = this.db.prepare('DELETE FROM published_cards WHERE session_id=?').run(sessionId).changes;
      const questions = this.db.prepare('DELETE FROM questions WHERE session_id=?').run(sessionId).changes;
      const votes = this.db.prepare('DELETE FROM viewer_votes WHERE session_id=?').run(sessionId).changes;
      this.statements.deleteTwitch.run(sessionId);
      return { cards, questions, votes };
    });
    return tx();
  }
  close() { this.db.close(); }
}
