import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { AiNote, BeanObservationPanel, ErrorBox, isBeanObservation, Loading, Page, RecipeCard, ShotRow, SourceBadge, useLoad } from '../components';
import { dateShort, formatGrind, formatRatio, g, roastAge, ROAST_LABELS, STATUS_LABELS, temp, trimNumber } from '../format';
import { changedVariables } from '../../shared/engine';
import type { CoffeeDetail, CoffeeStatus, ImageType, Recipe, SourcedField } from '../../shared/types';
import { resizeImage } from '../image';
import { DialInChart } from '../chart';

const FACTS: Array<[SourcedField, string]> = [
  ['brand', 'Brand / roaster'], ['product', 'Product'], ['origin_country', 'Origin'], ['region', 'Region'], ['farm', 'Farm / producer'],
  ['variety', 'Variety'], ['processing', 'Processing'], ['roast_level', 'Roast level'], ['roast_date', 'Roast date'],
  ['altitude', 'Altitude'], ['cupping_score', 'Cupping score'], ['intensity', 'Intensity'], ['tasting_notes', 'Tasting notes (bag)'],
];

function factValue(d: CoffeeDetail, f: SourcedField): string | null {
  const c = d.coffee;
  const v = c[f as keyof typeof c];
  if (v == null || (Array.isArray(v) && !v.length)) return null;
  if (f === 'roast_level') return `${c.field_sources.roast_level === 'visual' ? 'Estimated ' : ''}${ROAST_LABELS[c.roast_level!].toLowerCase()}`;
  if (f === 'tasting_notes') return c.tasting_notes.join(', ');
  return String(v);
}

function whatChanged(prev: Recipe | undefined, r: Recipe): string {
  if (!prev) return 'first recipe';
  const changed = changedVariables(prev, r);
  if (!changed.length) return prev.time_min_s !== r.time_min_s || prev.time_max_s !== r.time_max_s ? 'time window' : 'no change';
  return changed.map((v) => {
    if (v === 'yield') return `yield ${trimNumber(prev.yield_g)} → ${trimNumber(r.yield_g)} g`;
    if (v === 'temperature') return `temp ${prev.temperature_c ?? '—'} → ${r.temperature_c ?? '—'} °C`;
    if (v === 'grind') return `grind ${formatGrind(prev.grind_setting, prev.grind_inner)} → ${formatGrind(r.grind_setting, r.grind_inner)}`;
    if (v === 'dose') return `dose ${trimNumber(prev.dose_g)} → ${trimNumber(r.dose_g)} g`;
    return 'pre-infusion';
  }).join(', ');
}

