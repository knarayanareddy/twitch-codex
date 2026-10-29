import { EventEmitter } from 'node:events';
import {
  approveChoice, canUndoLastChoice, castVote, closeRoundEarly, createSession, currentRound, discardRound,
  pauseSession, publicState, resumeSession, selectPendingChoice, startSession, undoLastChoice, validateState,
} from '../domain/engine.js';
import { INITIAL_RESOURCE_BUDGET, ROUNDS, SOURCES, getAction, getOption } from '../domain/scenario.js';
import { hashActor } from '../adapters/security.js';

export class ServiceError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'ServiceError'; this.code = code; this.status = status; }
}

export class HabitatService extends EventEmitter {
  constructor({ store, now = () => Date.now(), monotonicNow, voteSalt = randomUUID(), roundDurationMs, onError = () => {} }) {
    super();
    this.store = store;
    this.now = now;
    this.monotonicNow = monotonicNow ?? now;
    this.monotonicDeadline = null;
    this.voteSalt = voteSalt;
    this.roundDurationMs = roundDurationMs;
    this.onError = onError;
    this.lastRejectedAt = new Map();
    this.state = store.loadState();
    if (!this.state) {
      this.state = createSession({ now: this.now(), mode: 'demo' });
      this.store.commitState(this.state, { type: 'session-created', payload: { mode: 'demo' }, createdAt: this.now() });
    }
    this.state.skippedRounds ??= [];
    this.state.resourceBudget ??= Math.max(0, INITIAL_RESOURCE_BUDGET - (this.state.history ?? []).reduce((sum, entry) => sum + (entry.resourceCost ?? 0), 0));
    validateState(this.state);
    this.sessionMonotonicStartedAt = this.monotonicNow() - Math.max(0, this.now() - this.state.createdAt);
    if (this.state.phase === 'voting') this.monotonicDeadline = this.monotonicNow() + Math.max(0, this.state.roundClosesAt - this.now());
    this.publish();
  }

  get rawState() { return this.state; }
  getState() {
    const monotonicRemainingMs = this.state.phase === 'voting' && this.monotonicDeadline !== null ? this.monotonicDeadline - this.monotonicNow() : undefined;
    const sessionElapsedMs = this.monotonicNow() - this.sessionMonotonicStartedAt;
    return publicState(this.state, { now: this.now(), monotonicRemainingMs, sessionElapsedMs });
  }
  getOperatorState() { return { canUndoLastChoice: canUndoLastChoice(this.state) }; }

  recordActionViewed(actionId) {
    const action = getAction(actionId);
    if (!action || this.state.phase !== 'complete') throw new ServiceError('ACTION_UNAVAILABLE', 'That optional action is not available for this session.', 404);
    const event = { type: 'final-action-viewed', payload: { actionId: action.id }, createdAt: this.now() };
    this.store.appendEvent(this.state.id, event.type, event.payload, event.createdAt);
    this.emit('activity', event);
    return { recorded: true };
  }
  getEvents() { return this.store.listEvents(this.state.id); }

  publish() {
    const snapshot = { type: 'state', data: this.getState() };
    this.emit('update', snapshot);
  }

  commit(nextState, type, payload = {}, extras = {}) {
    validateState(nextState);
    const priorPhase = this.state.phase;
    const priorSessionId = this.state.id;
    const priorRoundId = currentRound(this.state)?.id;
    const result = this.store.commitState(nextState, {
      type,
      payload,
      createdAt: this.now(),
    }, { expectedRevision: this.state.revision, ...extras });
    if (!result.committed) return result;
    this.state = nextState;
    if (nextState.id !== priorSessionId) this.sessionMonotonicStartedAt = this.monotonicNow();
    if (nextState.phase === 'voting') {
      if (priorPhase !== 'voting' || priorRoundId !== currentRound(nextState)?.id || this.monotonicDeadline === null) {
        this.monotonicDeadline = this.monotonicNow() + Math.max(0, nextState.roundClosesAt - this.now());
      }
    } else this.monotonicDeadline = null;
    this.publish();
    return result;
  }

