import { choiceById, LESSON } from './lesson.js';

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}
export function incomingEnergyForSeed(seed, lesson = LESSON) {
  if (typeof seed !== 'string' || seed.length < 1 || seed.length > 128) throw new TypeError('A bounded deterministic seed is required.');
  return lesson.incomingEnergyOptions[fnv1a(seed) % lesson.incomingEnergyOptions.length];
}
export function simulateChoice({ lesson = LESSON, seed, choiceId }) {
  const choice = choiceById(choiceId, lesson); if (!choice) throw new RangeError('Select one of the lesson choices.');
  const incoming = incomingEnergyForSeed(seed, lesson);
  const absorbed = Math.round(incoming * (100 - choice.albedoPercent) / 100);
  return Object.freeze({ choiceId, albedoPercent: choice.albedoPercent, incomingEnergy: incoming, absorbedEnergy: absorbed, reflectedEnergy: incoming - absorbed, unit: lesson.simulation.unit || 'model units' });
}
export function simulateExperiment({ lesson = LESSON, seed, choiceId }) {
  const tested = simulateChoice({ lesson, seed, choiceId });
  const comparison = lesson.choices.map((choice) => ({ ...simulateChoice({ lesson, seed, choiceId: choice.id }), label: choice.shortLabel, number: choice.number }));
  const greatestAbsorption = comparison.reduce((best, item) => !best || item.absorbedEnergy > best.absorbedEnergy ? item : best, null);
  return Object.freeze({
    tested,
    comparison,
    highestAbsorptionChoiceId: greatestAbsorption.choiceId,
    explanation: `In this model, ${tested.incomingEnergy} incoming model units × (100 − ${tested.albedoPercent}% reflected) ÷ 100 = ${tested.absorbedEnergy} absorbed and ${tested.reflectedEnergy} reflected. Lower albedo means a larger absorbed share in this rule.`,
    limitation: 'This is arithmetic in model units, not a temperature, field observation, or climate prediction.',
  });
}
export function modelRuleVectors(lesson = LESSON) {
  return lesson.incomingEnergyOptions.flatMap((incoming) => lesson.choices.map((choice) => ({ incoming, choiceId: choice.id, absorbed: Math.round(incoming * (100 - choice.albedoPercent) / 100), reflected: incoming - Math.round(incoming * (100 - choice.albedoPercent) / 100) })));
}
