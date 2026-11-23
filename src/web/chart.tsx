import { useMemo, useState } from 'react';
import type { Recipe, Shot } from '../shared/types';
import { TASTE_TAG_LABELS } from '../shared/types';
import { dateShort, formatGrind, formatRatio, trimNumber } from './format';

/**
 * Dial-in chart: extraction time of each shot (oldest → newest) against the target
 * window of the recipe it aimed for. One series, so no legend — the title names it.
 * Tap or hover a dot for the details; the shot list below is the table view.
 */
export function DialInChart({ shots, recipes }: { shots: Shot[]; recipes: Recipe[] }) {
  const [active, setActive] = useState<number | null>(null);
  const data = useMemo(() => [...shots].sort((a, b) => a.pulled_at.localeCompare(b.pulled_at) || a.id - b.id), [shots]);
  if (data.length < 2) return null;

  const W = 340, H = 170, padL = 30, padR = 30, padT = 12, padB = 26;
  const recipeOf = (s: Shot) => recipes.find((r) => r.id === s.recipe_id) ?? null;
  const values = data.flatMap((s) => { const r = recipeOf(s); return r ? [s.time_s, r.time_min_s, r.time_max_s] : [s.time_s]; });
  const lo = Math.floor((Math.min(...values) - 2) / 5) * 5;
  const hi = Math.ceil((Math.max(...values) + 2) / 5) * 5;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += hi - lo > 30 ? 10 : 5) ticks.push(t);
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, data.length - 1);
  const y = (v: number) => padT + ((hi - v) * (H - padT - padB)) / Math.max(1, hi - lo);
  const step = (W - padL - padR) / Math.max(1, data.length - 1);

  // Target-window bands, one per run of consecutive shots on the same recipe.
  const bands: Array<{ x0: number; x1: number; r: Recipe }> = [];
  data.forEach((s, i) => {
    const r = recipeOf(s);
    if (!r) return;
    const last = bands.at(-1);
    if (last && last.r.id === r.id && last.x1 >= x(i) - step) last.x1 = x(i) + step / 2;
    else bands.push({ x0: x(i) - step / 2, x1: x(i) + step / 2, r });
  });

  const line = data.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.time_s).toFixed(1)}`).join(' ');
  const sel = active != null ? data[active] : null;
  const last = data.length - 1;

  return (
    <figure className="chart">
      <figcaption>
        <strong>Shot time</strong>
        <span className="muted small"> · seconds per shot, shaded = the recipe's target window</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Shot times for ${data.length} shots, from ${trimNumber(data[0].time_s)} s to ${trimNumber(data[last].time_s)} s`}
        onMouseLeave={() => setActive(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 6} y={y(t) + 3.5} className="tick" textAnchor="end">{t}</text>
          </g>
        ))}
        {bands.map((b, i) => (
          <rect key={i} x={Math.max(padL, b.x0)} width={Math.min(W - padR, b.x1) - Math.max(padL, b.x0)}
            y={y(b.r.time_max_s)} height={Math.max(1, y(b.r.time_min_s) - y(b.r.time_max_s))} className="band" />
        ))}
        <path d={line} className="series-line" />
        {data.map((s, i) => (
          <g key={s.id} onMouseEnter={() => setActive(i)} onClick={() => setActive(active === i ? null : i)} className="dot-hit">
            <circle cx={x(i)} cy={y(s.time_s)} r={14} className="hit" />
            <circle cx={x(i)} cy={y(s.time_s)} r={active === i ? 6 : 4.5} className="dot" />
          </g>
        ))}
        <text x={x(last) + 8} y={y(data[last].time_s) + 4} className="end-label">{trimNumber(data[last].time_s)}s</text>
        <text x={padL} y={H - 6} className="tick">{dateShort(data[0].pulled_at)}</text>
        <text x={W - padR} y={H - 6} className="tick" textAnchor="end">{dateShort(data[last].pulled_at)}</text>
      </svg>
      <div className="chart-tip" aria-live="polite">
        {sel ? (
          <>
            <strong>{dateShort(sel.pulled_at)} · {trimNumber(sel.time_s)} s</strong>{' '}
            {trimNumber(sel.dose_g)} → {trimNumber(sel.yield_g)} g ({formatRatio(sel.dose_g, sel.yield_g)})
            {sel.grind_setting != null ? ` · grind ${formatGrind(sel.grind_setting, sel.grind_inner)}` : ''}
            {sel.score != null ? ` · ${sel.score}/5` : ''}
            {sel.taste_tags.length ? ` · ${sel.taste_tags.map((t) => TASTE_TAG_LABELS[t]).join(', ')}` : ''}
          </>
        ) : <span className="muted">Tap a dot for details.</span>}
      </div>
    </figure>
  );
}
