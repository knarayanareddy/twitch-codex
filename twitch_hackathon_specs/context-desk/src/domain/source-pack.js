import { createHash } from 'node:crypto';

export class SourcePackError extends Error {
  constructor(message) { super(message); this.name = 'SourcePackError'; this.code = 'INVALID_SOURCE_PACK'; }
}

const SAFE_HOSTS = new Set(['science.nasa.gov', 'ssd.jpl.nasa.gov']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireCondition(condition, message) {
  if (!condition) throw new SourcePackError(message);
}

export function contentHash(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function validateSourcePack(pack) {
  requireCondition(pack && pack.schemaVersion === 1, 'Unsupported topic-pack schema.');
  requireCondition(/^\d+\.\d+\.\d+$/.test(pack.version ?? ''), 'Topic pack requires a semantic version.');
  requireCondition(typeof pack.id === 'string' && /^[a-z0-9-]{3,80}$/.test(pack.id), 'Topic pack ID is invalid.');
  requireCondition(typeof pack.title === 'string' && pack.title.trim() && typeof pack.scope === 'string' && pack.scope.trim(), 'Topic pack title and scope are required.');
  requireCondition(pack.policy?.modelProvider === 'none', 'This build only supports the deterministic no-model mode.');
  requireCondition(pack.policy?.retentionHours === 24, 'The current privacy policy requires a fixed 24-hour retention window.');
  requireCondition(Array.isArray(pack.sources) && pack.sources.length >= 5 && pack.sources.length <= 10, 'Topic pack must contain five to ten sources.');
  const ids = new Set();
  for (const source of pack.sources) {
    requireCondition(typeof source.id === 'string' && !ids.has(source.id), 'Source IDs must be unique.');
    ids.add(source.id);
    requireCondition(typeof source.sourceTitle === 'string' && source.sourceTitle.trim(), `Source ${source.id} needs a title.`);
    requireCondition(typeof source.publisher === 'string' && source.publisher.trim(), `Source ${source.id} needs a publisher.`);
    requireCondition(typeof source.excerpt === 'string' && source.excerpt.trim() && source.excerpt.length <= 1_600, `Source ${source.id} needs a bounded team-authored excerpt.`);
    requireCondition(source.sourcePackVersion === pack.version && typeof source.licenseUsageNote === 'string' && source.licenseUsageNote.trim(), `Source ${source.id} needs pack version and usage notes.`);
    requireCondition(DATE.test(source.checkedAt ?? ''), `Source ${source.id} needs a checked date.`);
    let url;
    try { url = new URL(source.url); } catch { throw new SourcePackError(`Source ${source.id} has an invalid URL.`); }
    requireCondition(url.protocol === 'https:' && SAFE_HOSTS.has(url.hostname) && !url.username && !url.password, `Source ${source.id} must use an approved HTTPS host.`);
    requireCondition(/^[a-f0-9]{64}$/.test(source.contentHash ?? '') && contentHash(source.excerpt) === source.contentHash, `Source ${source.id} content hash does not match its curated excerpt.`);
    requireCondition(Array.isArray(source.keywords) && source.keywords.length >= 3 && source.keywords.every((word) => typeof word === 'string' && word.trim()), `Source ${source.id} requires retrieval keywords.`);
  }
  requireCondition(Array.isArray(pack.publicPromptTemplates) && pack.publicPromptTemplates.length >= 3 && pack.publicPromptTemplates.length <= 6, 'Topic pack requires three to six safe viewer-poll question templates.');
  const promptIds = new Set();
  for (const prompt of pack.publicPromptTemplates) {
    requireCondition(typeof prompt.id === 'string' && /^[a-z0-9-]{3,60}$/.test(prompt.id) && !promptIds.has(prompt.id), 'Viewer-poll prompt IDs must be unique and safe.');
    promptIds.add(prompt.id);
    requireCondition(typeof prompt.question === 'string' && prompt.question.length >= 12 && prompt.question.length <= 160 && !/[<>]/.test(prompt.question) && !/\b(?:https?:\/\/|www\.)/i.test(prompt.question), `Viewer-poll prompt ${prompt.id} must be bounded plain text.`);
  }
  requireCondition(Array.isArray(pack.samples) && pack.samples.length === 3, 'Topic pack must contain exactly three reviewable sample questions.');
  const sampleIds = new Set();
  for (const sample of pack.samples) {
    requireCondition(typeof sample.id === 'string' && !sampleIds.has(sample.id), 'Sample question IDs must be unique.');
    sampleIds.add(sample.id);
    requireCondition(typeof sample.question === 'string' && sample.question.length >= 10 && sample.question.length <= 280, `Sample ${sample.id} has invalid question text.`);
    requireCondition(['review-required', 'insufficient-evidence'].includes(sample.expectedState), `Sample ${sample.id} has invalid expected state.`);
    requireCondition(Array.isArray(sample.expectedEvidenceIds) && sample.expectedEvidenceIds.every((id) => ids.has(id)), `Sample ${sample.id} cites an unknown source.`);
  }
  return true;
}

const CONTENT = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../data/topic-pack.json', import.meta.url), 'utf8'));
validateSourcePack(CONTENT);

export const SOURCE_PACK = Object.freeze(CONTENT);
export const SOURCES = Object.freeze(CONTENT.sources);
export const SAMPLES = Object.freeze(CONTENT.samples);
export const PUBLIC_PROMPT_TEMPLATES = Object.freeze(CONTENT.publicPromptTemplates);
export const getSource = (id) => SOURCES.find((source) => source.id === id) ?? null;
