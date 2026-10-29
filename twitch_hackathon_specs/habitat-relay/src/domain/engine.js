import { randomUUID } from 'node:crypto';
import { INITIAL_METRICS, INITIAL_RESOURCE_BUDGET, ROUNDS, SCENARIO_VERSION, ROUND_DURATION_MS, getOption, getRound } from './scenario.js';

export class DomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export function createSession({ id = randomUUID(), now = Date.now(), mode = 'demo' } = {}) {
  if (!['demo', 'live'].includes(mode)) throw new DomainError('INVALID_MODE', 'Mode must be demo or live.');
  return {
    schemaVersion: 1,
    scenarioVersion: SCENARIO_VERSION,
    id,
    mode,
    phase: 'ready',
    roundIndex: 0,
    metrics: { ...INITIAL_METRICS },
    resourceBudget: INITIAL_RESOURCE_BUDGET,
    votes: {},
    history: [],
    skippedRounds: [],
    pendingChoiceId: null,
    tieOptionIds: [],
    voteOutcome: null,
    roundOpenedAt: null,
    roundClosesAt: null,
    pausedFrom: null,
    remainingMs: null,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    completedAt: null,
  };
}

export function currentRound(state) {
  if (!state || state.roundIndex < 0 || state.roundIndex >= ROUNDS.length) return null;
  return ROUNDS[state.roundIndex];
}

function changed(state, patch, now) {
  return { ...state, ...patch, updatedAt: now, revision: state.revision + 1 };
}

function requirePhase(state, expected) {
  if (!state || state.phase !== expected) throw new DomainError('INVALID_PHASE', `This action requires phase “${expected}”.`);
}

export function startSession(state, { now = Date.now(), roundDurationMs = ROUND_DURATION_MS } = {}) {
  requirePhase(state, 'ready');
  if (!Number.isFinite(roundDurationMs) || roundDurationMs < 1_000 || roundDurationMs > 30 * 60_000) {
    throw new DomainError('INVALID_DURATION', 'Round duration must be between 1 second and 30 minutes.');
  }
  return openRound(state, 0, now, roundDurationMs);
}

function openRound(state, index, now, durationMs = ROUND_DURATION_MS) {
  const round = ROUNDS[index];
  return changed(state, {
    phase: 'voting',
    roundIndex: index,
    votes: Object.fromEntries(round.options.map((option) => [option.id, 0])),
    pendingChoiceId: null,
    tieOptionIds: [],
    voteOutcome: null,
    roundOpenedAt: now,
    roundClosesAt: now + durationMs,
    pausedFrom: null,
    remainingMs: null,
  }, now);
}

export function castVote(state, optionId, { now = Date.now() } = {}) {
  requirePhase(state, 'voting');
  if (now >= state.roundClosesAt) throw new DomainError('ROUND_CLOSED', 'This round has closed.');
  const round = currentRound(state);
  if (!round || !getOption(round.id, optionId)) throw new DomainError('INVALID_OPTION', 'Choose one of the options shown for this round.');
  const votes = { ...state.votes, [optionId]: state.votes[optionId] + 1 };
  return changed(state, { votes }, now);
}

export function closeVoting(state, { now = Date.now() } = {}) {
  requirePhase(state, 'voting');
  if (now < state.roundClosesAt) throw new DomainError('ROUND_STILL_OPEN', 'Close the round after its timer ends, or use the operator close action.');
  return reviewVotes(state, now);
}

export function closeRoundEarly(state, { now = Date.now() } = {}) {
  requirePhase(state, 'voting');
  return reviewVotes(state, now);
}

function reviewVotes(state, now) {
  const entries = Object.entries(state.votes);
  const maxVotes = Math.max(0, ...entries.map(([, count]) => count));
  const leaders = entries.filter(([, count]) => count === maxVotes && count > 0).map(([id]) => id);
  const outcome = leaders.length === 0 ? 'no-votes' : leaders.length === 1 ? 'plurality' : 'tie';
  return changed(state, {
    phase: 'review',
    pendingChoiceId: leaders.length === 1 ? leaders[0] : null,
    tieOptionIds: leaders.length > 1 ? leaders : [],
    voteOutcome: outcome,
    roundClosesAt: now,
    remainingMs: null,
  }, now);
}

