import type { MoveMeta } from './contract';

const STEP_TWO: Record<string, string> = {
  ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', abli: 'able', alli: 'al',
  entli: 'ent', eli: 'e', ousli: 'ous', ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al',
  iveness: 'ive', fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log',
};
const STEP_THREE: Record<string, string> = {
  icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '',
};

function vowels(word: string): boolean[] {
  const result: boolean[] = [];
  for (const letter of word) {
    result.push('aeiou'.includes(letter) || (letter === 'y' && result.length > 0 && !result.at(-1)));
  }
  return result;
}
const measure = (word: string) => vowels(word).filter((vowel, i, list) => vowel && list[i + 1] === false).length;
const hasVowel = (word: string) => vowels(word).some(Boolean);
function endsCvc(word: string): boolean {
  const end = vowels(word).slice(-3);
  return end[0] === false && end[1] === true && end[2] === false && !/[wxy]$/.test(word);
}

function replaceSuffix(word: string, replacements: Record<string, string>): string {
  const suffix = Object.keys(replacements).find((ending) => word.endsWith(ending));
  if (!suffix) return word;
  const stem = word.slice(0, -suffix.length);
  return measure(stem) > 0 ? stem + replacements[suffix] : word;
}

/** The Porter steps reduce English terms to a common stem. Leave other scripts intact. */
export function porterStem(word: string): string {
  if (!/^[a-z]{3,}$/.test(word)) return word;
  word = word.replace(/sses$/, 'ss').replace(/ies$/, 'i');
  if (!word.endsWith('ss')) word = word.replace(/s$/, '');

  if (word.endsWith('eed')) {
    if (measure(word.slice(0, -3)) > 0) word = word.slice(0, -1);
  } else {
    const stem = word.replace(/(ed|ing)$/, '');
    if (stem !== word && hasVowel(stem)) {
      word = stem;
      if (/(at|bl|iz)$/.test(word)) word += 'e';
      else if (/([^aeiou])\1$/.test(word) && !/[lsz]$/.test(word)) word = word.slice(0, -1);
      else if (measure(word) === 1 && endsCvc(word)) word += 'e';
    }
  }
  if (word.endsWith('y') && hasVowel(word.slice(0, -1))) word = word.slice(0, -1) + 'i';
  word = replaceSuffix(replaceSuffix(word, STEP_TWO), STEP_THREE);

  const stepFour = word.match(/(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ion|ou|ism|ate|iti|ous|ive|ize)$/)?.[0];
  if (stepFour) {
    const stem = word.slice(0, -stepFour.length);
    if (measure(stem) > 1 && (stepFour !== 'ion' || /[st]$/.test(stem))) word = stem;
  }
  if (word.endsWith('e')) {
    const stem = word.slice(0, -1);
    const m = measure(stem);
    if (m > 1 || (m === 1 && !endsCvc(stem))) word = stem;
  }
  if (word.endsWith('ll') && measure(word) > 1) word = word.slice(0, -1);
  return word;
}

const terms = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(porterStem);

function termCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of tokens) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

export const MAX_CATALOGUE_RESULTS = 8;
const WEIGHTS = [3, 2, 1] as const;
const K = 1.2;
const B = 0.75;

/** Field-weighted BM25 over the current registry. */
export function searchCatalogue(moves: readonly MoveMeta[], query: string, limit = MAX_CATALOGUE_RESULTS) {
  const queryTerms = [...new Set(terms(query))];
  if (!queryTerms.length || !moves.length) return [];
  const docs = moves.map((meta) => ({
    meta,
    fields: [meta.say.join(' '), meta.oneLiner, meta.tags.join(' ')].map((text) => {
      const tokens = terms(text);
      return { length: tokens.length, counts: termCounts(tokens) };
    }),
  }));
  const lengths = WEIGHTS.map((_, i) => docs.reduce((sum, doc) => sum + (doc.fields[i]?.length ?? 0), 0) / docs.length);
  const idf = queryTerms.map((term) => {
    const n = docs.filter(({ fields }) => fields.some(({ counts }) => counts.has(term))).length;
    return { term, value: Math.log1p((docs.length - n + 0.5) / (n + 0.5)) };
  });
  return docs.map(({ meta, fields }) => {
    const score = fields.reduce((sum, { length, counts }, i) => {
      const average = lengths[i] || 1;
      const norm = K * (1 - B + B * length / average);
      const score = idf.reduce((value, { term, value: weight }) => {
        const tf = counts.get(term) ?? 0;
        return value + weight * tf * (K + 1) / (tf + norm);
      }, 0);
      return sum + score * (WEIGHTS[i] ?? 0);
    }, 0);
    return { id: meta.id, category: meta.category, say: meta.say, score };
  })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : Number(a.id !== b.id)))
    .slice(0, Math.min(limit, MAX_CATALOGUE_RESULTS));
}
