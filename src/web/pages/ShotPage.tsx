import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { AiNote, Chips, ErrorBox, Loading, Page, Stars, Stepper, TagList, useLoad } from '../components';
import { dateTime, formatGrind, formatRatio, g, range, s, temp } from '../format';
import { changedVariables } from '../../shared/engine';
import { BALANCE_TAGS, FLAVOUR_TAGS, type Advice, type RecipeParams, type TasteTag } from '../../shared/types';

function NextParams({ advice, from }: { advice: Advice; from: RecipeParams | null }) {
  const n = advice.next;
  const changed = new Set(from ? changedVariables(from, n) : []);
  const row = (key: string, label: string, value: string) => (
    <div className={changed.has(key as never) ? 'changed' : ''}><span className="k">{label}</span><span className="v">{value}</span></div>
  );
  return (
    <div className="recipe-grid">
      {row('dose', 'Dose', g(n.dose_g))}
      {row('yield', 'Yield', g(n.yield_g))}
      <div className={changed.has('yield') || changed.has('dose') ? 'changed' : ''}><span className="k">Ratio</span><span className="v">{formatRatio(n.dose_g, n.yield_g)}</span></div>
      {row('temperature', 'Temp', temp(n.temperature_c))}
      <div><span className="k">Time</span><span className="v">{range(n.time_min_s, n.time_max_s, 's')}</span></div>
      {row('preinfusion', 'Pre-inf.', range(n.preinfusion_min_s, n.preinfusion_max_s, 's'))}
      {row('grind', 'Grind', formatGrind(n.grind_setting, n.grind_inner))}
    </div>
  );
}