  execute(command, payload = {}) {
    const now = this.now();
    let next;
    switch (command) {
      case 'start': {
        const base = this.state.phase === 'ready' && payload.mode && payload.mode !== this.state.mode
          ? createSession({ id: this.state.id, now, mode: payload.mode })
          : this.state;
        next = startSession(base, { now, roundDurationMs: this.roundDurationMs });
        return this.commit(next, 'session-started', { mode: next.mode, scenarioVersion: next.scenarioVersion });
      }
      case 'pause':
        next = pauseSession(this.state, { now, monotonicRemainingMs: this.monotonicDeadline === null ? undefined : this.monotonicDeadline - this.monotonicNow() });
        return this.commit(next, 'session-paused', { phaseBeforePause: this.state.phase });
      case 'resume':
        next = resumeSession(this.state, { now });
        return this.commit(next, 'session-resumed', { phase: next.phase });
      case 'close-round':
        next = closeRoundEarly(this.state, { now });
        return this.commit(next, 'round-closed', { roundId: currentRound(this.state)?.id, outcome: next.voteOutcome });
      case 'select-choice':
        next = selectPendingChoice(this.state, payload.choiceId, { now });
        return this.commit(next, 'choice-selected', { roundId: currentRound(this.state)?.id, choiceId: next.pendingChoiceId });
      case 'approve-choice':
        if (payload.choiceId && payload.choiceId !== this.state.pendingChoiceId) {
          next = selectPendingChoice(this.state, payload.choiceId, { now });
          this.commit(next, 'choice-selected', { roundId: currentRound(this.state)?.id, choiceId: next.pendingChoiceId });
        }
        next = approveChoice(this.state, { now, roundDurationMs: this.roundDurationMs });
        return this.commit(next, 'choice-committed', { roundId: currentRound(this.state)?.id, choiceId: next.history.at(-1)?.choiceId, resourceCost: next.history.at(-1)?.resourceCost ?? 0, budgetAfter: next.resourceBudget });
      case 'reset': {
        const previousId = this.state.id;
        next = createSession({ now, mode: payload.mode ?? this.state.mode });
        const result = this.commit(next, 'session-reset', { previousSessionId: previousId, mode: next.mode });
        this.store.clearVoteIdentity(previousId);
        return result;
      }
      case 'sample-votes':
        return this.addSampleVotes(payload);
      case 'undo-last-choice':
        next = undoLastChoice(this.state, { now });
        return this.commit(next, 'choice-undone', { roundId: currentRound(next)?.id, choiceId: next.pendingChoiceId });
      case 'discard-round': {
        const round = currentRound(this.state);
        if (!round) throw new ServiceError('NO_ACTIVE_ROUND', 'There is no active round to discard.');
        next = discardRound(this.state, { now, roundDurationMs: this.roundDurationMs });
        const result = this.commit(next, 'round-discarded', { roundId: round.id, roundNumber: round.number });
        if (result.committed) this.store.clearRoundVoteIdentity(this.state.id, round.id);
        return result;
      }
      default:
        throw new ServiceError('UNKNOWN_COMMAND', 'That control is not available.', 404);
    }
  }

  submitVote({ optionId, actorId, deliveryId, source = 'twitch' }) {
    if (!['demo', 'live'].includes(this.state.mode)) throw new ServiceError('INVALID_MODE', 'The session mode is invalid.');
    const round = currentRound(this.state);
    if (!round) throw new ServiceError('NO_ACTIVE_ROUND', 'There is no active round.');
    if (!getOption(round.id, optionId)) throw new ServiceError('INVALID_OPTION', 'That option is not part of the current round.');
    const next = castVote(this.state, optionId, { now: this.now() });
    const actorHash = hashActor(actorId, `${this.voteSalt}:${this.state.id}`);
    const result = this.commit(next, 'vote-accepted', { roundId: round.id, optionId, source }, {
      actorHash,
      roundId: round.id,
      deliveryId,
    });
    if (!result.committed) return result;
    return { ...result, tally: this.getState().votes };
  }

