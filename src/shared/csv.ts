// Minimal RFC 4180 CSV writer (quotes fields with commas, quotes or newlines).

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const cell = (v: unknown) => {
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join('; ') : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