export function CoffeeDetailPage() {
  const id = Number(useParams().id);
  const { data, error, loading, reload } = useLoad(() => api.coffee(id), [id]);
  const status = useLoad(() => api.status());
  const aiOn = Boolean(status.data?.ai_configured);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try { await fn(); await reload(); } catch (e) { setActionError(e); } finally { setBusy(false); }
  };
  const setStatus = (st: CoffeeStatus) => act(() => api.updateCoffee(id, { status: st }));
  const askBarista = async () => {
    setAiBusy('The barista is looking at this coffee…');
    setAiNote(null);
    await act(async () => { const r = await api.suggestRecipe(id, true); setAiNote(r.ai_note ?? null); });
    setAiBusy(null);
  };
  const describe = async (imageId: number) => {
    setAiBusy('Looking at the beans…');
    await act(() => api.describeBeans(imageId));
    setAiBusy(null);
  };
  const upload = (type: ImageType) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) void act(async () => { for (const f of files) await api.uploadImage(await resizeImage(f), type, id); });
  };

  if (loading && !data) return <Page title="Coffee" back="/coffees"><Loading /></Page>;
  if (!data) return <Page title="Coffee" back="/coffees"><ErrorBox error={error} /></Page>;
  const c = data.coffee;
  const recipe = data.current_recipe;
  const age = roastAge(data.roast_age_days);

  return (
    <Page title={c.name} back="/coffees" actions={<Link to={`/coffees/${id}/edit`} className="btn">Edit</Link>}>
      <div className="coffee-meta">
        <span className={`pill st-${c.status}`}>{STATUS_LABELS[c.status]}</span>
        {age ? <span className="muted small">{age}</span> : null}
        <span className="muted small">{data.shot_count} shot{data.shot_count === 1 ? '' : 's'}{data.avg_score != null ? ` · avg ${data.avg_score}/5` : ''}</span>
        {c.remaining_g != null ? (
          <span className={`small ${c.remaining_g < (recipe?.dose_g ?? 20) * 2 ? 'warn' : 'muted'}`}>
            {trimNumber(c.remaining_g)} g left (~{Math.floor(c.remaining_g / (recipe?.dose_g ?? 20))} shots)
          </span>
        ) : null}
      </div>

      <div className="row">
        <Link to={`/coffees/${id}/shot`} className="btn primary grow">Log shot</Link>
        {c.status !== 'active' ? <button className="btn" disabled={busy} onClick={() => setStatus('active')}>Mark as in use</button> : null}
      </div>
      <ErrorBox error={actionError} />
      {aiBusy ? <p className="thinking">{aiBusy} (10–30 seconds)</p> : null}
      <AiNote note={aiNote} />

      {recipe ? (
        <RecipeCard recipe={recipe}>
          {recipe.status === 'suggested' && recipe.temperature_c != null
            ? <button className="btn primary" disabled={busy} onClick={() => act(() => api.activateRecipe(recipe.id))}>Use this recipe</button> : null}
          <button className="btn" disabled={busy} onClick={() => act(() => api.suggestRecipe(id))}>Suggest new</button>
          <Link className="btn" to={`/coffees/${id}/recipe?from=${recipe.id}`}>Adjust</Link>
          {aiOn ? <button className="btn" disabled={busy} onClick={askBarista}>✨ Ask the barista</button> : null}
        </RecipeCard>
      ) : (
        <section className="card">
          <h2>No recipe yet</h2>
          <p className="muted small">Get a starting recipe for your Dual Boiler based on what's known about this coffee.</p>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => act(() => api.suggestRecipe(id))}>Get starting recipe</button>
            <Link className="btn" to={`/coffees/${id}/recipe`}>Enter one</Link>
          </div>
        </section>
      )}

      {data.best_shot ? (
        <section className="card">
          <h2>Best shot so far</h2>
          <ShotRow shot={data.best_shot} roastDate={c.roast_date} />
        </section>
      ) : null}

      <section className="card">
        <h2>About this coffee</h2>
        <dl className="facts">
          {FACTS.map(([f, label]) => {
            const v = factValue(data, f);
            return (
              <div key={f} className={v ? '' : 'unknown'}>
                <dt>{label}</dt>
                <dd>{v ?? 'Unknown'} {v ? <SourceBadge source={c.field_sources[f]} /> : null}</dd>
              </div>
            );
          })}
        </dl>
        {c.notes ? <p className="notes">{c.notes}</p> : null}
      </section>

      <section className="card">
        <h2>Photos</h2>
        {data.images.length ? (
          <div className="photos">
            {data.images.map((img) => (
              <figure key={img.id}>
                <a href={img.url} target="_blank" rel="noreferrer"><img src={img.url} alt={`${img.image_type} photo`} loading="lazy" /></a>
                <figcaption>{img.image_type}</figcaption>
                {aiOn && img.image_type === 'beans' && !isBeanObservation(img.ai_observations)
                  ? <button className="btn small" disabled={busy} onClick={() => describe(img.id)}>✨ Describe</button> : null}
                <button className="photo-del" aria-label={`Delete ${img.image_type} photo`} disabled={busy}
                  onClick={() => { if (window.confirm('Delete this photo?')) void act(() => api.deleteImage(img.id)); }}>×</button>
              </figure>
            ))}
          </div>
        ) : <p className="muted small">No photos yet.</p>}
        {data.images.filter((img) => isBeanObservation(img.ai_observations)).map((img) => (
          <BeanObservationPanel key={img.id} obs={img.ai_observations as never} />
        ))}
        <div className="row">
          <label className="btn">＋ Bag photo<input type="file" accept="image/*" capture="environment" hidden onChange={upload('packaging')} /></label>
          <label className="btn">＋ Beans photo<input type="file" accept="image/*" capture="environment" hidden onChange={upload('beans')} /></label>
        </div>
      </section>

      <section className="card">
        <h2>Shot history</h2>
        <DialInChart shots={data.shots} recipes={data.recipes} />
        {data.shots.length ? data.shots.map((s) => <ShotRow key={s.id} shot={s} roastDate={c.roast_date} />) : <p className="muted small">No shots logged yet.</p>}
      </section>

      {data.recipes.length ? (
        <section className="card">
          <h2>Recipe history</h2>
          <ol className="timeline">
            {[...data.recipes].reverse().map((r) => {
              const prev = data.recipes.find((x) => x.version === r.version - 1);
              const st = data.stats.recipes.find((x) => x.recipe_id === r.id);
              return (
                <li key={r.id} className={`tl-${r.status}`}>
                  <div><strong>v{r.version}</strong> <span className="muted small">{dateShort(r.created_at)} · {r.source} · {r.status}{r.promising ? ' · ★' : ''}</span></div>
                  <div className="small">{g(r.dose_g)} → {g(r.yield_g)} · {formatRatio(r.dose_g, r.yield_g)} · {temp(r.temperature_c)} · grind {formatGrind(r.grind_setting, r.grind_inner)}</div>
                  <div className="muted small">Changed: {whatChanged(prev, r)}</div>
                  {st && st.shots ? (
                    <div className="small actual">
                      Actual: {st.shots} shot{st.shots === 1 ? '' : 's'}, avg {trimNumber(st.avg_time!)} s
                      {st.on_target != null ? ` (${Math.round(st.on_target * 100)}% in window)` : ''}
                      {st.avg_score != null ? ` · ${st.avg_score}/5` : ''}
                      {data.stats.most_successful_recipe?.recipe_id === r.id && data.stats.recipes.filter((x) => x.avg_score != null).length > 1 ? ' · 🏆 best so far' : ''}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      <div className="row status-actions">
        {c.status === 'active' ? <button className="btn" disabled={busy} onClick={() => setStatus('finished')}>Bag finished</button> : null}
        {c.status !== 'archived' ? <button className="btn ghost" disabled={busy} onClick={() => setStatus('archived')}>Archive</button> : null}
      </div>
    </Page>
  );
}