export function selectPendingChoice(state, optionId, { now = Date.now() } = {}) {
  requirePhase(state, 'review');
  const round = currentRound(state);
  if (!round || !getOption(round.id, optionId)) throw new DomainError('INVALID_OPTION', 'Choose an option from the current round.');
  return changed(state, { pendingChoiceId: optionId }, now);
}

export function approveChoice(state, { now = Date.now(), roundDurationMs = ROUND_DURATION_MS } = {}) {
  requirePhase(state, 'review');
  if (!state.pendingChoiceId) throw new DomainError('CHOICE_REQUIRED', 'Select the choice the streamer wants to commit.');
  const round = currentRound(state);
  const option = getOption(round.id, state.pendingChoiceId);
  if (!option) throw new DomainError('INVALID_OPTION', 'The selected choice is no longer valid.');
  if (option.cost > state.resourceBudget) throw new DomainError('INSUFFICIENT_RESOURCES', 'There are not enough fictional field tokens for that option. Select a lower-cost path or discard the round.');
  const budgetBefore = state.resourceBudget;
  const resourceBudget = state.resourceBudget - option.cost;
  const metrics = { ...state.metrics };
  for (const [key, delta] of Object.entries(option.effects)) {
    metrics[key] = Math.max(0, Math.min(100, metrics[key] + delta));
  }
  const historyEntry = {
    roundId: round.id,
    choiceId: option.id,
    choiceLabel: option.shortLabel,
    note: option.note,
    votes: { ...state.votes },
    voteOutcome: state.voteOutcome,
    committedAt: now,
    metricsBefore: { ...state.metrics },
    metricsAfter: metrics,
    resourceCost: option.cost,
    budgetBefore,
    budgetAfter: resourceBudget,
    sourceId: round.sourceId,
  };
  const history = [...state.history, historyEntry];
  if (state.roundIndex + 1 >= ROUNDS.length) {
    return changed(state, {
      phase: 'complete',
      roundIndex: ROUNDS.length,
      metrics,
      resourceBudget,
      history,
      votes: {},
      pendingChoiceId: null,
      tieOptionIds: [],
      roundClosesAt: null,
      completedAt: now,
      remainingMs: null,
      pausedFrom: null,
    }, now);
  }
  const committed = changed(state, {
    metrics,
    resourceBudget,
    history,
    votes: {},
    pendingChoiceId: null,
    tieOptionIds: [],
    voteOutcome: null,
  }, now);
  return openRound(committed, state.roundIndex + 1, now, roundDurationMs);
}

export function pauseSession(state, { now = Date.now(), monotonicRemainingMs } = {}) {
  if (!['voting', 'review'].includes(state?.phase)) throw new DomainError('INVALID_PHASE', 'Only an active round can be paused.');
  const remainingMs = state.phase === 'voting'
    ? Number.isFinite(monotonicRemainingMs) ? Math.max(0, monotonicRemainingMs) : Math.max(0, state.roundClosesAt - now)
    : null;
  return changed(state, {
    phase: 'paused',
    pausedFrom: state.phase,
    remainingMs,
    roundClosesAt: null,
  }, now);
}

export function resumeSession(state, { now = Date.now() } = {}) {
  requirePhase(state, 'paused');
  if (!['voting', 'review'].includes(state.pausedFrom)) throw new DomainError('INVALID_PAUSED_STATE', 'The paused session cannot be resumed.');
  const phase = state.pausedFrom;
  return changed(state, {
    phase,
    pausedFrom: null,
    roundClosesAt: phase === 'voting' ? now + Math.max(0, state.remainingMs ?? 0) : null,
    remainingMs: null,
  }, now);
}

