import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type CoffeeInput } from '../api';
import { AiNote, BeanObservationPanel, ErrorBox, Loading, Page, SourceBadge, useLoad } from '../components';
import { ROAST_LABELS, STATUS_LABELS } from '../format';
import { resizeImage } from '../image';
import { COFFEE_STATUSES, ROAST_LEVELS, type BeanObservation, type Coffee, type CoffeeImage, type FieldSources, type PackagingDraft, type SourcedField } from '../../shared/types';
import { formatRatio } from '../format';

type Form = {
  name: string; brand: string; product: string; origin_country: string; region: string; farm: string; variety: string;
  processing: string; roast_level: string; roast_date: string; purchase_date: string; tasting_notes: string;
  cupping_score: string; intensity: string; altitude: string; status: string; remaining_g: string; notes: string;
};

const EMPTY: Form = {
  name: '', brand: '', product: '', origin_country: '', region: '', farm: '', variety: '', processing: '', roast_level: '',
  roast_date: '', purchase_date: '', tasting_notes: '', cupping_score: '', intensity: '', altitude: '', status: 'active', remaining_g: '', notes: '',
};

const toForm = (c: Coffee): Form => ({
  name: c.name, brand: c.brand ?? '', product: c.product ?? '', origin_country: c.origin_country ?? '', region: c.region ?? '',
  farm: c.farm ?? '', variety: c.variety ?? '', processing: c.processing ?? '', roast_level: c.roast_level ?? '',
  roast_date: c.roast_date ?? '', purchase_date: c.purchase_date ?? '', tasting_notes: c.tasting_notes.join(', '),
  cupping_score: c.cupping_score?.toString() ?? '', intensity: c.intensity ?? '', altitude: c.altitude ?? '', status: c.status,
  remaining_g: c.remaining_g?.toString() ?? '', notes: c.notes ?? '',
});

/** Converts the form to the API shape: empty strings become null (Unknown), never a guess. */
function toInput(f: Form): CoffeeInput {
  const t = (v: string) => (v.trim() === '' ? null : v.trim());
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  return {
    name: f.name.trim(), brand: t(f.brand), product: t(f.product), origin_country: t(f.origin_country), region: t(f.region),
    farm: t(f.farm), variety: t(f.variety), processing: t(f.processing), roast_level: (t(f.roast_level) as Coffee['roast_level']),
    roast_date: t(f.roast_date), purchase_date: t(f.purchase_date),
    tasting_notes: f.tasting_notes.split(',').map((x) => x.trim()).filter(Boolean),
    cupping_score: n(f.cupping_score), intensity: t(f.intensity), altitude: t(f.altitude),
    status: f.status as Coffee['status'], remaining_g: n(f.remaining_g), notes: t(f.notes),
  };
}

