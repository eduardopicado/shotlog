import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Chips, ErrorBox, Loading, Page, RecipeSummary, Stars, Stepper, useLoad } from '../components';
import { formatRatio } from '../format';
import { parseShotText } from '../../shared/parseShot';
import { BALANCE_TAGS, FLAVOUR_TAGS, type TasteTag } from '../../shared/types';

/** "+ Shot" tab: go straight to the only active coffee, or let you pick. */
export function PickCoffee() {
  const nav = useNavigate();
  const { data, error, loading } = useLoad(() => api.coffees());
  const active = data?.filter((s) => s.coffee.status === 'active') ?? [];
  useEffect(() => { if (active.length === 1) nav(`/coffees/${active[0].coffee.id}/shot`, { replace: true }); }, [active.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = data?.filter((s) => s.coffee.status !== 'active') ?? [];
  return (
    <Page title="Log a shot">
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        <>
          <h2 className="section-title">Which coffee?</h2>
          {active.map((s) => (
            <Link key={s.coffee.id} className="card pick" to={`/coffees/${s.coffee.id}/shot`}>
              <strong>{s.coffee.name}</strong>
              {s.current_recipe ? <RecipeSummary recipe={s.current_recipe} /> : null}
            </Link>
          ))}
          {!active.length ? <p className="muted">No coffee is marked as in use. Pick one below (it can be marked as in use when you save), or <Link to="/coffees/new">add a new bag</Link>.</p> : null}
          {others.length ? (
            <details className="card" open={!active.length}>
              <summary>Other coffees</summary>
              <ul className="list">
                {others.map((s) => <li key={s.coffee.id}><Link to={`/coffees/${s.coffee.id}/shot`}>{s.coffee.name}</Link></li>)}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}

export function LogShot() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { data, error, loading } = useLoad(() => api.coffee(id), [id]);

  const [dose, setDose] = useState<number | null>(20);
  const [yld, setYield] = useState<number | null>(40);
  const [time, setTime] = useState<number | null>(null);
  const [tempC, setTemp] = useState<number | null>(93);
  const [pi, setPi] = useState<number | null>(null);
  const [grind, setGrind] = useState<number | null>(null);
  const [inner, setInner] = useState<number | null>(null);
  const [tags, setTags] = useState<TasteTag[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [notes, setNotes] = useState('');
  const [quick, setQuick] = useState('');
  const [markActive, setMarkActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  // Prefill from the current recipe, with the grind you used last time.
  useEffect(() => {
    if (!data) return;
    const r = data.current_recipe;
    const last = data.shots[0];
    if (r) {
      setDose(r.dose_g);
      setYield(r.yield_g);
      setTemp(r.temperature_c ?? last?.temperature_c ?? 93);
      setPi(r.preinfusion_min_s != null && r.preinfusion_max_s != null ? Math.round((r.preinfusion_min_s + r.preinfusion_max_s) / 2) : r.preinfusion_min_s);
    } else if (last) {
      setDose(last.dose_g); setYield(last.yield_g); setTemp(last.temperature_c); setPi(last.preinfusion_s);
    }
    setGrind(r?.grind_setting ?? last?.grind_setting ?? null);
    setInner(r?.grind_inner ?? last?.grind_inner ?? null);
  }, [data]);

  const applyQuick = () => {
    const p = parseShotText(quick);
    if (p.dose_g != null) setDose(p.dose_g);
    if (p.yield_g != null) setYield(p.yield_g);
    if (p.time_s != null) setTime(p.time_s);
    if (p.temperature_c != null) setTemp(p.temperature_c);
    if (p.preinfusion_s != null) setPi(p.preinfusion_s);
    if (p.grind_setting != null) setGrind(p.grind_setting);
    if (p.grind_inner != null) setInner(p.grind_inner);
    if (p.taste_tags.length) setTags((t) => Array.from(new Set([...t, ...p.taste_tags])));
    if (!feedback.trim()) setFeedback(quick);
  };

  const save = async () => {
    if (dose == null || yld == null || time == null) return;
    setBusy(true);
    setSaveError(null);
    try {
      const { shot } = await api.logShot({
        coffee_id: id,
        recipe_id: data?.current_recipe?.id,
        dose_g: dose, yield_g: yld, time_s: time, temperature_c: tempC, preinfusion_s: pi,
        grind_setting: grind, grind_inner: inner, taste_tags: tags, score,
        feedback: feedback.trim() || null, notes: notes.trim() || null,
        mark_active: data?.coffee.status !== 'active' && markActive,
      });
      nav(`/shots/${shot.id}?new=1`, { replace: true });
    } catch (e) { setSaveError(e); } finally { setBusy(false); }
  };

  if (loading && !data) return <Page title="Log shot" back={`/coffees/${id}`}><Loading /></Page>;
  if (!data) return <Page title="Log shot" back="/"><ErrorBox error={error} /></Page>;
  const r = data.current_recipe;
  const outside = time != null && r && (time < r.time_min_s || time > r.time_max_s);

  return (
    <Page title="Log shot" back={`/coffees/${id}`}>
      <div className="shot-head">
        <strong>{data.coffee.name}</strong>
        {r ? <span className="muted small">Recipe v{r.version}: <RecipeSummary recipe={r} /></span> : <span className="muted small">No recipe yet; advice will use your preferences.</span>}
      </div>

      <section className="card">
        <div className="grid2">
          <Stepper label="Dose" unit="g" value={dose} onChange={setDose} step={0.1} max={30} />
          <Stepper label="Yield" unit="g" value={yld} onChange={setYield} step={0.5} max={100} />
          <Stepper label="Time" unit="s" value={time} onChange={setTime} step={1} max={120} decimals={0} allowEmpty />
          <div className="ratio-live">
            <span className="stepper-label">Ratio</span>
            <span className="ratio-value">{dose && yld ? formatRatio(dose, yld) : '—'}</span>
            {outside ? <span className="warn small">outside {r!.time_min_s}–{r!.time_max_s} s</span> : null}
          </div>
          <Stepper label="Temp" unit="°C" value={tempC} onChange={setTemp} step={1} min={86} max={96} decimals={0} allowEmpty />
          <Stepper label="Pre-infusion" unit="s" value={pi} onChange={setPi} step={1} max={30} decimals={0} allowEmpty />
          <Stepper label="Grind" unit="dial" value={grind} onChange={setGrind} step={1} min={1} max={60} decimals={1} allowEmpty />
          <Stepper label="Inner burr" unit="opt." value={inner} onChange={setInner} step={1} min={1} max={10} decimals={0} allowEmpty />
        </div>
      </section>

      <section className="card">
        <h2>How did it taste?</h2>
        <Chips options={BALANCE_TAGS} value={tags} onChange={setTags} />
        <h3 className="sub">Flavours</h3>
        <Chips options={FLAVOUR_TAGS} value={tags} onChange={setTags} />
        <div className="score-row"><span>Score</span><Stars value={score} onChange={setScore} /></div>
        <label className="field">
          <span>In your words (optional)</span>
          <textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. much sweeter, good chocolate, slightly thin" />
        </label>
      </section>

      <details className="card">
        <summary>Quick text entry &amp; notes</summary>
        <label className="field">
          <span>Describe the shot and tap Fill</span>
          <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="20 in, 40 out, 24 s, 93°C, a little sour" />
        </label>
        <button type="button" className="btn" onClick={applyQuick} disabled={!quick.trim()}>Fill from text</button>
        <label className="field"><span>Notes (puck, prep, milk…)</span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </details>

      {data.coffee.status !== 'active' ? (
        <label className="check"><input type="checkbox" checked={markActive} onChange={(e) => setMarkActive(e.target.checked)} /> Mark this coffee as in use</label>
      ) : null}

      <ErrorBox error={saveError} />
      <button className="btn primary block big" onClick={save} disabled={busy || dose == null || yld == null || time == null}>
        {busy ? 'Saving…' : time == null ? 'Enter the shot time' : 'Save shot'}
      </button>
    </Page>
  );
}
