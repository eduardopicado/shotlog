import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type CoffeeInput } from '../api';
import { ErrorBox, Loading, Page, SourceBadge, useLoad } from '../components';
import { ROAST_LABELS, STATUS_LABELS } from '../format';
import { resizeImage } from '../image';
import { COFFEE_STATUSES, ROAST_LEVELS, type Coffee, type CoffeeImage, type FieldSources, type SourcedField } from '../../shared/types';

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
            {status.data && !status.data.ai_configured ? (
              <p className="muted small">Reading the bag automatically arrives with the AI features. For now, fill in what the bag says below — leave anything not printed empty.</p>
            ) : null}
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
