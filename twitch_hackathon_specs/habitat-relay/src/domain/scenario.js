import { readFileSync } from 'node:fs';
const CONTENT = JSON.parse(readFileSync(new URL('./scenario-content.json', import.meta.url), 'utf8'));
const ALLOWED_HOSTS = new Set(['www.eea.europa.eu', 'www.fao.org', 'www.ivn.nl']);

export class ContentError extends Error {
  constructor(message) { super(message); this.name = 'ContentError'; this.code = 'INVALID_SCENARIO_CONTENT'; }
}

function assert(condition, message) {
  if (!condition) throw new ContentError(message);
}

function assertSafeUrl(rawUrl, label) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new ContentError(`${label} must be a valid HTTPS URL.`); }
  assert(url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) && !url.username && !url.password, `${label} must use an approved HTTPS source host.`);
}

export function validateScenarioContent(content) {
  assert(content && /^\d+\.\d+\.\d+$/.test(content.version), 'Scenario content needs a semantic version.');
  assert(Number.isInteger(content.roundDurationMs) && content.roundDurationMs >= 1_000 && content.roundDurationMs <= 30 * 60_000, 'Round duration is outside safe bounds.');
  assert(Number.isInteger(content.resourceBudget?.initial) && content.resourceBudget.initial >= 1 && content.resourceBudget.initial <= 100 && typeof content.resourceBudget.label === 'string' && typeof content.resourceBudget.note === 'string', 'Scenario needs a bounded fictional resource budget.');
  assert(Array.isArray(content.rounds) && content.rounds.length === 3, 'The Pollinator Corridor scenario must contain exactly three rounds.');
  const metricKeys = Object.keys(content.metrics ?? {});
  assert(metricKeys.length > 0 && metricKeys.every((key) => Number.isInteger(content.metrics[key]) && content.metrics[key] >= 0 && content.metrics[key] <= 100), 'Initial metrics must be bounded integers.');
  assert(metricKeys.every((key) => typeof content.metricLabels?.[key] === 'string' && content.metricLabels[key].trim()), 'Every metric needs an accessible label.');
  const sources = Object.values(content.sources ?? {});
  const sourceIds = new Set(sources.map((source) => source.id));
  assert(sources.length > 0 && sourceIds.size === sources.length, 'Source IDs must be unique.');
  for (const source of sources) {
    assert(typeof source.title === 'string' && source.title.trim() && typeof source.publisher === 'string' && source.publisher.trim(), 'Each source needs a title and publisher.');
    assert(typeof source.supports === 'string' && source.supports.trim(), 'Each source needs a relevance note.');
    assertSafeUrl(source.url, `Source “${source.id}”`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(source.checked), `Source “${source.id}” needs a checked date.`);
  }
  const roundIds = new Set();
  for (const round of content.rounds) {
    assert(typeof round.id === 'string' && !roundIds.has(round.id), 'Round IDs must be unique.');
    roundIds.add(round.id);
    assert(sourceIds.has(round.sourceId), `Round “${round.id}” references an unknown source.`);
    assert(Array.isArray(round.options) && round.options.length >= 2 && round.options.length <= 3, `Round “${round.id}” needs two or three options.`);
    const optionIds = new Set();
    for (const option of round.options) {
      assert(typeof option.id === 'string' && !optionIds.has(option.id), `Option IDs must be unique in “${round.id}”.`);
      optionIds.add(option.id);
      assert(typeof option.label === 'string' && option.label.trim() && typeof option.description === 'string' && option.description.trim(), `Option in “${round.id}” needs plain-language text.`);
      assert(typeof option.note === 'string' && option.note.trim(), `Option “${option.id}” needs an explicit simulation/trade-off note.`);
      assert(Object.keys(content.metrics).every((key) => Number.isInteger(option.effects?.[key])), `Option “${option.id}” needs an integer effect for every metric.`);
      assert(Number.isInteger(option.cost) && option.cost >= 0 && option.cost <= content.resourceBudget.initial, `Option “${option.id}” needs a safe fictional resource cost.`);
    }
  }
  assert(Array.isArray(content.actions) && content.actions.every((action) => action.optional === true), 'Final actions must be an explicitly optional list.');
  const actionIds = new Set();
  for (const action of content.actions) {
    assert(typeof action.id === 'string' && !actionIds.has(action.id), 'Action IDs must be unique.');
    actionIds.add(action.id);
    assert(typeof action.title === 'string' && action.title.trim() && typeof action.description === 'string' && action.description.trim(), 'Each action needs a title and explanation.');
    assert(typeof action.label === 'string' && action.label.trim(), 'Each action needs a link label.');
    assert(sourceIds.has(action.sourceId), `Action “${action.id}” references an unknown source.`);
    assertSafeUrl(action.url, `Action “${action.id}”`);
    assert(action.url === content.sources[Object.keys(content.sources).find((key) => content.sources[key].id === action.sourceId)]?.url, `Action “${action.id}” URL must match its cited source.`);
  }
  return true;
}

validateScenarioContent(CONTENT);

export const SCENARIO_VERSION = CONTENT.version;
export const ROUND_DURATION_MS = CONTENT.roundDurationMs;
export const ROUNDS = CONTENT.rounds;
export const SOURCES = CONTENT.sources;
export const ACTIONS = CONTENT.actions;
export const INITIAL_METRICS = Object.freeze({ ...CONTENT.metrics });
export const INITIAL_RESOURCE_BUDGET = CONTENT.resourceBudget.initial;
export const RESOURCE_BUDGET = Object.freeze({ ...CONTENT.resourceBudget });
export const METRIC_LABELS = Object.freeze({ ...CONTENT.metricLabels });

export function getRound(roundId) {
  return ROUNDS.find((round) => round.id === roundId) ?? null;
}

export function getOption(roundId, optionId) {
  return getRound(roundId)?.options.find((option) => option.id === optionId) ?? null;
}

export function getSource(sourceId) {
  return Object.values(SOURCES).find((source) => source.id === sourceId) ?? null;
}

export function getAction(actionId) {
  return ACTIONS.find((action) => action.id === actionId) ?? null;
}
