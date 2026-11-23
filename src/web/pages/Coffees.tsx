import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorBox, Loading, Page, Stars, useLoad } from '../components';
import { roastAge, ROAST_LABELS, STATUS_LABELS } from '../format';
import { COFFEE_STATUSES, type CoffeeStatus } from '../../shared/types';

export function Coffees() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as CoffeeStatus | '';
  const { data, error, loading } = useLoad(() => api.coffees(status || undefined), [status]);
  return (
    <Page title="Coffees" actions={<Link to="/coffees/new" className="btn">＋ Add</Link>}>
      <div className="chips filter">
        <button type="button" className={`chip${!status ? ' on' : ''}`} onClick={() => setParams({})}>All</button>
        {COFFEE_STATUSES.map((st) => (
          <button key={st} type="button" className={`chip${status === st ? ' on' : ''}`} onClick={() => setParams({ status: st })}>{STATUS_LABELS[st]}</button>
        ))}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : null}
      {data && !data.length ? <p className="muted center">No coffees here.</p> : null}
      <ul className="coffee-list">
        {data?.map((s) => (
          <li key={s.coffee.id}>
            <Link to={`/coffees/${s.coffee.id}`} className="card coffee-item">
              <div>
                <strong>{s.coffee.name}</strong>
                <div className="muted small">
                  {[s.coffee.origin_country, s.coffee.roast_level ? ROAST_LABELS[s.coffee.roast_level] : null, roastAge(s.roast_age_days)].filter(Boolean).join(' · ') || 'Details unknown'}
                </div>
                <div className="muted small">{s.shot_count} shot{s.shot_count === 1 ? '' : 's'}{s.best_shot ? ' · best ' : ''}{s.best_shot ? <Stars value={s.best_shot.score} /> : null}</div>
              </div>
              <span className={`pill st-${s.coffee.status}`}>{STATUS_LABELS[s.coffee.status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
