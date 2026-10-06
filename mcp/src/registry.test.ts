import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SPECS, SPEC_BY_NAME } from './registry.js';

// These assertions exercise the registry seam directly — the wiring that used
// to live inside index.ts and was only reachable at runtime. A miswired tool
// (missing command, wrong kind, missing annotations) now fails here.
describe('tool registry', () => {
  it('registers 40 tools with unique names', () => {
    const names = SPECS.map((s) => s.tool.name);
    expect(names).toHaveLength(40);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool declares a title and a behavior hint (directory-review rule)', () => {
    for (const spec of SPECS) {
      const a = spec.tool.annotations;
      expect(a?.title, `${spec.tool.name} title`).toBeTruthy();
      expect(
        a!.readOnlyHint !== undefined || a!.destructiveHint !== undefined,
        `${spec.tool.name} read/destructive hint`,
      ).toBe(true);
    }
  });

  it('CLI specs carry a command and build/parse functions', () => {
    for (const spec of SPECS) {
      if (spec.kind === 'cli') {
        expect(spec.command, `${spec.tool.name} command`).toBeTruthy();
        expect(typeof spec.buildArgs, `${spec.tool.name} buildArgs`).toBe('function');
        expect(typeof spec.parse, `${spec.tool.name} parse`).toBe('function');
      }
    }
  });

  it('native specs carry a run function', () => {
    for (const spec of SPECS) {
      if (spec.kind === 'native') {
        expect(typeof spec.run, `${spec.tool.name} run`).toBe('function');
      }
    }
  });

  it('SPEC_BY_NAME resolves every tool name to its spec', () => {
    for (const spec of SPECS) {
      expect(SPEC_BY_NAME.get(spec.tool.name)).toBe(spec);
    }
    expect(SPEC_BY_NAME.size).toBe(SPECS.length);
  });

  it('the ga4_link split is wired (no catch-all ga4_link)', () => {
    expect(SPEC_BY_NAME.has('ga4_link')).toBe(false);
    expect(SPEC_BY_NAME.get('ga4_link_list')?.tool.annotations?.readOnlyHint).toBe(true);
    expect(SPEC_BY_NAME.get('ga4_link_remove')?.tool.annotations?.destructiveHint).toBe(true);
    for (const name of ['ga4_link_list', 'ga4_link_create', 'ga4_link_remove']) {
      const spec = SPEC_BY_NAME.get(name);
      expect(spec?.kind, name).toBe('cli');
      if (spec?.kind === 'cli') expect(spec.command).toBe('link');
    }
  });

  it('DataForSEO list tools bound limit (default ≤100, reject 5000 before any request)', () => {
    const required: Record<string, Record<string, unknown>> = {
      llm_mentions: { domain: 'a.com', keywords: ['x'] },
      keyword_gap: { domain: 'a.com', competitor: 'b.com' },
      ranked_keywords: { domain: 'a.com' },
      keyword_ideas: { keywords: ['x'] },
      link_gap: { domain: 'a.com', competitors: ['b.com'] },
    };
    for (const [name, base] of Object.entries(required)) {
      const schema = SPEC_BY_NAME.get(name)!.schema;
      const parsed = schema.parse(base) as { limit: number };
      expect(parsed.limit, `${name} default limit`).toBeLessThanOrEqual(100);
      expect(schema.safeParse({ ...base, limit: 5000 }).success, `${name} limit 5000`).toBe(false);
    }
  });

  it('manifest.json lists exactly the registered tools, in order', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as { tools: { name: string }[] };
    expect(manifest.tools.map((t) => t.name)).toEqual(SPECS.map((s) => s.tool.name));
  });
});
