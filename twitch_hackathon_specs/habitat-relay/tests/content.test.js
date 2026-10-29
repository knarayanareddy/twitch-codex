import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS, ROUNDS, SOURCES, validateScenarioContent } from '../src/domain/scenario.js';
const content = JSON.parse(readFileSync(new URL('../src/domain/scenario-content.json', import.meta.url), 'utf8'));

test('versioned scenario content satisfies the runtime schema and has three sourced rounds', () => {
  assert.equal(validateScenarioContent(content), true);
  assert.equal(ROUNDS.length, 3);
  assert.ok(ROUNDS.every((round) => SOURCES[Object.keys(SOURCES).find((key) => SOURCES[key].id === round.sourceId)]));
  assert.equal(ACTIONS.length, 1);
  assert.equal(ACTIONS[0].optional, true);
});

test('content validator rejects unsafe destinations, missing sources, and incomplete option effects', () => {
  const unsafe = structuredClone(content);
  unsafe.actions[0].url = 'javascript:alert(1)';
  assert.throws(() => validateScenarioContent(unsafe), { code: 'INVALID_SCENARIO_CONTENT' });

  const unknownSource = structuredClone(content);
  unknownSource.rounds[0].sourceId = 'missing-source';
  assert.throws(() => validateScenarioContent(unknownSource), { code: 'INVALID_SCENARIO_CONTENT' });

  const incompleteEffects = structuredClone(content);
  delete incompleteEffects.rounds[0].options[0].effects.forage;
  assert.throws(() => validateScenarioContent(incompleteEffects), { code: 'INVALID_SCENARIO_CONTENT' });
});

test('content validator enforces bounded fictional budget and option costs', () => {
  const overBudget = structuredClone(content);
  overBudget.resourceBudget.initial = 0;
  assert.throws(() => validateScenarioContent(overBudget), { code: 'INVALID_SCENARIO_CONTENT' });

  const overCost = structuredClone(content);
  overCost.rounds[2].options[0].cost = overCost.resourceBudget.initial + 1;
  assert.throws(() => validateScenarioContent(overCost), { code: 'INVALID_SCENARIO_CONTENT' });
});
