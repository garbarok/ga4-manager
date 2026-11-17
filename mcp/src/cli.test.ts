import { describe, it, expect } from 'vitest'
import { parseToolArgs, helpFor, main, toolName, UsageError, EXIT_OK, EXIT_USAGE } from './cli.js'
import { SPECS, SPEC_BY_NAME } from './registry.js'
import type { ToolDef } from './tool-spec.js'

const TOOL: ToolDef = {
  name: 'demo_tool',
  description: 'Demo',
  inputSchema: {
    type: 'object',
    required: ['site'],
    properties: {
      site: { type: 'string' },
      max_pages: { type: 'number' },
      render_js: { type: 'boolean' },
      keywords: { type: 'array', items: { type: 'string' } },
      changes: { type: 'array', items: { type: 'object' } },
      filters: { type: 'object' },
    },
  },
}

function sink() {
  let text = ''
  return { stream: { write: (s: string) => ((text += s), true) } as unknown as NodeJS.WriteStream, text: () => text }
}

describe('parseToolArgs', () => {
  it('coerces flags with the input schema, accepting dashes', () => {
    expect(
      parseToolArgs(TOOL, ['--site', 'example.com', '--max-pages', '50', '--render-js', '--keywords', 'a,b', '--keywords', 'c', '--filters', '{"x":1}']),
    ).toEqual({ site: 'example.com', max_pages: 50, render_js: true, keywords: ['a', 'b', 'c'], filters: { x: 1 } })
  })
  it('supports --flag=value, explicit false, JSON arrays and --input', () => {
    expect(parseToolArgs(TOOL, ['--render-js=false', '--keywords=["a,b"]', '--input', '{"site":"x.com"}'])).toEqual({
      render_js: false,
      keywords: ['a,b'],
      site: 'x.com',
    })
    expect(parseToolArgs(TOOL, ['--changes', '[{"url":"/a"}]'])).toEqual({ changes: [{ url: '/a' }] })
  })
  it('rejects unknown flags and bad numbers', () => {
    expect(() => parseToolArgs(TOOL, ['--nope', 'x'])).toThrow(UsageError)
    expect(() => parseToolArgs(TOOL, ['--max-pages', 'many'])).toThrow(/expects a number/)
    expect(() => parseToolArgs(TOOL, ['positional'])).toThrow(/Unexpected argument/)
  })
})

describe('help and main', () => {
  it('help lists flags with requirement and defaults', () => {
    const text = helpFor(TOOL)
    expect(text).toContain('--site <string> (required)')
    expect(text).toContain('--max-pages <number>')
  })

  it('every registered tool is reachable from the CLI by its dashed name (parity)', () => {
    for (const spec of SPECS) {
      expect(SPEC_BY_NAME.get(toolName(spec.tool.name.replace(/_/g, '-')))).toBe(spec)
    }
  })

  it('list, unknown tool and usage exit codes', async () => {
    const out = sink()
    const err = sink()
    expect(await main(['list'], out.stream, err.stream)).toBe(EXIT_OK)
    expect(out.text()).toContain('server-info')
    expect(await main(['no-such-tool'], out.stream, err.stream)).toBe(EXIT_USAGE)
    expect(err.text()).toContain('Unknown command or tool')
  })

  it('runs a tool and prints its JSON result', async () => {
    const out = sink()
    expect(await main(['server-info'], out.stream, sink().stream)).toBe(EXIT_OK)
    expect(JSON.parse(out.text())).toMatchObject({ success: true, name: 'ga4-manager' })
  })
})
