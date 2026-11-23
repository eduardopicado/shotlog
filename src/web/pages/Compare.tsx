import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorBox, Loading, Page, useLoad } from '../components';
import { formatGrind, formatRatio, g, range, ROAST_LABELS, temp, trimNumber } from '../format';
import type { CoffeeSummary } from '../../shared/types';
import type { CoffeeStats, CompareHighlight, Flavour } from '../../shared/stats';
import { FLAVOURS } from '../../shared/stats';

type Item = CoffeeSummary & { stats: CoffeeStats };
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const FLAVOUR_LABELS: Record<Flavour, string> = { chocolate: 'Chocolate', fruity: 'Fruity', nutty: 'Nutty', caramel: 'Caramel / toffee' };

/** Compare coffees side by side (spec §4.F). */
export function Compare() {
  const [params, setParams] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').map(Number).filter((n) => n > 0);
  const all = useLoad(() => api.coffees());
  const cmp = useLoad(() => (ids.length ? api.compare(ids) : Promise.resolve(null)), [ids.join(',')]);

  const toggle = (id: number) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-6);
    setParams(next.length ? { ids: next.join(',') } : {});
  };
  const nameOf = (h: CompareHighlight | null) => cmp.data?.items.find((i) => i.coffee.id === h?.coffee_id)?.coffee.name;
  const items: Item[] = cmp.data?.items ?? [];

  return (
    <Page title="Compare" back="/coffees">
      <section className="card">
        <h2>Pick coffees</h2>
        <div className="chips">
          {all.data?.filter((s) => s.shot_count > 0 || ids.includes(s.coffee.id)).map((s) => (
            <button key={s.coffee.id} type="button" className={`chip${ids.includes(s.coffee.id) ? ' on' : ''}`} aria-pressed={ids.includes(s.coffee.id)} onClick={() => toggle(s.coffee.id)}>
              {s.coffee.name}
            </button>
          ))}
        </div>
        {all.data && !all.data.some((s) => s.shot_count > 0) ? <p className="muted small">Coffees appear here once they have shots.</p> : null}
      </section>
      <ErrorBox error={all.error ?? cmp.error} />
      {cmp.loading && ids.length && !cmp.data ? <Loading /> : null}

      {items.length >= 2 && cmp.data ? (
        <section className="card highlights">
          <h2>So far</h2>
          <ul className="list">
            {cmp.data.highlights.chocolate ? <li>🍫 Most chocolate-forward: <strong>{nameOf(cmp.data.highlights.chocolate)}</strong> <span className="muted small">({pct(cmp.data.highlights.chocolate.value)} of {cmp.data.highlights.chocolate.basis} tasted shots)</span></li> : null}
            {cmp.data.highlights.fruity ? <li>🍒 Most fruity: <strong>{nameOf(cmp.data.highlights.fruity)}</strong> <span className="muted small">({pct(cmp.data.highlights.fruity.value)} of {cmp.data.highlights.fruity.basis})</span></li> : null}
            {cmp.data.highlights.best_avg_score ? <li>★ Best average score: <strong>{nameOf(cmp.data.highlights.best_avg_score)}</strong> <span className="muted small">({cmp.data.highlights.best_avg_score.value}/5 over {cmp.data.highlights.best_avg_score.basis} shots)</span></li> : null}
            {cmp.data.highlights.most_successful_recipe ? (() => {
              const it = items.find((i) => i.coffee.id === cmp.data!.highlights.most_successful_recipe!.coffee_id)!;
              const r = it.stats.most_successful_recipe!;
              return <li>🏆 Most successful recipe: <strong>{it.coffee.name} v{r.version}</strong> <span className="muted small">({g(r.planned.dose_g)} → {g(r.planned.yield_g)}, {temp(r.planned.temperature_c)}; avg {r.avg_score}/5)</span></li>;
            })() : null}
          </ul>
          <p className="muted small">Based only on shots you've logged and tagged; more shots make this more reliable.</p>
        </section>
      ) : null}

      {items.length ? (
        <div className="compare-scroll">
          <table className="compare">
            <thead>
              <tr><th scope="col"></th>{items.map((i) => <th key={i.coffee.id} scope="col"><Link to={`/coffees/${i.coffee.id}`}>{i.coffee.name}</Link></th>)}</tr>
            </thead>
            <tbody>
              <Row label="Origin" items={items} cell={(i) => [i.coffee.origin_country, i.coffee.region].filter(Boolean).join(', ') || 'Unknown'} />
              <Row label="Processing" items={items} cell={(i) => i.coffee.processing ?? 'Unknown'} />
              <Row label="Roast" items={items} cell={(i) => i.coffee.roast_level ? `${i.coffee.field_sources.roast_level === 'visual' ? 'Est. ' : ''}${ROAST_LABELS[i.coffee.roast_level].toLowerCase()}` : 'Unknown'} />
              <Row label="Bag notes" items={items} cell={(i) => i.coffee.tasting_notes.join(', ') || '—'} />
              <Row label="Shots" items={items} cell={(i) => String(i.stats.shots)} />
              <Row label="Avg score" items={items} cell={(i) => (i.stats.avg_score != null ? `${i.stats.avg_score}/5` : '—')} />
              <Row label="Good shots" items={items} cell={(i) => pct(i.stats.good_share)} />
              {FLAVOURS.map((f) => <Row key={f} label={FLAVOUR_LABELS[f]} items={items} cell={(i) => pct(i.stats.flavour_share?.[f])} />)}
              <Row label="Best recipe" items={items} cell={(i) => {
                const r = i.stats.most_successful_recipe;
                return r ? `v${r.version}: ${g(r.planned.dose_g)} → ${g(r.planned.yield_g)} (${formatRatio(r.planned.dose_g, r.planned.yield_g)}), ${temp(r.planned.temperature_c)}, ${range(r.planned.time_min_s, r.planned.time_max_s, 's')}, grind ${formatGrind(r.planned.grind_setting, r.planned.grind_inner)}` : '—';
              }} />
              <Row label="Current recipe" items={items} cell={(i) => i.current_recipe ? `${g(i.current_recipe.dose_g)} → ${g(i.current_recipe.yield_g)}, ${temp(i.current_recipe.temperature_c)}` : '—'} />
              <Row label="Planned vs actual" items={items} cell={(i) => {
                const r = i.stats.most_successful_recipe ?? i.stats.recipes.filter((x) => x.shots).at(-1);
                return r && r.shots ? `v${r.version}: aimed ${range(r.planned.time_min_s, r.planned.time_max_s, 's')}, pulled avg ${trimNumber(r.avg_time!)} s; ${pct(r.on_target)} in window` : '—';
              }} />
              <Row label="Roast age" items={items} cell={(i) => i.stats.first_shot_roast_age != null ? `day ${i.stats.first_shot_roast_age}–${i.stats.last_shot_roast_age}` : 'Unknown'} />
            </tbody>
          </table>
        </div>
      ) : <p className="muted center">Pick two or more coffees to compare them.</p>}
    </Page>
  );
}

function Row({ label, items, cell }: { label: string; items: Item[]; cell: (i: Item) => string }) {
  return <tr><th scope="row">{label}</th>{items.map((i) => <td key={i.coffee.id}>{cell(i)}</td>)}</tr>;
}