  addSampleVotes({ counts = [4, 3] } = {}) {
    if (this.state.mode !== 'demo') throw new ServiceError('DEMO_ONLY', 'Sample votes are available only in demo mode.', 403);
    if (this.state.phase !== 'voting') throw new ServiceError('INVALID_PHASE', 'Start a voting round before adding sample votes.');
    const round = currentRound(this.state);
    if (!Array.isArray(counts) || counts.length !== round.options.length || counts.some((n) => !Number.isInteger(n) || n < 0 || n > 12) || counts.reduce((a, b) => a + b, 0) > 20) {
      throw new ServiceError('INVALID_SAMPLE', 'Sample counts must be valid option totals of no more than 20 votes.');
    }
    let accepted = 0;
    for (let index = 0; index < counts.length; index += 1) {
      for (let n = 0; n < counts[index]; n += 1) {
        const actorId = `demo:${this.state.id}:${round.id}:${index}:${n}`;
        const result = this.submitVote({ optionId: round.options[index].id, actorId, deliveryId: `demo:${this.state.id}:${round.id}:${index}:${n}`, source: 'demo' });
        if (result.committed) accepted += 1;
      }
    }
    return { committed: true, accepted, tally: this.getState().votes };
  }

  recordRejectedChat(reason) {
    const now = this.now();
    if (now - (this.lastRejectedAt.get(reason) ?? -Infinity) < 10_000) return false;
    this.lastRejectedAt.set(reason, now);
    const event = { type: 'vote-rejected', payload: { reason }, createdAt: now };
    this.store.appendEvent(this.state.id, event.type, event.payload, event.createdAt);
    this.emit('activity', event);
    return true;
  }

  handleChatEvent({ text, actorId, deliveryId }) {
    if (this.state.mode !== 'live') return { committed: false, reason: 'not-live' };
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    if (!/^!habitat(?:\s|$)/i.test(normalizedText)) return { committed: false, reason: 'not-a-vote' };
    if (this.state.phase !== 'voting') {
      this.recordRejectedChat('round-closed');
      return { committed: false, reason: 'not-voting' };
    }
    if (typeof actorId !== 'string' || actorId.length < 1 || actorId.length > 100 || typeof deliveryId !== 'string' || deliveryId.length > 200) {
      this.recordRejectedChat('malformed-event');
      return { committed: false, reason: 'invalid-event' };
    }
    const match = normalizedText.match(/^!habitat\s+([1-2])\s*$/i);
    if (!match) {
      this.recordRejectedChat('invalid-command');
      return { committed: false, reason: 'not-a-vote' };
    }
    const round = currentRound(this.state);
    const option = round?.options[Number(match[1]) - 1];
    if (!option) {
      this.recordRejectedChat('invalid-option');
      return { committed: false, reason: 'invalid-option' };
    }
    try {
      const result = this.submitVote({ optionId: option.id, actorId, deliveryId, source: 'twitch' });
      if (!result.committed && result.reason === 'duplicate-vote') return result;
      return result;
    } catch (error) {
      if (error.code === 'ROUND_CLOSED' || error.code === 'INVALID_PHASE') {
        this.recordRejectedChat('late-vote');
        return { committed: false, reason: 'round-closed' };
      }
      this.onError(error);
      this.recordRejectedChat('rejected-vote');
      return { committed: false, reason: 'rejected' };
    }
  }

  expireRound() {
    if (this.state.phase !== 'voting') return false;
    if (this.monotonicDeadline !== null ? this.monotonicDeadline > this.monotonicNow() : this.state.roundClosesAt > this.now()) return false;
    try { this.execute('close-round'); return true; }
    catch (error) { this.onError(error); return false; }
  }

