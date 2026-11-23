import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorBox, Loading, Page, Stepper, useLoad } from '../components';
import { formatRatio } from '../format';
import { checkStatedRatio, yieldForRatio } from '../../shared/ratio';
import type { RecipeParams } from '../../shared/types';

const DEFAULTS: RecipeParams = {
  dose_g: 20, yield_g: 40, temperature_c: 93, time_min_s: 28, time_max_s: 32, preinfusion_min_s: 5, preinfusion_max_s: 8, grind_setting: null, grind_inner: null,
};

/** New recipe version: adjust the current one, or enter one (e.g. printed on the bag). */
export function RecipeFormPage() {
  const id = Number(useParams().id);
  const [qs] = useSearchParams();
  const fromId = qs.get('from') ? Number(qs.get('from')) : null;
  const nav = useNavigate();
  const { data, loading } = useLoad(() => api.coffee(id), [id]);
  const [p, setP] = useState<RecipeParams>(DEFAULTS);
  const [fromPackaging, setFromPackaging] = useState(false);
  const [statedRatio, setStatedRatio] = useState<number | null>(null);
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const src = data?.recipes.find((r) => r.id === fromId) ?? data?.current_recipe;
    if (src) {
      const { dose_g, yield_g, temperature_c, time_min_s, time_max_s, preinfusion_min_s, preinfusion_max_s, grind_setting, grind_inner } = src;
      setP({ dose_g, yield_g, temperature_c, time_min_s, time_max_s, preinfusion_min_s, preinfusion_max_s, grind_setting, grind_inner });
    }
  }, [data, fromId]);

  const set = <K extends keyof RecipeParams>(k: K) => (v: RecipeParams[K]) => setP((x) => ({ ...x, [k]: v }));
  const check = fromPackaging ? checkStatedRatio(p.dose_g, p.yield_g, statedRatio) : null;

  const save = async (activate: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.createRecipe(id, {
        params: p, rationale: rationale.trim() || null, activate,
        source: fromPackaging ? 'packaging' : 'user', stated_ratio: fromPackaging ? statedRatio : null,
      });
      nav(`/coffees/${id}`);
    } catch (e) { setError(e); setBusy(false); }
  };

  if (loading && !data) return <Page title="Recipe" back={`/coffees/${id}`}><Loading /></Page>;

  return (
    <Page title={fromId ? 'Adjust recipe' : 'New recipe'} back={`/coffees/${id}`}>
      <p className="muted small">Saves a new recipe version. Past versions and recorded shots are never changed.</p>
      <section className="card">
        <div className="grid2">
          <Stepper label="Dose" unit="g" value={p.dose_g} onChange={(v) => set('dose_g')(v ?? 20)} step={0.1} max={30} />
          <Stepper label="Yield" unit="g" value={p.yield_g} onChange={(v) => set('yield_g')(v ?? 40)} step={0.5} max={100} />
          <div className="ratio-live">
            <span className="stepper-label">Ratio</span>
            <span className="ratio-value">{formatRatio(p.dose_g, p.yield_g)}</span>
            <span className="row tight">
              {[2, 2.25, 2.5].map((r) => <button key={r} type="button" className="chip" onClick={() => set('yield_g')(yieldForRatio(p.dose_g, r))}>1:{r}</button>)}
            </span>
          </div>
          <Stepper label="Temp" unit="°C" value={p.temperature_c} onChange={set('temperature_c')} step={1} min={86} max={96} decimals={0} allowEmpty />
          <Stepper label="Time from" unit="s" value={p.time_min_s} onChange={(v) => set('time_min_s')(v ?? 28)} step={1} max={60} decimals={0} />
          <Stepper label="Time to" unit="s" value={p.time_max_s} onChange={(v) => set('time_max_s')(v ?? 32)} step={1} max={60} decimals={0} />
          <Stepper label="Pre-inf. from" unit="s" value={p.preinfusion_min_s} onChange={set('preinfusion_min_s')} step={1} max={30} decimals={0} allowEmpty />
          <Stepper label="Pre-inf. to" unit="s" value={p.preinfusion_max_s} onChange={set('preinfusion_max_s')} step={1} max={30} decimals={0} allowEmpty />
          <Stepper label="Grind" unit="dial" value={p.grind_setting} onChange={set('grind_setting')} step={1} min={1} max={60} allowEmpty />
          <Stepper label="Inner burr" unit="opt." value={p.grind_inner} onChange={set('grind_inner')} step={1} min={1} max={10} decimals={0} allowEmpty />
        </div>
        <label className="check"><input type="checkbox" checked={fromPackaging} onChange={(e) => setFromPackaging(e.target.checked)} /> This recipe is printed on the bag</label>
        {fromPackaging ? (
          <Stepper label="Ratio printed on the bag (e.g. 2.25 for 1:2.25)" value={statedRatio} onChange={setStatedRatio} step={0.05} min={1} max={4} decimals={2} allowEmpty />
        ) : null}
        {check && !check.consistent ? <p className="warn">⚠ {check.message}</p> : null}
        <label className="field"><span>Why (optional)</span><textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
      </section>
      <ErrorBox error={error} />
      <div className="row">
        <button className="btn primary grow" disabled={busy || p.temperature_c == null} onClick={() => save(true)}>Save &amp; use</button>
        <button className="btn grow" disabled={busy} onClick={() => save(false)}>Save as suggestion</button>
      </div>
    </Page>
  );
}
