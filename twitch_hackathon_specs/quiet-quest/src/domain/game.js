export const ROUND_DURATION_MS = 3 * 60 * 1000;
export const TEAM_GOAL = 12;
export const ACTIONS = Object.freeze([
  Object.freeze({ id: 'flowers', label: 'Plant native flowers', chatCommand: '!help 1', detail: 'Add color and food for pollinators.' }),
  Object.freeze({ id: 'shade', label: 'Create a shaded rest spot', chatCommand: '!help 2', detail: 'Make a cool place for neighbors to pause.' }),
  Object.freeze({ id: 'water', label: 'Set out a water station', chatCommand: '!help 3', detail: 'Make the shared space welcoming on warm days.' }),
]);
export const ACTION_BY_ID = new Map(ACTIONS.map((action) => [action.id, action]));
export const ACTION_BY_COMMAND = new Map(ACTIONS.map((action) => [action.chatCommand, action]));

export class GameRuleError extends Error {
  constructor(code, message) { super(message); this.name = 'GameRuleError'; this.code = code; }
}

export function createGameState({ sessionId, mode, now, connectionState = 'disconnected', companionEnabled = true } = {}) {
  if (!sessionId || !['demo', 'live'].includes(mode) || !Number.isSafeInteger(now)) throw new GameRuleError('INVALID_SESSION', 'A session needs an ID, mode, and integer start time.');
  return {
    sessionId, mode, phase: 'ready', round: 1, revision: 0,
    createdAt: now, startedAt: null, deadlineAt: null, pausedRemainingMs: null, endedAt: null,
    total: 0, counts: Object.fromEntries(ACTIONS.map(({ id }) => [id, 0])),
    sourceCounts: { twitch: 0, companion: 0 }, outcome: null,
    connectionState, companionEnabled,
  };
}

export function remainingMs(state, now) {
  if (state.phase === 'paused') return Math.max(0, state.pausedRemainingMs ?? 0);
  if (state.phase !== 'active' || state.deadlineAt == null) return 0;
  return Math.max(0, state.deadlineAt - now);
}

function next(state, patch) { return { ...state, ...patch, revision: state.revision + 1 }; }
function reveal(state, now, reason) {
  const completed = state.total >= TEAM_GOAL;
  const outcome = completed
    ? `Together, you reached the shared goal of ${TEAM_GOAL} contributions. The festival garden is ready.`
    : `You gathered ${state.total} of ${TEAM_GOAL} contributions. The festival garden is taking shape, one step at a time.`;
  return next(state, { phase: 'revealed', endedAt: now, deadlineAt: null, pausedRemainingMs: null, outcome: { completed, reason, text: outcome, contributions: state.total, goal: TEAM_GOAL } });
}

export function reduceGame(state, event) {
  if (!state || !event || !Number.isSafeInteger(event.now)) throw new GameRuleError('INVALID_EVENT', 'A game event needs an integer server timestamp.');
  switch (event.type) {
    case 'START': {
      if (!['ready', 'revealed'].includes(state.phase)) throw new GameRuleError('SESSION_NOT_READY', 'Start or next round is not available in this state.');
      const round = state.phase === 'revealed' ? state.round + 1 : state.round;
      return next(state, { phase: 'active', round, startedAt: event.now, deadlineAt: event.now + ROUND_DURATION_MS, pausedRemainingMs: null, endedAt: null, total: 0, counts: Object.fromEntries(ACTIONS.map(({ id }) => [id, 0])), sourceCounts: { twitch: 0, companion: 0 }, outcome: null });
    }
    case 'CONTRIBUTE': {
      if (state.phase !== 'active') throw new GameRuleError('ROUND_NOT_OPEN', 'This round is not accepting contributions.');
      if (event.round !== state.round) throw new GameRuleError('STALE_ROUND', 'That contribution belongs to a different round.');
      if (event.now >= state.deadlineAt) throw new GameRuleError('ROUND_CLOSED', 'The contribution window has ended.');
      if (!ACTION_BY_ID.has(event.actionId)) throw new GameRuleError('INVALID_ACTION', 'Choose one of the listed contribution actions.');
      if (!['twitch', 'companion'].includes(event.source)) throw new GameRuleError('INVALID_SOURCE', 'Contribution source is not permitted.');
      return next(state, { total: state.total + 1, counts: { ...state.counts, [event.actionId]: state.counts[event.actionId] + 1 }, sourceCounts: { ...state.sourceCounts, [event.source]: state.sourceCounts[event.source] + 1 } });
    }
    case 'PAUSE': {
      if (state.phase !== 'active') throw new GameRuleError('NOT_ACTIVE', 'Only an active round can be paused.');
      const left = remainingMs(state, event.now);
      if (left <= 0) return reveal(state, event.now, 'time-expired');
      return next(state, { phase: 'paused', pausedRemainingMs: left, deadlineAt: null });
    }
    case 'RESUME': {
      if (state.phase !== 'paused') throw new GameRuleError('NOT_PAUSED', 'This round is not paused.');
      const left = Math.max(0, state.pausedRemainingMs ?? 0);
      return left === 0 ? reveal(state, event.now, 'time-expired') : next(state, { phase: 'active', deadlineAt: event.now + left, pausedRemainingMs: null });
    }
    case 'TICK': {
      if (state.phase !== 'active' || event.now < state.deadlineAt) return state;
      return reveal(state, event.now, 'window-ended');
    }
    case 'CLOSE_ROUND': {
      if (!['active', 'paused'].includes(state.phase)) throw new GameRuleError('NOT_OPEN', 'There is no open round to close.');
      return reveal(state, event.now, 'closed-by-streamer');
    }
    case 'END_SESSION': {
      if (state.phase === 'closed') throw new GameRuleError('SESSION_CLOSED', 'This session is already closed.');
      const base = ['active', 'paused'].includes(state.phase) ? reveal(state, event.now, 'session-ended') : state;
      return next(base, { phase: 'closed', deadlineAt: null, pausedRemainingMs: null, endedAt: event.now });
    }
    case 'SET_COMPANION': {
      if (state.phase === 'closed') throw new GameRuleError('SESSION_CLOSED', 'A closed session cannot change input settings.');
      if (typeof event.enabled !== 'boolean') throw new GameRuleError('INVALID_SETTING', 'Companion setting must be true or false.');
      return next(state, { companionEnabled: event.enabled });
    }
    case 'SET_CONNECTION': {
      if (!['connected', 'reconnecting', 'disconnected', 'simulated', 'reauthorization-required'].includes(event.connectionState)) throw new GameRuleError('INVALID_CONNECTION_STATE', 'Unknown connection state.');
      return next(state, { connectionState: event.connectionState });
    }
    default: throw new GameRuleError('UNKNOWN_EVENT', 'Unknown game event.');
  }
}

export function makeSnapshot(state, now) {
  const actionCounts = ACTIONS.map(({ id, label }) => ({ id, label, count: state.counts[id] ?? 0 }));
  return {
    sessionId: state.sessionId, mode: state.mode, phase: state.phase, round: state.round, revision: state.revision,
    prompt: 'Help the community build a shared festival garden. Choose one of three ways to help; no speed bonus.',
    instruction: 'Chat: !help 1, !help 2, or !help 3. Companion: choose an action and submit. One contribution per input route each round; speed does not matter.',
    actions: actionCounts, total: state.total, goal: TEAM_GOAL,
    sourceCounts: { chat: state.sourceCounts.twitch, companion: state.sourceCounts.companion },
    timeRemainingMs: remainingMs(state, now), connectionState: state.connectionState,
    companionEnabled: state.companionEnabled, outcome: state.outcome,
  };
}
