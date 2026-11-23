import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { BeanObservation, FieldSource, Recipe, Shot, TasteTag } from '../shared/types';
import { TASTE_TAG_LABELS } from '../shared/types';
import { checkStatedRatio, roastAgeDays } from '../shared/ratio';
import { ApiError } from './api';
import { dateShort, formatGrind, formatRatio, g, range, recipeLine, s, SOURCE_LABELS, temp } from './format';

// ---------------------------------------------------------------- data loading

export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await run());
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Loading() {
  return <div className="loading" role="status">Loading…</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as Error;
  const details = e instanceof ApiError ? e.details : undefined;
  return (
    <div className="error" role="alert">
      {e.message}
      {details?.length ? <ul>{details.map((d) => <li key={d.path}>{d.path}: {d.message}</li>)}</ul> : null}
    </div>
  );
}

export function Page({ title, back, actions, children }: { title: string; back?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="page">
      <header className="page-head">
        {back ? <Link to={back} className="back" aria-label="Back">‹</Link> : null}
        <h1>{title}</h1>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </main>
  );
}

// ---------------------------------------------------------------- inputs

export function Stepper({ label, value, onChange, step, min = 0, max = 999, unit, decimals = 1, allowEmpty = false }: {
  label: string; value: number | null; onChange: (v: number | null) => void; step: number; min?: number; max?: number;
  unit?: string; decimals?: number; allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => { setText(value == null ? '' : String(value)); }, [value]);
  const round = (n: number) => Number(n.toFixed(decimals));
  const bump = (dir: 1 | -1) => {
    const base = value ?? (dir > 0 ? min : min);
    onChange(Math.min(max, Math.max(min, round(base + dir * step))));
  };
  return (
    <label className="stepper">
      <span className="stepper-label">{label}</span>
      <span className="stepper-row">
        <button type="button" onClick={() => bump(-1)} aria-label={`Decrease ${label}`}>−</button>
        <input
          inputMode="decimal"
          value={text}
          placeholder="—"
          onChange={(e) => {
            const t = e.target.value.replace(',', '.');
            setText(t);
            if (t.trim() === '') { if (allowEmpty) onChange(null); return; }
            const n = Number(t);
            if (Number.isFinite(n)) onChange(n);
          }}
          aria-label={label}
        />
        <button type="button" onClick={() => bump(1)} aria-label={`Increase ${label}`}>+</button>
      </span>
      {unit ? <span className="stepper-unit">{unit}</span> : null}
    </label>
  );
}