export function ShotPage() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const isNew = params.get('new') === '1';
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(async () => {
    const shot = await api.shot(id);
    const coffee = shot.coffee_id ? await api.coffee(shot.coffee_id) : null;
    return { shot, coffee };
  }, [id]);
  const status = useLoad(() => api.status());
  const aiOn = Boolean(status.data?.ai_configured);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const autoReviewed = useRef(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);

  const review = async () => {
    setReviewing(true);
    setActionError(null);
    try {
      const r = await api.advice(id, true);
      setAiNote(r.ai_note ?? null);
      await reload();
    } catch (e) { setActionError(e); } finally { setReviewing(false); }
  };

  // When you described the shot in your own words, the barista reviews the advice automatically (spec §8.4).
  useEffect(() => {
    if (isNew && aiOn && data?.shot.feedback && data.shot.coffee_id && data.shot.advice?.source !== 'ai' && !autoReviewed.current) {
      autoReviewed.current = true;
      void review();
    }
  }, [isNew, aiOn, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tags, setTags] = useState<TasteTag[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [nums, setNums] = useState<{ dose_g: number | null; yield_g: number | null; time_s: number | null; temperature_c: number | null; grind_setting: number | null }>(
    { dose_g: null, yield_g: null, time_s: null, temperature_c: null, grind_setting: null });
  const setNum = (k: keyof typeof nums) => (v: number | null) => setNums((n) => ({ ...n, [k]: v }));

  if (loading && !data) return <Page title="Shot" back="/"><Loading /></Page>;
  if (!data) return <Page title="Shot" back="/"><ErrorBox error={error} /></Page>;
  const { shot, coffee } = data;
  const recipe = coffee?.recipes.find((r) => r.id === shot.recipe_id) ?? null;
  const advice = shot.advice;
  const back = coffee ? `/coffees/${coffee.coffee.id}` : '/settings';

  const apply = async () => {
    setBusy(true);
    setActionError(null);
    try { await api.applyAdvice(shot.id); nav(back); } catch (e) { setActionError(e); setBusy(false); }
  };
  const saveTasting = async () => {
    setBusy(true);
    setActionError(null);
    if (nums.dose_g == null || nums.yield_g == null || nums.time_s == null) return;
    try {
      // Corrects this shot only; recipes are never touched (rule R3). The advice is recomputed.
      await api.updateShot(shot.id, { taste_tags: tags, score, dose_g: nums.dose_g, yield_g: nums.yield_g, time_s: nums.time_s, temperature_c: nums.temperature_c, grind_setting: nums.grind_setting });
      setEditing(false);
      await reload();
    } catch (e) { setActionError(e); } finally { setBusy(false); }
  };

  return (
    <Page title={isNew ? 'Shot saved' : 'Shot'} back={back}>
      <section className="card">
        <div className="card-title">
          <h2>{coffee?.coffee.name ?? 'Unknown coffee'}</h2>
          <span className="muted small">{dateTime(shot.pulled_at)}</span>
        </div>
        <div className="shot-big">{g(shot.dose_g)} → {g(shot.yield_g)} · {formatRatio(shot.dose_g, shot.yield_g)} · {s(shot.time_s)}</div>
        <div className="muted small">
          {temp(shot.temperature_c)}{shot.preinfusion_s != null ? ` · pre-infusion ${s(shot.preinfusion_s)}` : ''}
          {shot.grind_setting != null ? ` · grind ${formatGrind(shot.grind_setting, shot.grind_inner)}` : ''}
          {recipe ? ` · aiming for recipe v${recipe.version}` : ''}
        </div>
        {editing ? (
          <>
            <div className="grid2">
              <Stepper label="Dose" unit="g" value={nums.dose_g} onChange={setNum('dose_g')} step={0.1} max={30} />
              <Stepper label="Yield" unit="g" value={nums.yield_g} onChange={setNum('yield_g')} step={0.5} max={100} />
              <Stepper label="Time" unit="s" value={nums.time_s} onChange={setNum('time_s')} step={1} max={120} decimals={0} />
              <Stepper label="Temp" unit="°C" value={nums.temperature_c} onChange={setNum('temperature_c')} step={1} min={86} max={96} decimals={0} allowEmpty />
              <Stepper label="Grind" unit="dial" value={nums.grind_setting} onChange={setNum('grind_setting')} step={1} min={1} max={60} allowEmpty />
            </div>
            <Chips options={BALANCE_TAGS} value={tags} onChange={setTags} />
            <Chips options={FLAVOUR_TAGS} value={tags} onChange={setTags} />
            <div className="score-row"><span>Score</span><Stars value={score} onChange={setScore} /></div>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={saveTasting}>Save &amp; update advice</button>
              <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <div className="row between">
            <span><TagList tags={shot.taste_tags} /> <Stars value={shot.score} /></span>
            <button className="btn small" onClick={() => {
              setTags(shot.taste_tags); setScore(shot.score);
              setNums({ dose_g: shot.dose_g, yield_g: shot.yield_g, time_s: shot.time_s, temperature_c: shot.temperature_c, grind_setting: shot.grind_setting });
              setEditing(true);
            }}>Edit</button>
          </div>
        )}
        {shot.feedback ? <p className="quote">“{shot.feedback}”</p> : null}
        {shot.notes ? <p className="notes">{shot.notes}</p> : null}
      </section>

      {reviewing ? <p className="thinking">The barista is reviewing this shot… (10–20 seconds; the advice below is already usable)</p> : null}
      <AiNote note={aiNote} />
      {advice ? (
        <section className={`card advice adv-${advice.adjustment}`}>
          <span className="eyebrow">Next shot{advice.source === 'ai' ? ' · reviewed by the AI barista' : ''}</span>
          {advice.source === 'ai' && advice.engine_adjustment ? <span className="muted small">The built-in rules suggested “{advice.engine_adjustment.replace('_', ' ')}”; the AI chose differently based on your description.</span> : null}
          <h2 className="advice-headline">{advice.headline}</h2>
          <p>{advice.explanation}</p>
          {advice.checks.length ? <ul className="checks">{advice.checks.map((c) => <li key={c}>{c}</li>)}</ul> : null}
          <NextParams advice={advice} from={recipe} />
          {coffee ? (
            <div className="card-actions">
              <button className="btn primary grow" disabled={busy} onClick={apply}>
                {advice.adjustment === 'keep' || advice.adjustment === 'puck_prep' ? 'Keep this recipe' : 'Use for next shot'}
              </button>
              {advice.adjustment !== 'keep' && advice.adjustment !== 'puck_prep'
                ? <Link className="btn" to={back}>Keep current recipe</Link> : null}
              {aiOn && advice.source !== 'ai' && !reviewing ? <button className="btn" onClick={review}>✨ Ask the barista</button> : null}
            </div>
          ) : <p className="muted small">Assign this shot to a coffee (Settings) to use its advice.</p>}
        </section>
      ) : null}
      <ErrorBox error={actionError} />
    </Page>
  );
}
