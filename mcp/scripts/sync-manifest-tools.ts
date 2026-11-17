/**
 * Rewrite manifest.json "tools" from the registry so the .mcpb listing never
 * lags behind the server (registry.test.ts checks they match).
 *   pnpm exec tsx scripts/sync-manifest-tools.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { SPECS } from '../src/registry.js'

const path = new URL('../manifest.json', import.meta.url)
const manifest = JSON.parse(readFileSync(path, 'utf8'))
const previous = new Map<string, string>((manifest.tools ?? []).map((t: { name: string; description: string }) => [t.name, t.description]))
manifest.tools = SPECS.map((s) => ({ name: s.tool.name, description: previous.get(s.tool.name) ?? s.tool.annotations?.title ?? s.tool.name }))
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
console.error(`manifest.json: ${manifest.tools.length} tools`)