export function Chips({ options, value, onChange }: { options: TasteTag[]; value: TasteTag[]; onChange: (v: TasteTag[]) => void }) {
  return (
    <div className="chips">
      {options.map((t) => {
        const on = value.includes(t);
        return (
          <button key={t} type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])}>
            {TASTE_TAG_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}

export function Stars({ value, onChange }: { value: number | null; onChange?: (v: number | null) => void }) {
  return (
    <span className={`stars${onChange ? ' editable' : ''}`} aria-label={value ? `${value} of 5` : 'Not rated'}>
      {[1, 2, 3, 4, 5].map((n) => onChange ? (
        <button key={n} type="button" className={n <= (value ?? 0) ? 'on' : ''} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange(value === n ? null : n)}>★</button>
      ) : (
        <span key={n} className={n <= (value ?? 0) ? 'on' : ''}>★</span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- display

export function SourceBadge({ source }: { source: FieldSource | undefined }) {
  if (!source) return null;
  return <span className={`badge src-${source}`}>{source === 'packaging' || source === 'user' ? '✓ ' : ''}{SOURCE_LABELS[source]}</span>;
}

export function TagList({ tags }: { tags: TasteTag[] }) {
  if (!tags.length) return null;
  return <span className="tags">{tags.map((t) => <span key={t} className={`tag tag-${t.replace(' ', '-')}`}>{TASTE_TAG_LABELS[t]}</span>)}</span>;
}

export function RecipeCard({ recipe, title = 'Current recipe', children }: { recipe: Recipe; title?: string; children?: ReactNode }) {
  const check = recipe.stated_ratio != null ? checkStatedRatio(recipe.dose_g, recipe.yield_g, recipe.stated_ratio) : null;
  return (
    <section className="card recipe-card">
      <div className="card-title">
        <h2>{title}</h2>
        <span className="muted">v{recipe.version} · {recipe.source} · {recipe.status}{recipe.promising ? ' · ★ promising' : ''}</span>
      </div>
      <div className="recipe-grid">
        <div><span className="k">Dose</span><span className="v">{g(recipe.dose_g)}</span></div>
        <div><span className="k">Yield</span><span className="v">{g(recipe.yield_g)}</span></div>
        <div><span className="k">Ratio</span><span className="v">{formatRatio(recipe.dose_g, recipe.yield_g)}</span></div>
        <div><span className="k">Temp</span><span className="v">{temp(recipe.temperature_c)}</span></div>
        <div><span className="k">Time</span><span className="v">{range(recipe.time_min_s, recipe.time_max_s, 's')}</span></div>
        <div><span className="k">Pre-inf.</span><span className="v">{range(recipe.preinfusion_min_s, recipe.preinfusion_max_s, 's')}</span></div>
        <div><span className="k">Grind</span><span className="v">{formatGrind(recipe.grind_setting, recipe.grind_inner)}</span></div>
      </div>
      {check && !check.consistent ? <p className="warn">⚠ {check.message}</p> : null}
      {recipe.rationale ? <p className="rationale">{recipe.rationale}</p> : null}
      {children ? <div className="card-actions">{children}</div> : null}
    </section>
  );
}

export function ShotRow({ shot, coffeeName, roastDate }: { shot: Shot; coffeeName?: string | null; roastDate?: string | null }) {
  const age = roastAgeDays(roastDate, shot.pulled_at);
  return (
    <Link to={`/shots/${shot.id}`} className="shot-row">
      <div className="shot-main">
        <span className="shot-nums">{g(shot.dose_g)} → {g(shot.yield_g)} · {formatRatio(shot.dose_g, shot.yield_g)} · {s(shot.time_s)}</span>
        <span className="muted small">
          {coffeeName ? `${coffeeName} · ` : ''}{dateShort(shot.pulled_at)}
          {shot.temperature_c != null ? ` · ${temp(shot.temperature_c)}` : ''}
          {shot.grind_setting != null ? ` · grind ${formatGrind(shot.grind_setting, shot.grind_inner)}` : ''}
          {age != null && age >= 0 ? ` · day ${age} off roast` : ''}
        </span>
        <TagList tags={shot.taste_tags} />
      </div>
      <Stars value={shot.score} />
    </Link>
  );
}

export function RecipeSummary({ recipe }: { recipe: Recipe }) {
  return <span className="recipe-line">{recipeLine(recipe)}</span>;
}

// ---------------------------------------------------------------- AI results

export function BeanObservationPanel({ obs }: { obs: BeanObservation }) {
  return (
    <div className="observation">
      <div className="obs-head">
        <strong>Visual observations</strong>
        <span className="badge src-visual">Estimated · {obs.confidence} confidence</span>
      </div>
      <dl className="facts">
        <div><dt>Roast (estimate)</dt><dd>{obs.roast_estimate_note || (obs.roast_estimate ?? '—')}</dd></div>
        <div><dt>Colour</dt><dd>{obs.colour_consistency}</dd></div>
        <div><dt>Surface</dt><dd>{obs.surface}{obs.oiliness ? ` (${obs.oiliness})` : ''}</dd></div>
        {obs.defects.length ? <div><dt>Defects</dt><dd>{obs.defects.join('; ')}</dd></div> : null}
        <div><dt>Overall</dt><dd>{obs.general}</dd></div>
      </dl>
      <p className="muted small">From the photo only. It can't tell origin, variety or processing.</p>
    </div>
  );
}

export function AiNote({ note }: { note?: string | null }) {
  return note ? <p className="note small">ℹ {note}</p> : null;
}

export function isBeanObservation(v: unknown): v is BeanObservation {
  return !!v && typeof v === 'object' && 'colour_consistency' in v && 'confidence' in v;
}
