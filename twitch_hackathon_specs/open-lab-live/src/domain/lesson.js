import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONTENT_PATH = new URL('../content/lessons/albedo-lab.json', import.meta.url);
const ALLOWED_SOURCE_HOSTS = new Set(['science.nasa.gov', 'earthobservatory.nasa.gov']);

export class LessonContentError extends Error {
  constructor(message) { super(message); this.name = 'LessonContentError'; this.code = 'INVALID_LESSON_CONTENT'; }
}
function assert(condition, message) { if (!condition) throw new LessonContentError(message); }
function validText(value) { return typeof value === 'string' && value.trim().length > 0; }
export function validateLesson(lesson) {
  assert(lesson && lesson.schemaVersion === 1, 'Lesson schemaVersion must be 1.');
  assert(/^[a-z0-9-]+$/.test(lesson.id || ''), 'Lesson id must be a stable slug.');
  assert(/^\d+\.\d+\.\d+$/.test(lesson.version || ''), 'Lesson version must use semantic versioning.');
  for (const key of ['title','level','readingLevel','objective','prompt']) assert(validText(lesson[key]), `Lesson ${key} is required.`);
  assert(Number.isInteger(lesson.predictionWindowMs) && lesson.predictionWindowMs >= 10_000 && lesson.predictionWindowMs <= 5 * 60_000, 'Prediction window must be 10 seconds to 5 minutes.');
  assert(Array.isArray(lesson.incomingEnergyOptions) && lesson.incomingEnergyOptions.length === 3 && lesson.incomingEnergyOptions.every((n) => Number.isInteger(n) && n > 0 && n <= 10_000), 'Seeded energy options must contain three bounded integers.');
  assert(new Set(lesson.incomingEnergyOptions).size === 3, 'Seeded energy options must be distinct.');
  assert(Array.isArray(lesson.choices) && lesson.choices.length === 3, 'The lesson must have exactly three choices.');
  const ids = new Set(); const numbers = new Set();
  for (const choice of lesson.choices) {
    assert(/^[a-z0-9-]+$/.test(choice.id || '') && !ids.has(choice.id), 'Choice IDs must be unique slugs.'); ids.add(choice.id);
    assert(/^[1-3]$/.test(choice.number || '') && !numbers.has(choice.number), 'Choice numbers must be unique 1, 2, 3.'); numbers.add(choice.number);
    for (const key of ['label','shortLabel','description']) assert(validText(choice[key]), `Choice ${choice.id} needs ${key}.`);
    assert(Number.isInteger(choice.albedoPercent) && choice.albedoPercent >= 0 && choice.albedoPercent <= 100, `Choice ${choice.id} albedo must be 0–100%.`);
    assert(/^#[0-9a-f]{6}$/i.test(choice.swatch || ''), `Choice ${choice.id} needs a local color swatch.`);
  }
  assert(new Set(lesson.choices.map((choice) => choice.albedoPercent)).size === lesson.choices.length, 'Albedo settings must be distinct.');
  assert(lesson.startingState && Array.isArray(lesson.startingState.incomingEnergyOptions) && lesson.startingState.incomingEnergyOptions.length === 3 && lesson.startingState.incomingEnergyOptions.every((value, index) => value === lesson.incomingEnergyOptions[index]) && lesson.startingState.selectedChoiceId === null && validText(lesson.startingState.incomingEnergySelection), 'The starting state must document one seeded, fixed input and an unselected condition.');
  assert(lesson.variables?.heldConstant?.id === 'incoming-energy' && lesson.variables.heldConstant.unit === lesson.simulation?.unit && lesson.variables.heldConstant.selectedBy === 'session seed' && lesson.variables.heldConstant.perRun === 'fixed across all choices' && Array.isArray(lesson.variables.heldConstant.values) && lesson.variables.heldConstant.values.every((value, index) => value === lesson.incomingEnergyOptions[index]), 'The controlled incoming-energy variable must match the bounded seed options.');
  assert(lesson.variables?.changed?.id === 'albedo-percent' && lesson.variables.changed.unit === 'percent' && lesson.variables.changed.selectedBy === 'operator after aggregate prediction window' && Array.isArray(lesson.variables.changed.values) && lesson.variables.changed.values.length === lesson.choices.length && lesson.variables.changed.values.every((value, index) => value === lesson.choices[index].albedoPercent), 'The operator-selected variable must match the finite lesson choices.');
  assert(lesson.expectedOutputs?.unit === (lesson.simulation?.unit || 'model units') && Array.isArray(lesson.expectedOutputs.goldenVectors) && lesson.expectedOutputs.goldenVectors.length === 3, 'The lesson must carry golden expected outputs for all seeded energy levels.');
  const goldenSeeds = new Set(); const goldenEnergies = new Set();
  for (const vector of lesson.expectedOutputs.goldenVectors) {
    assert(validText(vector.seed) && Number.isInteger(vector.incomingEnergy) && lesson.incomingEnergyOptions.includes(vector.incomingEnergy), 'A golden vector needs a bounded seed and configured energy input.');
    assert(!goldenSeeds.has(vector.seed) && !goldenEnergies.has(vector.incomingEnergy), 'Golden seeds and energy inputs must be unique.'); goldenSeeds.add(vector.seed); goldenEnergies.add(vector.incomingEnergy);
    assert(Array.isArray(vector.results) && vector.results.length === lesson.choices.length, 'Every golden vector must include one result per choice.');
    for (const [index, result] of vector.results.entries()) assert(result.choiceId === lesson.choices[index].id && Number.isInteger(result.absorbedEnergy) && result.absorbedEnergy >= 0 && Number.isInteger(result.reflectedEnergy) && result.reflectedEnergy >= 0 && result.absorbedEnergy + result.reflectedEnergy === vector.incomingEnergy, 'Golden outputs must follow choice order and conserve model units.');
  }
  assert(goldenEnergies.size === lesson.incomingEnergyOptions.length, 'Golden vectors must cover every incoming-energy value.');
  assert(lesson.moderationExamples && Array.isArray(lesson.moderationExamples.safe) && lesson.moderationExamples.safe.length > 0 && lesson.moderationExamples.safe.every(validText) && Array.isArray(lesson.moderationExamples.outOfScope) && lesson.moderationExamples.outOfScope.length > 0 && lesson.moderationExamples.outOfScope.every(validText) && validText(lesson.moderationExamples.handlingNote), 'Safe and out-of-scope moderation examples and their handling boundary are required.');
  assert(lesson.simulation?.id === 'absorbed-fraction-v1' && validText(lesson.simulation.formula), 'Only the reviewed finite albedo rule is allowed; lesson data cannot supply code.');
  for (const group of ['whatItRepresents','whatItDoesNotRepresent','assumptions']) assert(Array.isArray(lesson[group]) && lesson[group].length > 0 && lesson[group].every(validText), `Lesson ${group} must be explicit.`);
  assert(validText(lesson.overlayAssumption), 'The lesson needs a concise assumption note for the broadcast reveal.');
  assert(lesson.source && validText(lesson.source.title) && validText(lesson.source.publisher) && validText(lesson.source.supports), 'Lesson needs a named, relevant source.');
  let source; try { source = new URL(lesson.source.url); } catch { throw new LessonContentError('Lesson source must be a valid HTTPS URL.'); }
  assert(source.protocol === 'https:' && ALLOWED_SOURCE_HOSTS.has(source.hostname) && !source.username && !source.password, 'Lesson source must use an approved HTTPS host.');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(lesson.source.checked || ''), 'Lesson source needs an ISO checked date.');
  assert(Array.isArray(lesson.inputContract?.commands) && lesson.inputContract.commands.length === 3 && lesson.inputContract.freeTextAccepted === false, 'Input must be a finite set of exact commands; free text stays disabled.');
  assert(lesson.inputContract.commands.every((command, index) => command === `!predict ${index + 1}`), 'Prediction command strings must map exactly to the numbered options.');
  return true;
}
export const LESSON = JSON.parse(fs.readFileSync(fileURLToPath(CONTENT_PATH), 'utf8'));
validateLesson(LESSON);
export function choiceById(id, lesson = LESSON) { return lesson.choices.find((choice) => choice.id === id) || null; }
export function choiceByNumber(number, lesson = LESSON) { return lesson.choices.find((choice) => choice.number === String(number)) || null; }
