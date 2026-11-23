// The AI output schemas must stay within what structured outputs support:
// closed objects, every property required, no numeric/string constraints.
import { describe, expect, it } from 'vitest';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { adviceSchema, beansSchema, packagingSchema, refineSchema } from '../../src/worker/ai/schemas';

const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'multipleOf'];

function walk(node: any, path: string, issues: string[]) {
  if (!node || typeof node !== 'object') return;
  for (const k of UNSUPPORTED) if (k in node) issues.push(`${path}: ${k}`);
  if (node.type === 'object') {
    if (node.additionalProperties !== false) issues.push(`${path}: additionalProperties not false`);
    const props = Object.keys(node.properties ?? {});
    const missing = props.filter((p) => !(node.required ?? []).includes(p));
    if (missing.length) issues.push(`${path}: not required: ${missing.join(',')}`);
  }
  for (const [k, v] of Object.entries(node)) {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${k}[${i}]`, issues));
    else if (typeof v === 'object') walk(v, `${path}.${k}`, issues);
  }
}

describe('AI output schemas', () => {
  it.each([['packaging', packagingSchema], ['beans', beansSchema], ['refine', refineSchema], ['advice', adviceSchema]] as const)('%s schema is structured-outputs friendly', (_name, schema) => {
    const format = betaZodOutputFormat(schema) as unknown as { type: string; schema: unknown };
    expect(format.type).toBe('json_schema');
    const issues: string[] = [];
    walk(format.schema, '$', issues);
    expect(issues).toEqual([]);
  });
});
