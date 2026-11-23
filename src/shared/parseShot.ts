// Parses a quick free-text shot description, e.g.
//   "20 g in, 40 g out, 24 seconds, 93°C. Tastes a little sour."
//   "20 in 42 out 29s grind 12 pi 6s — much sweeter, good chocolate"
// Deterministic, so quick logging works without the AI.

import type { TasteTag } from './types';

export interface ParsedShotText {
  dose_g?: number;
  yield_g?: number;
  time_s?: number;
  temperature_c?: number;
  preinfusion_s?: number;
  grind_setting?: number;
  grind_inner?: number;
  taste_tags: TasteTag[];
}

const NUM = '(\\d+(?:[.,]\\d+)?)';
const num = (s: string) => Number(s.replace(',', '.'));

const TAG_PATTERNS: Array<[TasteTag, RegExp]> = [
  ['channeling', /\b(channel(l)?ing|spurt|spray|squirt)/],
  ['too acidic', /\b(too (acidic|bright)|acidity (is )?(a bit )?(high|forward|strong))/],
  ['sour', /\b(sour|sharp|tart|under.?extract)/],
  ['bitter', /\b(bitter|burnt|ashy|harsh|over.?extract)/],
  ['astringent', /\b(astringent|dry(ing)?\b|chalky)/],
  ['thin', /\b(thin|watery|weak)/],
  ['heavy', /\b(heavy|too intense|too strong)/],
  ['sweet', /\b(sweet|sweeter)/],
  ['balanced', /\b(balanced|great|excellent|perfect|delicious)/],
  ['chocolate', /\b(choc|cocoa)/],
  ['fruity', /\b(fruit|berry|citrus|apple|orange|cherry)/],
  ['nutty', /\b(nut|hazelnut|almond)/],
  ['caramel', /\b(caramel|toffee|molasses)/],
];

export function parseShotText(input: string): ParsedShotText {
  const text = input.toLowerCase().replace(/→|->/g, ' to ');
  const out: ParsedShotText = { taste_tags: [] };

  // "20g to 40g" / "20 g → 40 g" wins over "in"/"out" words ("40g in 31 sec" means time, not dose).
  const pair = text.match(new RegExp(`${NUM}\\s*g?\\s*(?:to|:)\\s*${NUM}\\s*g`));
  if (pair) {
    out.dose_g = num(pair[1]);
    out.yield_g = num(pair[2]);
  } else {
    const dose = text.match(new RegExp(`${NUM}\\s*g?\\s*(?:in|dose)\\b`)) ?? text.match(new RegExp(`dose\\s*:?\\s*${NUM}`));
    if (dose) out.dose_g = num(dose[1]);
    const yld = text.match(new RegExp(`${NUM}\\s*g?\\s*(?:out|yield)\\b`)) ?? text.match(new RegExp(`yield\\s*:?\\s*${NUM}`));
    if (yld) out.yield_g = num(yld[1]);
  }

  const pi = text.match(new RegExp(`(?:pre-?infusion|pi)\\s*:?\\s*${NUM}\\s*(?:s|sec|seconds?)?`));
  if (pi) out.preinfusion_s = num(pi[1]);

  // Time: a number followed by s/sec/seconds that isn't the pre-infusion figure.
  const textNoPi = pi ? text.replace(pi[0], ' ') : text;
  const time = textNoPi.match(new RegExp(`${NUM}\\s*(?:s|sec|secs|seconds?)\\b`));
  if (time) out.time_s = num(time[1]);

  const temp = text.match(new RegExp(`${NUM}\\s*(?:°\\s*c?|º\\s*c?|degrees?|c\\b)`));
  if (temp) out.temperature_c = num(temp[1]);

  // "grind 12", "grind 12 inner 5", "grind 12/5", "setting: 14"
  const grind = text.match(/(?:grind|grinder|setting)\s*(?:setting|at|on)?\s*:?\s*(\d+(?:[.,]\d+)?)(?:\s*(?:\/|inner|burr)\s*(?:burr\s*)?(\d+))?/);
  if (grind) {
    out.grind_setting = num(grind[1]);
    if (grind[2]) out.grind_inner = num(grind[2]);
  }

  // Taste words. "not sour" / "no bitterness" are negated.
  for (const [tag, re] of TAG_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const before = text.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    if (/\b(not|no|without|less|never)\s+(too\s+|very\s+|at all\s+)?$/.test(before)) continue;
    if (tag === 'sour' && out.taste_tags.includes('too acidic')) continue;
    out.taste_tags.push(tag);
  }
  // "much sweeter, good chocolate flavour" → sweet+chocolate; "good" alone isn't a tag.
  return out;
}
