import { describe, expect, it } from 'vitest';
import { checkStatedRatio, formatRatio, roastAgeDays, yieldForRatio } from '../../src/shared/ratio';
import { parseShotText } from '../../src/shared/parseShot';

describe('ratio (rule R1)', () => {
  it('formats as 1:X', () => {
    expect(formatRatio(20, 40)).toBe('1:2');
    expect(formatRatio(20, 45)).toBe('1:2.25');
    expect(formatRatio(19.7, 39.5)).toBe('1:2.01');
    expect(formatRatio(0, 40)).toBe('—');
  });
  it('computes yield for a ratio, rounded to 0.5 g', () => {
    expect(yieldForRatio(20, 2.25)).toBe(45);
    expect(yieldForRatio(20, 2.1)).toBe(42);
    expect(yieldForRatio(18.5, 2)).toBe(37);
  });
});

describe('stated ratio check (rule R2)', () => {
  it('flags the Ethiopia Karamo packaging inconsistency', () => {
    const r = checkStatedRatio(20, 40, 2.25);
    expect(r.consistent).toBe(false);
    expect(r.yieldForStated).toBe(45);
    expect(r.message).toBe('Stated ratio 1:2.25 does not match 20 g → 40 g, which is 1:2. A true 1:2.25 would be 45 g.');
  });
  it('accepts consistent recipes within 0.5 g', () => {
    expect(checkStatedRatio(20, 45, 2.25).consistent).toBe(true);
    expect(checkStatedRatio(18, 36.4, 2).consistent).toBe(true);
    expect(checkStatedRatio(20, 40, null).consistent).toBe(true);
  });
});

describe('roast age', () => {
  it('counts whole days, null when unknown', () => {
    expect(roastAgeDays('2026-11-01', new Date('2026-11-15T09:00:00'))).toBe(14);
    expect(roastAgeDays(null)).toBeNull();
  });
});

describe('quick shot text (spec §10)', () => {
  it('handover example 1', () => {
    expect(parseShotText('20 g in, 40 g out, 24 seconds, 93°C. Tastes a little sour.')).toEqual({
      dose_g: 20, yield_g: 40, time_s: 24, temperature_c: 93, taste_tags: ['sour'],
    });
  });
  it('compact form with grind, pre-infusion and flavours', () => {
    expect(parseShotText('20 in 42 out 29s grind 12 pi 6s — much sweeter, good chocolate')).toEqual({
      dose_g: 20, yield_g: 42, time_s: 29, preinfusion_s: 6, grind_setting: 12, taste_tags: ['sweet', 'chocolate'],
    });
  });
  it('inner burr and arrow notation', () => {
    const p = parseShotText('18.5g → 40g in 31 sec, grind 14 inner 5, bitter');
    expect(p).toMatchObject({ dose_g: 18.5, yield_g: 40, time_s: 31, grind_setting: 14, grind_inner: 5, taste_tags: ['bitter'] });
  });
  it('ignores negated tastes', () => {
    expect(parseShotText('20 in 40 out 30s, not bitter, no sourness, balanced').taste_tags).toEqual(['balanced']);
  });
  it('maps "too acidic" without also tagging sour', () => {
    expect(parseShotText('good but too acidic, a bit sharp').taste_tags).toContain('too acidic');
    expect(parseShotText('good but too acidic, a bit sharp').taste_tags).not.toContain('sour');
  });
});
