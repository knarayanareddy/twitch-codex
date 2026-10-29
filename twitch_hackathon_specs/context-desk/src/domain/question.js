import { SOURCE_PACK, SOURCES } from './source-pack.js';

export class QuestionError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'QuestionError'; this.code = code; this.status = status; }
}

export function sanitizeQuestion(input) {
  if (typeof input !== 'string') throw new QuestionError('INVALID_QUESTION', 'Enter a plain-language question.');
  const question = input.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  const length = [...question].length;
  if (length < 12 || length > 280) throw new QuestionError('QUESTION_LENGTH', 'Questions must be 12–280 characters.');
  if (/[<>]/.test(question)) throw new QuestionError('UNSAFE_MARKUP', 'HTML and markup are not accepted. Use plain text.');
  if (/\b(?:https?:\/\/|www\.)/i.test(question)) throw new QuestionError('LINK_NOT_ALLOWED', 'Links are not accepted in questions. Ask about the idea in plain text.');
  if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(question) || /\b(?:\+?\d[ .()-]*){9,}\b/.test(question)) {
    throw new QuestionError('PERSONAL_DATA', 'Please remove contact or identifying information and submit a general question instead.');
  }
  return question;
}

export function normalizeQuestion(question) {
  return question.normalize('NFKD').toLocaleLowerCase('en').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function questionTokens(question) {
  const stop = new Set(['a','an','and','are','as','at','be','by','does','do','for','from','how','i','in','is','it','of','on','or','the','this','to','what','when','where','which','who','why','with']);
  return normalizeQuestion(question).split(' ').filter((token) => token.length > 1 && !stop.has(token));
}

const BLOCKED = [
  ['medical-advice', /\b(diagnos(?:e|is)|treat(?:ment)?|medicat(?:ion|e)|dosage|symptom|therapy|is this cancer|should i take)\b/i],
  ['legal-advice', /\b(lawsuit|legal advice|is this legal|can i sue|criminal charge|attorney|lawyer)\b/i],
  ['financial-advice', /\b(should i buy|should i sell|stock tip|investment advice|crypto price|financial advice|tax advice)\b/i],
  ['emergency-advice', /\b(911|112|emergency|suicide|overdose|urgent help|immediate danger|bomb threat)\b/i],
  ['political-persuasion', /\b(who should i vote for|convince voters|political persuasion|campaign strategy)\b/i],
  ['personal-accusation', /\b(is .{1,70} (a criminal|a fraud|guilty of|abusing|stealing))\b/i],
  ['private-information', /\b(home address|phone number|private email|where does .{1,70} live|doxx(?:ing)?)\b/i],
  ['speculation', /\b(prove|guarantee)\b.{0,60}\b(aliens|life on mars|future|astrology|horoscope|destiny)\b/i],
];
const VOLATILE_MOON_COUNT = /\b(how many|exact number|current number|current count|latest count|right now|currently|today)\b/i;
const MOON_TOPIC = /\b(moon|moons|saturn|jupiter|uranus|neptune|pluto)\b/i;
const GENERIC_TOPIC_TERMS = new Set(['definition', 'year', 'system', 'unit', 'distance', 'distances', 'count', 'number', 'orbit', 'round', 'cleared', 'kilometres', 'kilometers', 'early', 'formation', 'wind', 'dust']);
const TOPIC_WORDS = new Set(SOURCES.flatMap((source) => source.keywords.flatMap((word) => normalizeQuestion(word).split(' '))).filter((word) => word && !GENERIC_TOPIC_TERMS.has(word)));

export function classifyQuestion(question) {
  for (const [code, pattern] of BLOCKED) {
    if (pattern.test(question)) return { state: 'out-of-scope', reasonCode: code, message: 'This question is outside Context Desk’s educational Solar System scope. No draft was created or published.' };
  }
  if (VOLATILE_MOON_COUNT.test(question) && MOON_TOPIC.test(question)) {
    return { state: 'insufficient-evidence', reasonCode: 'volatile-current-count', message: 'The source pack does not maintain a live, authoritative count. Counts change as objects are discovered and recognized; no number will be drafted.' };
  }
  const words = questionTokens(question);
  const topicMatches = words.filter((word) => TOPIC_WORDS.has(word));
  if (!topicMatches.length) {
    return { state: 'insufficient-evidence', reasonCode: 'outside-topic-pack', message: `Not enough evidence in the “${SOURCE_PACK.title}” source pack. No public card can be drafted.` };
  }
  return { state: 'queued', reasonCode: null, message: null };
}

export function validatePublicText(value, label, { min = 12, max = 420 } = {}) {
  if (typeof value !== 'string') throw new QuestionError('PUBLIC_TEXT_REQUIRED', `${label} is required.`, 422);
  const text = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[<>]/.test(text) || /\b(?:https?:\/\/|www\.)/i.test(text)) throw new QuestionError('PUBLIC_TEXT_UNSAFE', `${label} must be plain text without links or markup.`, 422);
  if ([...text].length < min || [...text].length > max) throw new QuestionError('PUBLIC_TEXT_LENGTH', `${label} must be ${min}–${max} characters.`, 422);
  return text;
}