export function CoffeeFormPage() {
  const params = useParams();
  const editId = params.id ? Number(params.id) : null;
  const nav = useNavigate();
  const existing = useLoad(() => (editId ? api.coffee(editId) : Promise.resolve(null)), [editId]);
  const status = useLoad(() => api.status());
  const [form, setForm] = useState<Form>(EMPTY);
  const [original, setOriginal] = useState<Form>(EMPTY);
  const [sources, setSources] = useState<FieldSources>({});
  const [photos, setPhotos] = useState<CoffeeImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<PackagingDraft | null>(null);
  const [beans, setBeans] = useState<BeanObservation | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const aiOn = Boolean(status.data?.ai_configured);

  useEffect(() => {
    const c = existing.data?.coffee;
    if (c) { const f = toForm(c); setForm(f); setOriginal(f); setSources(c.field_sources); }
  }, [existing.data]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    // Anything you type yourself is "You" (spec §6).
    setSources((s) => { const next = { ...s }; if (v.trim()) next[k as SourcedField] = 'user'; else delete next[k as SourcedField]; return next; });
  };

  const addPhotos = (type: 'packaging' | 'beans') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    setBusy(true);
    setError(null);
    try {
      for (const f of files) {
        const img = await api.uploadImage(await resizeImage(f), type, editId ?? undefined);
        setPhotos((p) => [...p, img]);
      }
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  /** AI reads the bag; every value lands in the form for you to check, labelled "Packaging". */
  const readBag = async () => {
    const ids = photos.filter((p) => p.image_type === 'packaging').map((p) => p.id);
    setAiBusy('Reading the bag…');
    setError(null);
    try {
      const d = await api.readBag(ids);
      setDraft(d);
      const f = d.fields;
      setForm((cur) => ({
        ...cur,
        ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)])),
        ...(d.tasting_notes.length ? { tasting_notes: d.tasting_notes.join(', ') } : {}),
      }));
      setSources((cur) => {
        const next = { ...cur };
        for (const k of Object.keys(f)) next[k as SourcedField] = 'packaging';
        if (d.tasting_notes.length) next.tasting_notes = 'packaging';
        return next;
      });
    } catch (err) { setError(err); } finally { setAiBusy(null); }
  };

  const describeBeans = async () => {
    const img = photos.find((p) => p.image_type === 'beans');
    if (!img) return;
    setAiBusy('Looking at the beans…');
    setError(null);
    try { setBeans((await api.describeBeans(img.id)).observation); } catch (err) { setError(err); } finally { setAiBusy(null); }
  };

  const useRoastEstimate = () => {
    if (!beans?.roast_estimate) return;
    setForm((f) => ({ ...f, roast_level: beans.roast_estimate! }));
    setSources((s) => ({ ...s, roast_level: 'visual' }));
  };

  /** Keep the recipe printed on the bag as a reference version (rule R2 check included). */
  const savePackagingRecipe = async (coffeeId: number) => {
    const r = draft?.packaging_recipe;
    if (!r || r.dose_g == null || r.yield_g == null) return;
    const timeKnown = r.time_s != null;
    await api.createRecipe(coffeeId, {
      source: 'packaging',
      stated_ratio: r.stated_ratio,
      rationale: `As printed on the packaging.${timeKnown ? '' : ' No time printed; using your usual window.'}${r.temperature_c == null ? ' No temperature printed.' : ''}`,
      params: {
        dose_g: r.dose_g, yield_g: r.yield_g, temperature_c: r.temperature_c,
        time_min_s: r.time_s ?? 28, time_max_s: r.time_s ?? 32,
        preinfusion_min_s: null, preinfusion_max_s: null, grind_setting: null, grind_inner: null,
      },
    }).catch(() => null); // a reference only; never blocks saving the coffee
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = toInput(form);
      if (editId) {
        const orig = toInput(original);
        const changed = Object.fromEntries(Object.entries(input).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(orig[k as keyof CoffeeInput])));
        await api.updateCoffee(editId, changed);
        nav(`/coffees/${editId}`);
      } else {
        const c = await api.createCoffee({ ...input, field_sources: sources, image_ids: photos.map((p) => p.id) });
        await savePackagingRecipe(c.id);
        await api.suggestRecipe(c.id).catch(() => null); // starting recipe right away; the coffee page still works without it
        nav(`/coffees/${c.id}`);
      }
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  if (editId && existing.loading && !existing.data) return <Page title="Edit coffee" back={`/coffees/${editId}`}><Loading /></Page>;

  const field = (k: keyof Form & SourcedField, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      <span>{label} <SourceBadge source={form[k].trim() ? sources[k] : undefined} /></span>
      <input value={form[k]} onChange={set(k)} placeholder="Unknown" {...props} />
      {sources[k] === 'packaging' && draft?.evidence[k] ? <span className="evidence">Read on the bag: “{draft.evidence[k]}”</span> : null}
    </label>
  );

  return (
    <Page title={editId ? 'Edit coffee' : 'Add coffee'} back={editId ? `/coffees/${editId}` : '/'}>
      <form onSubmit={save} className="form">
        {!editId ? (
          <section className="card">
            <h2>Photos</h2>
            <p className="muted small">Take a photo of the bag (front and back) and of the beans. They're saved with the coffee.</p>
            <div className="row">
              <label className="btn">📷 Bag<input type="file" accept="image/*" capture="environment" multiple hidden onChange={addPhotos('packaging')} /></label>
              <label className="btn">📷 Beans<input type="file" accept="image/*" capture="environment" hidden onChange={addPhotos('beans')} /></label>
            </div>
            {photos.length ? (
              <div className="photos">{photos.map((p) => <figure key={p.id}><img src={p.url} alt={p.image_type} /><figcaption>{p.image_type}</figcaption></figure>)}</div>
            ) : null}
            {aiOn ? (
              <div className="row">
                <button type="button" className="btn primary" disabled={!!aiBusy || !photos.some((p) => p.image_type === 'packaging')} onClick={readBag}>✨ Read the bag</button>
                <button type="button" className="btn" disabled={!!aiBusy || !photos.some((p) => p.image_type === 'beans')} onClick={describeBeans}>✨ Describe beans</button>
              </div>
            ) : status.data ? (
              <p className="muted small">AI isn't connected, so fill in what the bag says below and leave anything not printed empty.</p>
            ) : null}
            {aiBusy ? <p className="thinking">{aiBusy} (this can take 10–30 seconds)</p> : null}
          </section>
        ) : null}

        {draft ? (
          <section className="card ai-panel">
            <h2>Read from the bag</h2>
            <p className="muted small">
              {Object.keys(draft.fields).length + (draft.tasting_notes.length ? 1 : 0)} fields filled in below and marked “Packaging”.
              Anything not printed stays Unknown. Check them and correct anything that's wrong.
            </p>
            {draft.packaging_recipe ? (
              <p className="small">
                Printed recipe: {draft.packaging_recipe.dose_g ?? '?'} g → {draft.packaging_recipe.yield_g ?? '?'} g
                {draft.packaging_recipe.dose_g && draft.packaging_recipe.yield_g ? ` (${formatRatio(draft.packaging_recipe.dose_g, draft.packaging_recipe.yield_g)})` : ''}
                {draft.packaging_recipe.time_s ? `, ${draft.packaging_recipe.time_s} s` : ''}
                {draft.packaging_recipe.temperature_c ? `, ${draft.packaging_recipe.temperature_c} °C` : ''}. It's saved as a reference recipe.
              </p>
            ) : null}
            {draft.ratio_check && !draft.ratio_check.consistent ? <p className="warn">⚠ {draft.ratio_check.message}</p> : null}
            {draft.uncertainties.length ? <><strong className="small">Unclear on the bag</strong><ul>{draft.uncertainties.map((u) => <li key={u}>{u}</li>)}</ul></> : null}
            <details><summary className="small">All text read</summary><p className="raw-text">{draft.raw_text}</p></details>
          </section>
        ) : null}

        {beans ? (
          <section className="card">
            <BeanObservationPanel obs={beans} />
            {beans.roast_estimate && !form.roast_level ? (
              <button type="button" className="btn" onClick={useRoastEstimate}>Use “{ROAST_LABELS[beans.roast_estimate]}” as estimated roast level</button>
            ) : null}
            <AiNote note={beans.roast_estimate && form.roast_level && sources.roast_level !== 'visual' ? 'Roast level is already set from the bag or by you, so the photo estimate is kept as an observation only.' : null} />
          </section>
        ) : null}

        <section className="card">
          <h2>Details</h2>
          <p className="muted small">Leave a field empty if it isn't on the bag. Empty means Unknown — nothing is guessed.</p>
          <label className="field">
            <span>Name *</span>
            <input value={form.name} onChange={set('name')} required placeholder="e.g. Lazzio Brazil Single Origin" />
          </label>
          {field('brand', 'Brand / roaster')}
          {field('product', 'Product')}
          {field('origin_country', 'Origin country')}
          {field('region', 'Region')}
          {field('farm', 'Farm / producer')}
          {field('variety', 'Variety')}
          <label className="field">
            <span>Processing <SourceBadge source={form.processing.trim() ? sources.processing : undefined} /></span>
            <input value={form.processing} onChange={set('processing')} placeholder="Unknown" list="processing-options" />
            <datalist id="processing-options"><option value="Washed" /><option value="Natural" /><option value="Honey" /><option value="Anaerobic" /></datalist>
          </label>
          <label className="field">
            <span>Roast level <SourceBadge source={form.roast_level ? sources.roast_level : undefined} /></span>
            <select value={form.roast_level} onChange={set('roast_level')}>
              <option value="">Unknown</option>
              {ROAST_LEVELS.map((r) => <option key={r} value={r}>{ROAST_LABELS[r]}</option>)}
            </select>
          </label>
          {field('roast_date', 'Roast date', { type: 'date' })}
          <label className="field"><span>Purchase date</span><input type="date" value={form.purchase_date} onChange={set('purchase_date')} /></label>
          {field('tasting_notes', 'Tasting notes on the bag (comma separated)', { placeholder: 'e.g. toffee, cocoa, milk chocolate' })}
          {field('cupping_score', 'Cupping score', { inputMode: 'decimal' })}
          {field('intensity', 'Intensity', { placeholder: 'e.g. 4/5' })}
          {field('altitude', 'Altitude', { placeholder: 'e.g. 1,800 m' })}
          <label className="field">
            <span>Status</span>
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {COFFEE_STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
            </select>
          </label>
          <label className="field"><span>Remaining (g)</span><input inputMode="decimal" value={form.remaining_g} onChange={(e) => setForm((f) => ({ ...f, remaining_g: e.target.value }))} placeholder="Optional" /></label>
          <label className="field"><span>Notes</span><textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></label>
        </section>

        <ErrorBox error={error ?? existing.error} />
        <button className="btn primary block" disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : editId ? 'Save changes' : 'Save coffee'}</button>
      </form>
    </Page>
  );
}
