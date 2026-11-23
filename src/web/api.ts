// Thin typed client for the Worker API. Same origin, so the Cloudflare Access cookie is sent automatically.

import type {
  Advice, AppStatus, BeanObservation, BrewPreferences, Coffee, CoffeeDetail, CoffeeImage, CoffeeSummary, Dashboard, Equipment,
  PackagingDraft, Recipe, RecipeParams, Shot,
} from '../shared/types';
import type { RatioCheck } from '../shared/ratio';
import type { CoffeeStats, compareHighlights } from '../shared/stats';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Array<{ path: string; message: string }>) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const isForm = body instanceof FormData;
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    // Most often: the Cloudflare Access session expired and the login redirect was blocked.
    throw new ApiError(0, 'Could not reach Shotlog. Check your connection, or reload the page to sign in again.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON (e.g. a login page) */ }
  if (!res.ok || data === null) {
    const err = (data ?? {}) as { error?: string; details?: Array<{ path: string; message: string }> };
    const message = err.error ?? (res.ok ? 'Your session may have expired. Reload the page to sign in again.' : `Request failed (${res.status})`);
    throw new ApiError(res.status, message, err.details);
  }
  return data as T;
}

const get = <T>(p: string) => request<T>('GET', p);
const post = <T>(p: string, b: unknown = {}) => request<T>('POST', p, b);
const patch = <T>(p: string, b: unknown) => request<T>('PATCH', p, b);
const put = <T>(p: string, b: unknown) => request<T>('PUT', p, b);

export type CoffeeInput = Partial<Omit<Coffee, 'id' | 'created_at' | 'updated_at'>> & { image_ids?: number[] };
export type ShotInput = Partial<Omit<Shot, 'id' | 'ratio' | 'advice' | 'created_at' | 'grinder_model'>> & {
  coffee_id: number; dose_g: number; yield_g: number; time_s: number; mark_active?: boolean;
};

export const api = {
  dashboard: () => get<Dashboard>('/dashboard'),
  status: () => get<AppStatus>('/status'),
  coffees: (status?: string) => get<CoffeeSummary[]>(`/coffees${status ? `?status=${status}` : ''}`),
  coffee: (id: number) => get<CoffeeDetail>(`/coffees/${id}`),
  createCoffee: (c: CoffeeInput) => post<Coffee>('/coffees', c),
  updateCoffee: (id: number, c: CoffeeInput) => patch<Coffee>(`/coffees/${id}`, c),

  suggestRecipe: (coffeeId: number, useAi = false) => post<Recipe & { ai_note?: string }>(`/coffees/${coffeeId}/recipes/suggest`, { use_ai: useAi }),
  createRecipe: (coffeeId: number, r: { params: RecipeParams; rationale?: string | null; source?: 'user' | 'packaging'; stated_ratio?: number | null; activate?: boolean }) =>
    post<Recipe & { ratio_check: RatioCheck }>(`/coffees/${coffeeId}/recipes`, r),
  activateRecipe: (id: number) => post<Recipe>(`/recipes/${id}/activate`),

  shots: (unassigned = false) => get<Shot[]>(`/shots${unassigned ? '?unassigned=1' : ''}`),
  shot: (id: number) => get<Shot>(`/shots/${id}`),
  logShot: (s: ShotInput) => post<{ shot: Shot; advice: Advice }>('/shots', s),
  updateShot: (id: number, s: Partial<ShotInput> & { coffee_id?: number | null }) => patch<Shot>(`/shots/${id}`, s),
  advice: (id: number, useAi = false) => post<{ advice: Advice; ai_note?: string }>(`/shots/${id}/advice`, { use_ai: useAi }),
  applyAdvice: (id: number) => post<Recipe>(`/shots/${id}/apply-advice`),

  uploadImage: (file: Blob, imageType: CoffeeImage['image_type'], coffeeId?: number) => {
    const form = new FormData();
    form.append('file', file, 'photo.jpg');
    form.append('image_type', imageType);
    if (coffeeId) form.append('coffee_id', String(coffeeId));
    return post<CoffeeImage>('/images', form);
  },
  deleteImage: (id: number) => request<void>('DELETE', `/images/${id}`),

  readBag: (imageIds: number[], text?: string) => post<PackagingDraft>('/ai/extract-packaging', { image_ids: imageIds, text: text ?? null }),
  describeBeans: (imageId: number) => post<{ observation: BeanObservation; image: CoffeeImage }>('/ai/analyze-beans', { image_id: imageId }),

  settings: () => get<{ brew_preferences: BrewPreferences }>('/settings'),
  saveSettings: (p: BrewPreferences) => put<{ brew_preferences: BrewPreferences }>('/settings', p),
  equipment: () => get<Equipment[]>('/equipment'),
  compare: (ids: number[]) => get<{ items: Array<CoffeeSummary & { stats: CoffeeStats }>; highlights: ReturnType<typeof compareHighlights> }>(`/compare?ids=${ids.join(',')}`),
};
