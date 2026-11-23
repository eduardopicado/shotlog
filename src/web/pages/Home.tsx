import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ErrorBox, Loading, RecipeSummary, ShotRow, Stars, useLoad } from '../components';
import { dateShort, roastAge } from '../format';
import type { CoffeeSummary } from '../../shared/types';

function CoffeeCard({ s }: { s: CoffeeSummary }) {
  const age = roastAge(s.roast_age_days);
  return (
    <article className="card coffee-card">
      <Link to={`/coffees/${s.coffee.id}`} className="coffee-card-head">
        <h2>{s.coffee.name}</h2>
        <span className="muted small">{[s.coffee.brand, age].filter(Boolean).join(' · ') || ' '}</span>
      </Link>
      {s.current_recipe ? <RecipeSummary recipe={s.current_recipe} /> : <span className="muted">No recipe yet</span>}
      {s.coffee.remaining_g != null ? (
        <span className={`small ${s.coffee.remaining_g < (s.current_recipe?.dose_g ?? 20) * 2 ? 'warn' : 'muted'}`}>
          {Math.round(s.coffee.remaining_g)} g left (~{Math.floor(s.coffee.remaining_g / (s.current_recipe?.dose_g ?? 20))} shots)
        </span>
      ) : null}
      {s.last_shot ? (
        <div className="muted small last-shot">
          Last shot {dateShort(s.last_shot.pulled_at)}: {s.last_shot.time_s} s <Stars value={s.last_shot.score} />
          {s.last_shot.advice ? <div className="advice-mini">Next: {s.last_shot.advice.headline}</div> : null}
        </div>
      ) : null}
      <Link to={`/coffees/${s.coffee.id}/shot`} className="btn primary block">Log shot</Link>
    </article>
  );
}

/** One-time tip for iPhone/iPad Safari: install to the home screen for a full-screen app. */
function InstallHint() {
  const key = 'shotlog.installHintDismissed';
  const [hidden, setHidden] = useState(() => {
    try {
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      return !ios || Boolean(standalone) || localStorage.getItem(key) === '1';
    } catch { return true; }
  });
  if (hidden) return null;
  const dismiss = () => { try { localStorage.setItem(key, '1'); } catch { /* private mode */ } setHidden(true); };
  return (
    <div className="card install-hint">
      <span>Tip: tap <strong>Share</strong> → <strong>Add to Home Screen</strong> to open Shotlog like an app.</span>
      <button className="btn small ghost" onClick={dismiss} aria-label="Dismiss tip">✕</button>
    </div>
  );
}

export function Home() {
  const { data, error, loading } = useLoad(() => api.dashboard());
  return (
    <main className="page">
      <header className="page-head home-head">
        <h1>Shotlog</h1>
        <Link to="/coffees/new" className="btn">＋ Add coffee</Link>
      </header>
      <InstallHint />
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        <>
          <section>
            <h2 className="section-title">In use</h2>
            {data.active.length ? data.active.map((s) => <CoffeeCard key={s.coffee.id} s={s} />) : (
              <div className="card empty">
                <p>No coffees marked as in use.</p>
                <p className="muted small">
                  Add a new bag, or open one of your {data.historical_count} imported coffees and mark it as in use.
                </p>
                <div className="row">
                  <Link to="/coffees/new" className="btn primary">Add coffee</Link>
                  <Link to="/coffees?status=historical" className="btn">Imported coffees</Link>
                </div>
              </div>
            )}
          </section>

          {data.last_shot ? (
            <section>
              <h2 className="section-title">Last shot</h2>
              <div className="card">
                <ShotRow shot={data.last_shot} coffeeName={data.last_shot.coffee_name ?? 'Unknown coffee'} />
                {data.last_shot.advice ? <p className="advice-mini">Next: {data.last_shot.advice.headline}</p> : null}
              </div>
            </section>
          ) : null}

          {data.recent.length ? (
            <section>
              <h2 className="section-title">Recently used</h2>
              <ul className="list card">
                {data.recent.map((s) => (
                  <li key={s.coffee.id}><Link to={`/coffees/${s.coffee.id}`}>{s.coffee.name}</Link> <span className="muted small">{s.shot_count} shots</span></li>
                ))}
              </ul>
            </section>
          ) : null}

          {data.unassigned_shot_count ? (
            <p className="muted small center">
              {data.unassigned_shot_count} historical shot{data.unassigned_shot_count > 1 ? 's' : ''} without a coffee. <Link to="/settings">Assign</Link>
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