export function canUndoLastChoice(state) {
  if (!state?.history?.length) return false;
  const last = state.history.at(-1);
  const lastIndex = ROUNDS.findIndex((round) => round.id === last.roundId);
  if (lastIndex < 0) return false;
  if (state.phase === 'complete') return state.roundIndex === ROUNDS.length && lastIndex === ROUNDS.length - 1;
  if (state.phase !== 'voting' || state.roundIndex !== lastIndex + 1) return false;
  return Object.values(state.votes ?? {}).every((count) => count === 0);
}

export function undoLastChoice(state, { now = Date.now() } = {}) {
  if (!canUndoLastChoice(state)) throw new DomainError('UNDO_UNSAFE', 'Undo is available only immediately after a committed choice, before the next round receives votes.');
  const entry = state.history.at(-1);
  const roundIndex = ROUNDS.findIndex((round) => round.id === entry.roundId);
  const priorMetrics = entry.metricsBefore
    ?? (state.history.length > 1 ? state.history.at(-2).metricsAfter : INITIAL_METRICS);
  const ties = entry.voteOutcome === 'tie'
    ? Object.entries(entry.votes).filter(([, count]) => count > 0 && count === Math.max(...Object.values(entry.votes))).map(([id]) => id)
    : [];
  const priorBudget = entry.budgetBefore ?? state.resourceBudget + (entry.resourceCost ?? 0);
  return changed(state, {
    phase: 'review',
    roundIndex,
    metrics: { ...priorMetrics },
    resourceBudget: priorBudget,
    history: state.history.slice(0, -1),
    votes: { ...entry.votes },
    pendingChoiceId: entry.choiceId,
    tieOptionIds: ties,
    voteOutcome: entry.voteOutcome,
    roundOpenedAt: null,
    roundClosesAt: null,
    pausedFrom: null,
    remainingMs: null,
    completedAt: null,
  }, now);
}

export function discardRound(state, { now = Date.now(), roundDurationMs = ROUND_DURATION_MS } = {}) {
  if (!['voting', 'review'].includes(state?.phase)) throw new DomainError('INVALID_PHASE', 'Only the active voting or review round can be discarded.');
  const round = currentRound(state);
  if (!round) throw new DomainError('INVALID_ROUND', 'There is no active round to discard.');
  const skippedRounds = [...(state.skippedRounds ?? []), {
    roundId: round.id,
    roundNumber: round.number,
    discardedAt: now,
    voteTotal: Object.values(state.votes ?? {}).reduce((sum, count) => sum + count, 0),
  }];
  if (state.roundIndex + 1 >= ROUNDS.length) {
    return changed(state, {
      phase: 'complete',
      roundIndex: ROUNDS.length,
      skippedRounds,
      votes: {},
      pendingChoiceId: null,
      tieOptionIds: [],
      roundClosesAt: null,
      remainingMs: null,
      pausedFrom: null,
      completedAt: now,
    }, now);
  }
  const intermediate = changed(state, { skippedRounds }, now);
  return openRound(intermediate, state.roundIndex + 1, now, roundDurationMs);
}

