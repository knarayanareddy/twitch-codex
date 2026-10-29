import { SOURCES, contentHash } from '../domain/source-pack.js';
import { questionTokens } from '../domain/question.js';

const tokenSet = (keywords) => new Set(keywords.flatMap((word) => word.toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((token) => token.length > 1)));
const TOKENS = new Map(SOURCES.map((source) => [source.id, tokenSet(source.keywords)]));

export function scoreSource(question, source) {
  const query = questionTokens(question);
  if (!query.length) return 0;
  const keywords = TOKENS.get(source.id) ?? tokenSet(source.keywords ?? []);
  let score = 0;
  for (const token of new Set(query)) if (keywords.has(token)) score += token.length >= 6 ? 1.5 : 1;
  return score;
}

function templateFor(question, evidence) {
  const normalized = question.toLocaleLowerCase('en');
  const ids = new Set(evidence.map((item) => item.id));
  if (ids.has('nasa-planet-definition') && /planet|pluto|dwarf/.test(normalized)) {
    return {
      publicQuestion: 'How do astronomers define a planet?',
      bullets: ['A planet orbits the Sun and is nearly round.', 'It must also clear its orbital neighbourhood.', 'Pluto meets the first two criteria, but not the third under this definition.'],
      title: 'How astronomers define a planet',
      summary: 'Under the International Astronomical Union’s 2006 Solar System definition, a planet orbits the Sun, is nearly round under its own gravity, and has cleared its orbital neighbourhood. Pluto meets the first two criteria but not the third, so it is classified as a dwarf planet under that definition.',
      uncertainty: 'This summarizes one formal classification. The source notes continuing discussion about terminology; it is not a universal statement about every planetary system.',
    };
  }
  if (ids.has('nasa-cosmic-distances') && /\bau\b|astronomical|light.?year|distance/.test(normalized)) {
    return {
      publicQuestion: 'How do an astronomical unit and a light-year differ?',
      bullets: ['One astronomical unit is about the Earth–Sun distance.', 'A light-year is the distance light travels in a year.', 'Despite its name, a light-year measures distance, not time.'],
      title: 'Two useful scales for cosmic distance',
      summary: 'An astronomical unit (AU) is approximately the Earth–Sun distance and is useful within our Solar System. A light-year is the distance light travels in one year, so it is a distance—not a duration—and is more practical for distances between stars.',
      uncertainty: 'The pack rounds the Earth–Sun distance to about 150 million kilometres and the light-year to about 9 trillion kilometres; consult NASA for exact conventions.',
    };
  }
  if (ids.has('nasa-comet-facts') && /comet|coma|tail|ice/.test(normalized)) {
    return {
      publicQuestion: 'Why can a comet grow a tail near the Sun?',
      bullets: ['Comets contain ice and dust.', 'Near the Sun, warming releases gas and dust around the comet.', 'Sunlight and solar wind help shape the coma and tail.'],
      title: 'Why a comet can grow a visible tail',
      summary: 'Comets contain ice and dust. As one approaches the Sun, warming ice releases gas and dust; the resulting coma and tail are shaped in part by sunlight and the solar wind.',
      uncertainty: 'This is a general description, not a statement about a specific comet, its orbit, or any impact risk.',
    };
  }
  if (ids.has('nasa-solar-system-facts') && /solar system|sun|asteroid/.test(normalized)) {
    return {
      publicQuestion: 'What kinds of objects are part of the Solar System?',
      bullets: ['The Sun and objects held by its gravity make up the Solar System.', 'It includes planets, dwarf planets, moons, asteroids, and comets.', 'The eight familiar planets are not the system’s only objects.'],
      title: 'The Solar System extends beyond the planets',
      summary: 'The Solar System includes the Sun and gravitationally bound objects such as planets, dwarf planets, moons, asteroids, and comets. Its familiar planets are not the full extent of the system.',
      uncertainty: 'The pack does not provide a live catalogue or current object count.',
    };
  }
  return null;
}

export function retrieveEvidence(question, { limit = 2, minScore = 2 } = {}) {
  const ranked = SOURCES.map((source) => ({ source, score: scoreSource(question, source) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
    .slice(0, limit);
  const evidence = ranked.map(({ source, score }) => ({
    id: source.id,
    sourceTitle: source.sourceTitle,
    publisher: source.publisher,
    url: source.url,
    publishedAt: source.publishedAt,
    checkedAt: source.checkedAt,
    excerpt: source.excerpt,
    retrievalMethod: 'local lexical v1 · no external fetch or model',
    contentHash: contentHash(source.excerpt),
    licenseUsageNote: source.licenseUsageNote,
    sourcePackVersion: source.sourcePackVersion,
    relevance: Math.min(100, Math.round(score / 6 * 100)),
  }));
  const draft = evidence.length ? templateFor(question, evidence) : null;
  return { evidence, draft, retrievalMethod: 'local lexical v1', modelProvider: null };
}
