import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorBox, Loading, Page, ShotRow, Stepper, useLoad } from '../components';
import type { BrewPreferences } from '../../shared/types';

export function Settings() {
  const prefs = useLoad(() => api.settings());
  const equipment = useLoad(() => api.equipment());
  const status = useLoad(() => api.status());
  const unassigned = useLoad(() => api.shots(true));
  const coffees = useLoad(() => api.coffees());
  const [p, setP] = useState<BrewPreferences | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => { if (prefs.data) setP(prefs.data.brew_preferences); }, [prefs.data]);
  const set = (k: keyof BrewPreferences) => (v: number | null) => { if (v != null && p) { setP({ ...p, [k]: v }); setSaved(false); } };

  const savePrefs = async () => {
    if (!p) return;
    setError(null);
    try { await api.saveSettings(p); setSaved(true); } catch (e) { setError(e); }
  };
  const assign = async (shotId: number, coffeeId: number) => {
    setError(null);
    try { await api.updateShot(shotId, { coffee_id: coffeeId }); await unassigned.reload(); } catch (e) { setError(e); }
  };

  return (
    <Page title="Settings">
      <ErrorBox error={error} />
      <section className="card">
        <h2>Brew preferences</h2>
        <p className="muted small">Used for new starting recipes and when a shot has no recipe.</p>
        {p ? (
          <>
            <div className="grid2">
              <Stepper label="Dose" unit="g" value={p.dose_g} onChange={set('dose_g')} step={0.5} max={30} />
              <Stepper label="Ratio 1:" value={p.ratio} onChange={set('ratio')} step={0.05} min={1} max={4} decimals={2} />
              <Stepper label="Time from" unit="s" value={p.time_min_s} onChange={set('time_min_s')} step={1} decimals={0} />
              <Stepper label="Time to" unit="s" value={p.time_max_s} onChange={set('time_max_s')} step={1} decimals={0} />
              <Stepper label="Pre-inf. from" unit="s" value={p.preinfusion_min_s} onChange={set('preinfusion_min_s')} step={1} decimals={0} />
              <Stepper label="Pre-inf. to" unit="s" value={p.preinfusion_max_s} onChange={set('preinfusion_max_s')} step={1} decimals={0} />
            </div>
            <button className="btn primary" onClick={savePrefs}>{saved ? 'Saved ✓' : 'Save preferences'}</button>
          </>
        ) : <Loading />}
      </section>

      <section className="card">
        <h2>Equipment</h2>
        <ul className="list">
          {equipment.data?.map((e) => (
            <li key={e.id}><strong>{e.brand} {e.model}</strong> <span className="muted small">{e.equipment_type}{e.notes ? ` · ${e.notes}` : ''}</span></li>
          ))}
        </ul>
      </section>

      {unassigned.data?.length ? (
        <section className="card">
          <h2>Shots without a coffee</h2>
          <p className="muted small">Historical shots whose coffee isn't known. Assign one if you remember which coffee it was.</p>
          {unassigned.data.map((s) => (
            <div key={s.id} className="assign">
              <ShotRow shot={s} />
              {s.notes ? <p className="muted small">{s.notes}</p> : null}
              <select defaultValue="" onChange={(e) => e.target.value && assign(s.id, Number(e.target.value))} aria-label="Assign to coffee">
                <option value="">Assign to…</option>
                {coffees.data?.map((c) => <option key={c.coffee.id} value={c.coffee.id}>{c.coffee.name}</option>)}
              </select>
            </div>
          ))}
        </section>
      ) : null}

      <section className="card">
        <h2>AI</h2>
        {status.data ? (
          status.data.ai_configured ? (
            <p>Connected. Today: {status.data.ai_calls_today}/{status.data.ai_daily_limit} calls · this month: {status.data.ai_calls_month} calls, ≈ ${status.data.ai_cost_month_usd.toFixed(2)}</p>
          ) : <p className="muted small">Not connected. Everything works without AI; packaging reading and AI review need an API key (see docs/CLOUDFLARE.md).</p>
        ) : <Loading />}
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p className="muted small">Download everything (coffees, recipes, shots, settings) as JSON.</p>
        <a className="btn" href="/api/export" download>Export JSON</a>
        {status.data ? <p className="muted small">Shotlog v{status.data.version}</p> : null}
      </section>
    </Page>
  );
}
