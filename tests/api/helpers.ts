import { exports } from 'cloudflare:workers';

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await (exports as any).default.fetch(new Request(`https://shotlog.test/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }));
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, data };
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const patch = <T = any>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const put = <T = any>(p: string, b: unknown) => api<T>('PUT', p, b);
