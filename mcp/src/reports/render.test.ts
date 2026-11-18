import { describe, it, expect } from 'vitest'
import { escapeHtml, renderMarkdown, renderData, renderChart, renderReport, humanize, MAX_TABLE_ROWS } from './render.js'

const XSS = '<script>alert(1)</script>'

describe('escapeHtml', () => {
  it('escapes the five HTML-special characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })
})

describe('renderMarkdown (safe subset)', () => {
  it('renders headings below h2, paragraphs, lists, bold, italic and code', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and *it* and `x<y`.\n\n- one\n- two\n\n1. first\n2. second')
    expect(html).toContain('<h3>Title</h3>')
    expect(html).toContain('<p>Some <strong>bold</strong> and <em>it</em> and <code>x&lt;y</code>.</p>')
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>')
  })

  it('escapes raw HTML instead of passing it through', () => {
    const html = renderMarkdown(`Hello ${XSS} <img src=x onerror=alert(1)>`)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('links only http(s) URLs, with rel=noopener, and keeps emphasis out of hrefs', () => {
    const html = renderMarkdown('[ok](https://example.com/a_b_c) [bad](javascript:alert(1)) [data](data:text/html,x)')
    expect(html).toContain('<a href="https://example.com/a_b_c" rel="noopener noreferrer nofollow">ok</a>')
    expect(html).not.toContain('href="javascript')
    expect(html).not.toContain('href="data')
    expect(html).toContain('[bad](javascript:alert(1))')
  })

  it('cannot break out of an href with quotes', () => {
    const html = renderMarkdown('[x](https://example.com/"onmouseover="alert(1))')
    expect(html).not.toMatch(/href="[^"]*"onmouseover/)
  })
})

describe('renderData', () => {
  it('renders arrays of objects as a table with humanized headers and formatted numbers', () => {
    const html = renderData([
      { page: '/a', clicks: 1234, ctr: 0.12345, ok: true },
      { page: '/b', clicks: 5, extra: null },
    ])
    expect(html).toContain('<th scope="col">Page</th>')
    expect(html).toContain('<th scope="col">Extra</th>')
    expect(html).toContain('1,234')
    expect(html).toContain('0.1235')
    expect(html).toContain('<td>yes</td>')
    expect(html).toContain('—')
  })

  it('caps rows and says so', () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS + 5 }, (_, i) => ({ i }))
    const html = renderData(rows)
    expect(html.match(/<tr>/g)?.length).toBe(MAX_TABLE_ROWS + 1) // + header row
    expect(html).toContain(`Showing 200 of 205 rows.`)
  })

  it('renders objects as key/value tables, nesting objects', () => {
    const html = renderData({ total_clicks: 10, coverage: { matched: 3, unmatched: 1 } })
    expect(html).toContain('<th scope="row">Total clicks</th>')
    expect(html).toContain('<th scope="row">Matched</th>')
  })

  it('escapes untrusted strings in cells, keys and links', () => {
    const html = renderData([{ [XSS]: XSS, url: `https://example.com/"><script>x</script>` }])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toMatch(/href="[^"]*"></)
  })

  it('links http(s) cells but not javascript: ones', () => {
    expect(renderData({ u: 'https://example.com/x' })).toContain('<a href="https://example.com/x"')
    expect(renderData({ u: 'javascript:alert(1)' })).not.toContain('<a ')
  })
})

describe('renderChart', () => {
  it('draws proportional bars and escapes labels', () => {
    const html = renderChart({ title: 'Clicks', unit: 'clicks', labels: ['a', XSS], values: [50, 100] })
    expect(html).toContain('width:50%')
    expect(html).toContain('width:100%')
    expect(html).toContain('100 clicks')
    expect(html).not.toContain('<script>')
  })
  it('handles all-zero and non-finite values', () => {
    expect(renderChart({ labels: ['a'], values: [0] })).toContain('width:0%')
    expect(renderChart({ labels: ['a'], values: [Number.NaN] })).toContain('width:0%')
  })
})

describe('renderReport', () => {
  const html = renderReport({
    title: `Monthly ${XSS}`,
    site: 'example.com',
    generated_at: '2026-01-31T12:00:00.000Z',
    template: 'monthly_seo_checkin',
    sections: [
      { heading: 'Notes', markdown: 'All **good**.' },
      { heading: 'Not yet', not_run: { tool: 'rank_tracker_get', instructions: 'Run the tracker.' } },
    ],
  })

  it('is a complete, self-contained document with no scripts or remote loads', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta name="viewport"')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('prefers-color-scheme: dark')
    expect(html).not.toMatch(/<script|<link |src="http|url\(http/i)
  })

  it('escapes the title and shows metadata and not-run notices', () => {
    expect(html).toContain('<title>Monthly &lt;script&gt;alert(1)&lt;/script&gt;</title>')
    expect(html).toContain('example.com · 2026-01-31 · template monthly_seo_checkin')
    expect(html).toContain('<strong>Not run.</strong> Run the tracker. Run <code>rank_tracker_get</code>')
  })
})

describe('humanize', () => {
  it('turns keys into labels', () => {
    expect(humanize('key_event_rate')).toBe('Key event rate')
    expect(humanize('dataThrough')).toBe('Data Through')
  })
})
