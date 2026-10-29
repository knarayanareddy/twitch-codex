import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SOURCE_PACK, SOURCES, SAMPLES, contentHash, validateSourcePack, SourcePackError } from '../src/domain/source-pack.js';
import { sanitizeQuestion, normalizeQuestion, classifyQuestion, validatePublicText, QuestionError } from '../src/domain/question.js';
import { retrieveEvidence, scoreSource } from '../src/application/retrieval.js';

const sample = (id) => SAMPLES.find((item) => item.id === id);

test('the curated pack validates all metadata, bounded paraphrases and content hashes', () => {
  assert.equal(validateSourcePack(SOURCE_PACK), true);
  assert.equal(SOURCES.length, 6);
  assert.equal(new Set(SOURCES.map((item) => item.id)).size, SOURCES.length);
  for (const source of SOURCES) {
    assert.equal(source.contentHash, contentHash(source.excerpt));
    assert.match(source.url, /^https:\/\//);
    assert.ok(source.licenseUsageNote.length > 20);
    assert.ok(source.excerpt.length <= 1600);
  }
});

test('a stale or malformed pack cannot load', async () => {
  const original = JSON.parse(await readFile(new URL('../data/topic-pack.json', import.meta.url), 'utf8'));
  const badHash = structuredClone(original); badHash.sources[0].excerpt += ' changed';
  assert.throws(() => validateSourcePack(badHash), SourcePackError);
  const badHost = structuredClone(original); badHost.sources[0].url = 'https://example.net/planet';
  assert.throws(() => validateSourcePack(badHost), /approved HTTPS host/);
  const repeated = structuredClone(original); repeated.sources[1].id = repeated.sources[0].id;
  assert.throws(() => validateSourcePack(repeated), /unique/);
  const badModel = structuredClone(original); badModel.policy.modelProvider = 'arbitrary-provider';
  assert.throws(() => validateSourcePack(badModel), /no-model mode/);
  const badRetention = structuredClone(original); badRetention.policy.retentionHours = 0;
  assert.throws(() => validateSourcePack(badRetention), /24-hour retention/);
});

test('plain-language intake normalizes Unicode and rejects markup, URLs, PII and bounds', () => {
  assert.equal(sanitizeQuestion('  What is a light-year?  '), 'What is a light-year?');
  assert.equal(normalizeQuestion('  PLÚTO—Planet! '), 'pluto planet');
  assert.throws(() => sanitizeQuestion('short'), (error) => error instanceof QuestionError && error.code === 'QUESTION_LENGTH');
  assert.throws(() => sanitizeQuestion('What is a planet? https://example.com'), (error) => error.code === 'LINK_NOT_ALLOWED');
  assert.throws(() => sanitizeQuestion('<script>alert(1)</script> What is Pluto?'), (error) => error.code === 'UNSAFE_MARKUP');
  assert.throws(() => sanitizeQuestion('Can you email me at viewer@example.com about Pluto?'), (error) => error.code === 'PERSONAL_DATA');
  assert.throws(() => sanitizeQuestion(`What is Pluto? ${'x'.repeat(281)}`), (error) => error.code === 'QUESTION_LENGTH');
  assert.equal(sanitizeQuestion('What is a\nplanet?'), 'What is a planet?');
});

test('public card prose is plain bounded text, not a link or markup payload', () => {
  assert.equal(validatePublicText('A short title is okay', 'title', { min: 4, max: 90 }), 'A short title is okay');
  assert.throws(() => validatePublicText('<b>planet</b> is important', 'summary'), /plain text/);
  assert.throws(() => validatePublicText('See https://example.com for facts', 'summary'), /plain text/);
  assert.throws(() => validatePublicText('too short', 'summary', { min: 30 }), /30–420/);
});

test('sample evaluation set yields cited Pluto and distance drafts, and a fresh-count insufficiency', () => {
  const pluto = retrieveEvidence(sample('pluto-classification').question);
  assert.ok(pluto.draft);
  assert.deepEqual(pluto.evidence.map((item) => item.id).sort(), ['jpl-planet-definition', 'nasa-planet-definition'].sort());
  assert.match(pluto.draft.summary, /Pluto/);
  const distance = retrieveEvidence(sample('light-year-vs-au').question);
  assert.ok(distance.draft);
  assert.deepEqual(distance.evidence.map((item) => item.id), ['nasa-cosmic-distances']);
  const count = sample('changing-moon-count');
  assert.equal(classifyQuestion(count.question).state, 'insufficient-evidence');
  const changing = retrieveEvidence(count.question);
  assert.equal(changing.draft, null);
  assert.ok(changing.evidence.some((item) => item.id === 'nasa-moons-facts'));
});

test('labelled evaluation set exercises supported, nuanced, blocked, volatile and no-answer cases', async () => {
  const { cases } = JSON.parse(await readFile(new URL('../data/evaluation-cases.json', import.meta.url), 'utf8'));
  assert.equal(cases.length, 6);
  for (const item of cases) {
    const classification = classifyQuestion(item.question);
    const { evidence, draft } = retrieveEvidence(item.question);
    const state = classification.state === 'out-of-scope' ? 'out-of-scope' : classification.state === 'insufficient-evidence' || !evidence.length || !draft ? 'insufficient-evidence' : 'review-required';
    assert.equal(state, item.expectedState, item.id);
    for (const id of item.expectedEvidenceIds) assert.ok(evidence.some((source) => source.id === id), `${item.id}: missing ${id}`);
    if (item.id === 'classification-nuance') assert.match(draft.uncertainty, /continuing discussion/i);
  }
});

test('retrieval is deterministic, bounded, local, and does not accept source ids from the prompt', () => {
  const question = 'Why is Pluto called a dwarf planet?';
  const first = retrieveEvidence(question); const second = retrieveEvidence(question);
  assert.deepEqual(first, second);
  assert.equal(first.evidence.length, 2);
  assert.equal(first.modelProvider, null);
  assert.match(first.retrievalMethod, /local/);
  assert.ok(first.evidence.every((item) => SOURCES.some((source) => source.id === item.id && source.url === item.url)));
  assert.equal(scoreSource(question, SOURCES[0]), scoreSource(question, SOURCES[0]));
  assert.equal(retrieveEvidence('Name the best restaurant in Delft').draft, null);
});

test('out-of-scope topics fail closed with a specific policy class', () => {
  for (const [question, expected] of [
    ['Can you diagnose these symptoms and recommend a treatment?', 'medical-advice'],
    ['Can I sue my landlord, is that legal advice?', 'legal-advice'],
    ['Should I buy this stock as an investment?', 'financial-advice'],
    ['I may be in immediate danger, what should I do?', 'emergency-advice'],
    ['Who should I vote for in the election?', 'political-persuasion'],
    ['Where does that person live?', 'private-information'],
  ]) {
    assert.equal(classifyQuestion(question).state, 'out-of-scope', question);
    assert.equal(classifyQuestion(question).reasonCode, expected, question);
  }
  assert.equal(classifyQuestion('Will we find life on Mars next year?').state, 'insufficient-evidence');
});