export function publicState(state, { now = Date.now(), monotonicRemainingMs, sessionElapsedMs } = {}) {
  const round = currentRound(state);
  return {
    schemaVersion: state.schemaVersion,
    scenarioVersion: state.scenarioVersion,
    id: state.id,
    mode: state.mode,
    phase: state.phase,
    roundIndex: state.roundIndex,
    totalRounds: ROUNDS.length,
    round: round ? {
      id: round.id,
      number: round.number,
      eyebrow: round.eyebrow,
      title: round.title,
      prompt: round.prompt,
      sourceId: round.sourceId,
      options: round.options.map(({ id, number, label, shortLabel, description, cost }) => ({ id, number, label, shortLabel, description, cost })),
    } : null,
    metrics: { ...state.metrics },
    resourceBudget: state.resourceBudget,
    resourceBudgetMax: INITIAL_RESOURCE_BUDGET,
    votes: { ...state.votes },
    voteTotal: Object.values(state.votes).reduce((sum, count) => sum + count, 0),
    history: state.history.map(({ metricsBefore, budgetBefore, ...entry }) => ({ ...entry, votes: { ...entry.votes }, metricsAfter: { ...entry.metricsAfter } })), 
    skippedRounds: [...(state.skippedRounds ?? [])],
    pendingChoiceId: state.pendingChoiceId,
    tieOptionIds: [...state.tieOptionIds],
    voteOutcome: state.voteOutcome,
    roundOpenedAt: state.roundOpenedAt,
    roundClosesAt: state.roundClosesAt,
    remainingMs: state.phase === 'paused' ? state.remainingMs : state.phase === 'voting' ? Number.isFinite(monotonicRemainingMs) ? Math.max(0, monotonicRemainingMs) : Math.max(0, state.roundClosesAt - now) : null,
    sessionElapsedMs: Number.isFinite(sessionElapsedMs) ? Math.max(0, sessionElapsedMs) : Math.max(0, now - state.createdAt),
    pausedFrom: state.phase === 'paused' ? state.pausedFrom : null,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    revision: state.revision,
    completedAt: state.completedAt,
  };
}

export function validateState(state) {
  if (!state || state.schemaVersion !== 1) throw new DomainError('INVALID_STATE', 'Unsupported session state schema.');
  if (!['demo', 'live'].includes(state.mode)) throw new DomainError('INVALID_STATE', 'Invalid session mode.');
  if (!['ready', 'voting', 'review', 'paused', 'complete'].includes(state.phase)) throw new DomainError('INVALID_STATE', 'Invalid session phase.');
  if (!Number.isInteger(state.roundIndex) || state.roundIndex < 0 || state.roundIndex > ROUNDS.length) throw new DomainError('INVALID_STATE', 'Invalid round index.');
  for (const value of Object.values(state.metrics)) {
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new DomainError('INVALID_STATE', 'Metric values must be between 0 and 100.');
  }
  if (!Number.isInteger(state.resourceBudget) || state.resourceBudget < 0 || state.resourceBudget > INITIAL_RESOURCE_BUDGET) throw new DomainError('INVALID_STATE', 'Fictional resource tokens are outside safe bounds.');
  if (state.phase === 'voting') {
    const round = currentRound(state);
    if (!round || !state.roundClosesAt || Object.keys(state.votes).length !== round.options.length) throw new DomainError('INVALID_STATE', 'Voting state is incomplete.');
    for (const [key, value] of Object.entries(state.votes)) {
      if (!round.options.some((option) => option.id === key) || !Number.isInteger(value) || value < 0) throw new DomainError('INVALID_STATE', 'Vote tally is invalid.');
    }
  }
  if (state.phase === 'review' && !currentRound(state)) throw new DomainError('INVALID_STATE', 'Review state has no active round.');
  if (!Array.isArray(state.history) || !Array.isArray(state.skippedRounds ?? [])) throw new DomainError('INVALID_STATE', 'Session history is malformed.');
  if (state.history.length + (state.skippedRounds ?? []).length > ROUNDS.length) throw new DomainError('INVALID_STATE', 'Session history exceeds scenario length.');
  const recordedRounds = [...state.history.map((entry) => entry.roundId), ...(state.skippedRounds ?? []).map((entry) => entry.roundId)];
  if (recordedRounds.some((id) => !ROUNDS.some((round) => round.id === id)) || new Set(recordedRounds).size !== recordedRounds.length) throw new DomainError('INVALID_STATE', 'A round is missing, duplicated, or unknown in session history.');
  if (state.phase === 'complete' && state.roundIndex !== ROUNDS.length) throw new DomainError('INVALID_STATE', 'Completed sessions must be at the end of the scenario.');
  return true;
}
