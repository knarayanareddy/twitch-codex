import { choiceById, LESSON } from './lesson.js';
import { simulateExperiment } from './simulation.js';

export const PHASES = Object.freeze(['ready','predict','choose','reveal','learn','paused','closed']);
export const MAX_PREDICTIONS_PER_CYCLE = 500;
export class LabRuleError extends Error {
  constructor(code, message) { super(message); this.name = 'LabRuleError'; this.code = code; }
}
function requirePhase(state, phase) { if (!state || state.phase !== phase) throw new LabRuleError('INVALID_PHASE', `This action is not available during ${state?.phase || 'an unknown phase'}.`); }
function update(state, patch, now) { return { ...state, ...patch, revision: state.revision + 1, updatedAt: now }; }
function countsFor(lesson) { return Object.fromEntries(lesson.choices.map((choice) => [choice.id, 0])); }
export function createLabState({ id, mode = 'demo', seed, now, lesson = LESSON } = {}) {
  if (!['demo','live'].includes(mode)) throw new LabRuleError('INVALID_MODE', 'Mode must be demo or live.');
  if (typeof id !== 'string' || id.length < 1 || id.length > 128) throw new LabRuleError('INVALID_SESSION', 'A bounded session ID is required.');
  if (typeof seed !== 'string' || seed.length < 1 || seed.length > 128) throw new LabRuleError('INVALID_SEED', 'A bounded replay seed is required.');
  if (!Number.isSafeInteger(now)) throw new LabRuleError('INVALID_TIME', 'Session timestamps must be integer milliseconds.');
  return { schemaVersion: 1, id, lessonId: lesson.id, lessonVersion: lesson.version, mode, seed, phase: 'ready', cycle: 0, revision: 0, createdAt: now, updatedAt: now, closedAt: null, deadlineAt: null, pausedRemainingMs: null, pausedFrom: null, predictions: countsFor(lesson), sourceCounts: { demo: 0, twitch: 0 }, predictionTotal: 0, predictionResult: 'none', leadingChoiceId: null, selectedChoiceId: null, result: null, runs: [], connectionState: mode === 'demo' ? 'simulated' : 'not-configured' };
}
function closePredictions(state, now) {
  const max = Math.max(0, ...Object.values(state.predictions));
  const leaders = Object.entries(state.predictions).filter(([, count]) => count === max && count > 0).map(([id]) => id);
  const predictionResult = leaders.length === 0 ? 'no-votes' : leaders.length === 1 ? 'plurality' : 'tie';
  return update(state, { phase: 'choose', deadlineAt: null, pausedRemainingMs: null, predictionResult, leadingChoiceId: leaders.length === 1 ? leaders[0] : null, selectedChoiceId: leaders.length === 1 ? leaders[0] : null }, now);
}
export function reduceLab(state, event, { lesson = LESSON } = {}) {
  if (!state || !event || !Number.isSafeInteger(event.now)) throw new LabRuleError('INVALID_EVENT', 'Lab events need an integer server timestamp.');
  switch (event.type) {
    case 'START_PREDICTIONS': {
      if (!['ready','learn'].includes(state.phase)) throw new LabRuleError('INVALID_PHASE', 'Start predictions from the ready or learned state.');
      return update(state, { phase: 'predict', cycle: state.cycle + 1, deadlineAt: event.now + lesson.predictionWindowMs, pausedRemainingMs: null, pausedFrom: null, predictions: countsFor(lesson), sourceCounts: { demo: 0, twitch: 0 }, predictionTotal: 0, predictionResult: 'none', leadingChoiceId: null, selectedChoiceId: null, result: null }, event.now);
    }
    case 'PREDICTION_ACCEPTED': {
      requirePhase(state, 'predict');
      if (event.cycle !== state.cycle) throw new LabRuleError('STALE_CYCLE', 'That prediction belongs to a previous experiment cycle.');
      if (state.predictionTotal >= MAX_PREDICTIONS_PER_CYCLE) throw new LabRuleError('PREDICTION_LIMIT', 'This cycle reached its bounded prediction limit.');
      if (event.now >= state.deadlineAt) throw new LabRuleError('PREDICTION_CLOSED', 'Predictions are closed.');
      if (!choiceById(event.choiceId, lesson)) throw new LabRuleError('INVALID_CHOICE', 'Choose one of the three numbered predictions.');
      if (!['demo','twitch'].includes(event.source)) throw new LabRuleError('INVALID_SOURCE', 'This prediction source is not permitted.');
      return update(state, { predictions: { ...state.predictions, [event.choiceId]: state.predictions[event.choiceId] + 1 }, sourceCounts: { ...state.sourceCounts, [event.source]: state.sourceCounts[event.source] + 1 }, predictionTotal: state.predictionTotal + 1 }, event.now);
    }
    case 'CLOSE_PREDICTIONS': requirePhase(state, 'predict'); return closePredictions(state, event.now);
    case 'TICK': return state.phase === 'predict' && event.now >= state.deadlineAt ? closePredictions(state, event.now) : state;
    case 'SELECT_PARAMETER': {
      requirePhase(state, 'choose'); if (!choiceById(event.choiceId, lesson)) throw new LabRuleError('INVALID_CHOICE', 'Select one of the lesson’s three model conditions.');
      return update(state, { selectedChoiceId: event.choiceId }, event.now);
    }
    case 'RUN_EXPERIMENT': {
      requirePhase(state, 'choose'); if (!state.selectedChoiceId) throw new LabRuleError('CHOICE_REQUIRED', 'Select a model condition before running the experiment.');
      const result = simulateExperiment({ lesson, seed: state.seed, choiceId: state.selectedChoiceId });
      return update(state, { phase: 'reveal', result, deadlineAt: null }, event.now);
    }
    case 'REVEAL_RESULT': {
      requirePhase(state, 'reveal'); if (!state.result) throw new LabRuleError('RESULT_REQUIRED', 'Run the model before revealing a result.');
      const run = { cycle: state.cycle, seed: state.seed, lessonId: state.lessonId, lessonVersion: state.lessonVersion, predictions: { ...state.predictions }, predictionTotal: state.predictionTotal, predictionResult: state.predictionResult, leadingChoiceId: state.leadingChoiceId, selectedChoiceId: state.selectedChoiceId, result: state.result, revealedAt: event.now };
      return update(state, { phase: 'learn', runs: [...state.runs, run] }, event.now);
    }
    case 'PAUSE': {
      if (!['predict','choose','reveal'].includes(state.phase)) throw new LabRuleError('INVALID_PHASE', 'Pause is available while predictions are open or the operator is choosing/revealing.');
      const pausedRemainingMs = state.phase === 'predict' ? Math.max(0, state.deadlineAt - event.now) : null;
      return update(state, { phase: 'paused', pausedFrom: state.phase, pausedRemainingMs, deadlineAt: null }, event.now);
    }
    case 'RESUME': {
      requirePhase(state, 'paused'); if (!['predict','choose','reveal'].includes(state.pausedFrom)) throw new LabRuleError('INVALID_PAUSED_STATE', 'The paused phase cannot be resumed.');
      const phase = state.pausedFrom; const deadlineAt = phase === 'predict' ? event.now + Math.max(0, state.pausedRemainingMs ?? 0) : null;
      return update(state, { phase, pausedFrom: null, pausedRemainingMs: null, deadlineAt }, event.now);
    }
    case 'REPLAY': {
      requirePhase(state, 'learn');
      return update(state, { phase: 'ready', deadlineAt: null, pausedRemainingMs: null, pausedFrom: null, predictions: countsFor(lesson), sourceCounts: { demo: 0, twitch: 0 }, predictionTotal: 0, predictionResult: 'none', leadingChoiceId: null, selectedChoiceId: null, result: null, connectionState: state.mode === 'demo' ? 'simulated' : 'not-configured' }, event.now);
    }
    case 'RESET': {
      if (state.phase === 'closed') throw new LabRuleError('SESSION_CLOSED', 'A closed session cannot be reset. Start a fresh demo instead.');
      return update(state, { phase: 'ready', deadlineAt: null, pausedRemainingMs: null, pausedFrom: null, predictions: countsFor(lesson), sourceCounts: { demo: 0, twitch: 0 }, predictionTotal: 0, predictionResult: 'none', leadingChoiceId: null, selectedChoiceId: null, result: null, connectionState: state.mode === 'demo' ? 'simulated' : 'not-configured' }, event.now);
    }
    case 'END_SESSION': {
      if (state.phase === 'closed') throw new LabRuleError('SESSION_CLOSED', 'This session is already closed.');
      return update(state, { phase: 'closed', deadlineAt: null, pausedRemainingMs: null, pausedFrom: null, closedAt: event.now }, event.now);
    }
    default: throw new LabRuleError('UNKNOWN_EVENT', 'Unknown lab event.');
  }
}
export function snapshot(state, { lesson = LESSON, now, operator = false } = {}) {
  if (!Number.isSafeInteger(now)) throw new LabRuleError('INVALID_TIME', 'Snapshot rendering requires an integer timestamp.');
  const remaining = state.phase === 'paused' ? Math.max(0, state.pausedRemainingMs ?? 0) : state.phase === 'predict' ? Math.max(0, state.deadlineAt - now) : 0;
  const resultVisible = state.phase === 'learn';
  return {
    schemaVersion: 1, sessionId: state.id, lessonId: state.lessonId, lessonVersion: state.lessonVersion, mode: state.mode,
    phase: state.phase, cycle: state.cycle, revision: state.revision, prompt: lesson.prompt, objective: lesson.objective,
    predictionWindowMs: lesson.predictionWindowMs, timeRemainingMs: remaining, choices: lesson.choices.map(({ id, number, label, shortLabel, description, albedoPercent, swatch }) => ({ id, number, label, shortLabel, description, albedoPercent, swatch, predictions: state.predictions[id] ?? 0 })),
    predictions: { ...state.predictions }, predictionTotal: state.predictionTotal, sourceCounts: { ...state.sourceCounts }, predictionResult: state.predictionResult, leadingChoiceId: state.leadingChoiceId,
    selectedChoiceId: operator || resultVisible ? state.selectedChoiceId : null, result: resultVisible ? state.result : null, runCount: state.runs.length,
    connectionState: state.connectionState, simulationNotice: 'SIMULATION · This rule-based model is not a real experiment or measurement.',
    assumptionSummary: resultVisible ? lesson.overlayAssumption : null,
    simulation: { id: lesson.simulation.id, formula: lesson.simulation.formula, unit: lesson.simulation.unit },
    seed: operator ? state.seed : undefined,
    phaseLabel: ({ ready:'Ready', predict:'Predict', choose:'Choose', reveal:'Reveal', learn:'Learn', paused:'Paused', closed:'Session ended' })[state.phase],
    source: { title: lesson.source.title, publisher: lesson.source.publisher, url: lesson.source.url, checked: lesson.source.checked },
  };
}
