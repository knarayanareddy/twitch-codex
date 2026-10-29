import { PUBLIC_PROMPT_TEMPLATES } from '../domain/source-pack.js';
import { DeskError } from './context-desk.js';

export class ViewerPoll {
  constructor({ store, sessionId, clock = () => new Date() }) { this.store = store; this.sessionId = sessionId; this.clock = clock; }
  snapshot(voterHash = null) {
    const now = this.clock().toISOString();
    const counts = this.store.voteCounts(this.sessionId, now);
    const totalVotes = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { question: 'What should Context Desk research next?', note: 'Vote for a topic, not whether a factual claim is true. Only the winning topic is suggested to the broadcaster; nothing is published automatically.', choices: PUBLIC_PROMPT_TEMPLATES.map(({ id, question }) => ({ id, question, votes: counts[id] ?? 0 })), totalVotes, alreadyVoted: voterHash ? Boolean(this.store.getVote(this.sessionId, voterHash, now)) : false, expiresAfterHours: 24 };
  }
  cast(voterHash, choiceId) {
    if (!PUBLIC_PROMPT_TEMPLATES.some((choice) => choice.id === choiceId)) throw new DeskError('INVALID_VOTE_CHOICE', 'Choose one of the listed topic prompts.', 422);
    const now = this.clock().toISOString();
    if (this.store.getVote(this.sessionId, voterHash, now)) return { ...this.snapshot(voterHash), accepted: false, reason: 'already-voted' };
    let inserted = false;
    try { inserted = this.store.insertVote({ sessionId: this.sessionId, voterHash, choiceId, createdAt: now, expiresAt: new Date(this.clock().getTime() + 24 * 60 * 60 * 1000).toISOString() }); }
    catch { return { ...this.snapshot(voterHash), accepted: false, reason: 'already-voted' }; }
    if (!inserted) return { ...this.snapshot(voterHash), accepted: false, reason: 'already-voted' };
    return { ...this.snapshot(voterHash), accepted: true, reason: null };
  }
  results() { return this.snapshot(null); }
  leader() {
    const poll = this.results();
    if (!poll.totalVotes) return null;
    return [...poll.choices].sort((a, b) => b.votes - a.votes || PUBLIC_PROMPT_TEMPLATES.findIndex((choice) => choice.id === a.id) - PUBLIC_PROMPT_TEMPLATES.findIndex((choice) => choice.id === b.id))[0];
  }
}