  exportRecap() {
    const state = this.getState();
    return {
      schemaVersion: 1,
      scenarioVersion: state.scenarioVersion,
      sessionId: state.id,
      mode: state.mode,
      createdAt: state.createdAt,
      completedAt: state.completedAt,
      disclaimer: 'This is an authored simulation. Metrics are game state, not ecological measurements or evidence of real-world restoration.',
      finalMetrics: state.metrics,
      fictionalTokensRemaining: state.resourceBudget,
      sources: Object.values(SOURCES).map(({ id, title, publisher, url, checked }) => ({ id, title, publisher, url, checked })),
      optionalActions: (state.phase === 'complete' ? [getAction('ivn-wildlife-friendly-garden')] : []).filter(Boolean),
      skippedRounds: state.skippedRounds ?? [],
      rounds: state.history.map((entry) => ({
        roundId: entry.roundId,
        choiceId: entry.choiceId,
        choiceLabel: entry.choiceLabel,
        votes: entry.votes,
        voteOutcome: entry.voteOutcome,
        note: entry.note,
        resourceCost: entry.resourceCost ?? 0,
        budgetAfter: entry.budgetAfter ?? null,
        sourceId: entry.sourceId,
        committedAt: entry.committedAt,
        metricsAfter: entry.metricsAfter,
      })),
    };
  }

  exportRecapMarkdown() {
    const recap = this.exportRecap();
    const lines = [
      '# Habitat Relay — session field notes',
      '',
      '> Simulation, not measured restoration. Metrics are authored game state, not ecological measurements or evidence of real-world impact.',
      '',
      `- Mode: ${recap.mode.toUpperCase()}`,
      `- Scenario version: ${recap.scenarioVersion}`,
      `- Session: ${recap.sessionId}`,
      `- Completed: ${recap.completedAt ? new Date(recap.completedAt).toISOString() : 'Not completed'}`,
      '',
      '## Round-by-round',
      '',
    ];
    for (const round of ROUNDS) {
      const decision = recap.rounds.find((entry) => entry.roundId === round.id);
      const skipped = recap.skippedRounds.find((entry) => entry.roundId === round.id);
      lines.push(`### ${round.number}. ${round.title}`);
      if (decision) {
        lines.push(`- Community choice: **${decision.choiceLabel}**`);
        lines.push(`- Aggregate votes: ${Object.values(decision.votes).reduce((sum, count) => sum + count, 0)} (${decision.voteOutcome})`);
        lines.push(`- Fictional field tokens used: ${decision.resourceCost ?? 0}; remaining after this choice: ${decision.budgetAfter ?? 'not recorded'}`);
        lines.push(`- Scenario note: ${decision.note}`);
        const source = SOURCES[Object.keys(SOURCES).find((key) => SOURCES[key].id === decision.sourceId)];
        if (source) lines.push(`- Background source: [${source.title}](${source.url}) (${source.publisher}; checked ${source.checked})`);
      } else if (skipped) {
        lines.push(`- Skipped by the streamer; ${skipped.voteTotal} ballot${skipped.voteTotal === 1 ? '' : 's'} were discarded.`);
      } else {
        lines.push('- Not reached in this session.');
      }
      lines.push('');
    }
    lines.push('## Final simulation indicators', '');
    for (const [key, value] of Object.entries(recap.finalMetrics)) lines.push(`- ${key}: ${value}/100`);
    lines.push(`- Fictional field tokens remaining: ${recap.fictionalTokensRemaining} (game-only; not money or a real restoration budget)`);
    lines.push('', '## Optional next step', '');
    for (const action of recap.optionalActions) {
      const source = SOURCES[Object.keys(SOURCES).find((key) => SOURCES[key].id === action.sourceId)];
      lines.push(`${action.description} [${action.label}](${action.url}).`);
      if (source) lines.push(`Source: [${source.title}](${source.url}) (${source.publisher}; checked ${source.checked}).`);
    }
    lines.push('', 'Participation totals are aggregate only. No chat text, voter names, or viewer IDs are included.', '');
    return lines.join('\n');
  }
}
