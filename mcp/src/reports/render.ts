/**
 * Self-contained HTML rendering for saved reports (item 8). Pure: no I/O.
 *
 * Tool outputs can carry untrusted text (titles and links from crawled pages,
 * AI answers, competitor names), so every value is HTML-escaped and the page
 * ships a Content-Security-Policy that forbids scripts and remote loads. The
 * page needs no JavaScript: inline CSS only, light and dark via
 * prefers-color-scheme, readable at phone width.
 */

export const MAX_TABLE_ROWS = 200
export const MAX_TABLE_COLUMNS = 12
export const MAX_CELL_CHARS = 300
const MAX_DEPTH = 3

export interface ChartSpec {
  title?: string
  unit?: string
  labels: string[]
  values: number[]
}

export interface ReportSection {
  heading: string
  markdown?: string
  data?: unknown
  chart?: ChartSpec
  /** Set for a template section that was not filled: renders a "not run" notice. */
  not_run?: { tool?: string; instructions: string }
}

export interface ReportDocument {
  title: string
  site: string
  generated_at: string
  template?: string | null
  sections: ReportSection[]
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 })

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  return numberFormat.format(n)
}

/** Readable label from a snake_case / camelCase key. */
export function humanize(key: string): string {
  const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key
}

// ============================================================================
// Markdown (safe subset)
// ============================================================================

/**
 * Inline markdown on already-escaped text: `code`, **bold**, *italic* /
 * _italic_, and [text](url) links for http(s) URLs only. Anything else stays
 * literal text.
 */
function inlineMarkdown(escaped: string): string {
  // Code spans and links become placeholders first, so emphasis rules can
  // never reach inside a code span or an href attribute.
  const held: string[] = []
  const hold = (html: string) => {
    held.push(html)
    return `\u0000${held.length - 1}\u0000`
  }
  let s = escaped.replace(/\u0000/g, '')
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => hold(`<code>${code}</code>`))
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) =>
    hold(`<a href="${url}" rel="noopener noreferrer nofollow">${text}</a>`),
  )
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => held[Number(i)])
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inlineMarkdown(escapeHtml(paragraph.join(' ')))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${list.items.map((i) => `<li>${inlineMarkdown(escapeHtml(i))}</li>`).join('')}</${tag}>`)
    }
    list = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()
      // The page title is h1 and section headings are h2, so markdown headings start at h3.
      const level = Math.min(6, heading[1].length + 2)
      out.push(`<h${level}>${inlineMarkdown(escapeHtml(heading[2]))}</h${level}>`)
      continue
    }
    const bullet = line.match(/^[-*+]\s+(.*)$/)
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = Boolean(numbered)
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1])
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  return out.join('\n')
}

// ============================================================================
// Data
// ============================================================================

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function scalarCell(v: unknown): string {
  if (v === null || v === undefined) return '<span class="muted">—</span>'
  if (typeof v === 'number') return `<span class="num">${escapeHtml(formatNumber(v))}</span>`
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'string') {
    if (/^https?:\/\/\S+$/.test(v) && v.length <= 2000) {
      return `<a href="${escapeHtml(v)}" rel="noopener noreferrer nofollow">${escapeHtml(truncate(v, MAX_CELL_CHARS))}</a>`
    }
    return escapeHtml(truncate(v, MAX_CELL_CHARS))
  }
  if (Array.isArray(v) && v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x))) {
    return escapeHtml(truncate(v.map((x) => (typeof x === 'number' ? formatNumber(x) : String(x))).join(', '), MAX_CELL_CHARS))
  }
  return `<code>${escapeHtml(truncate(JSON.stringify(v), MAX_CELL_CHARS))}</code>`
}

function truncationNote(shown: number, total: number, what: string): string {
  return total > shown ? `<p class="note">Showing ${formatNumber(shown)} of ${formatNumber(total)} ${what}.</p>` : ''
}

function tableFromObjects(rows: Record<string, unknown>[]): string {
  const columns: string[] = []
  for (const row of rows) {
    for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k)
  }
  const shownCols = columns.slice(0, MAX_TABLE_COLUMNS)
  const shownRows = rows.slice(0, MAX_TABLE_ROWS)
  const head = shownCols.map((c) => `<th scope="col">${escapeHtml(humanize(c))}</th>`).join('')
  const body = shownRows.map((r) => `<tr>${shownCols.map((c) => `<td>${scalarCell(r[c])}</td>`).join('')}</tr>`).join('\n')
  return (
    `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>` +
    truncationNote(shownRows.length, rows.length, 'rows') +
    truncationNote(shownCols.length, columns.length, 'columns')
  )
}

export function renderData(value: unknown, depth = 0): string {
  if (value === null || value === undefined || typeof value !== 'object') {
    return `<p>${scalarCell(value)}</p>`
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '<p class="muted">No rows.</p>'
    if (value.every(isPlainObject)) return tableFromObjects(value as Record<string, unknown>[])
    const items = value.slice(0, MAX_TABLE_ROWS)
    const list = items
      .map((v) => `<li>${isPlainObject(v) || Array.isArray(v) ? (depth < MAX_DEPTH ? renderData(v, depth + 1) : scalarCell(v)) : scalarCell(v)}</li>`)
      .join('')
    return `<ul>${list}</ul>${truncationNote(items.length, value.length, 'items')}`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return '<p class="muted">Empty.</p>'
  const rows = entries
    .map(([k, v]) => {
      const nested = (isPlainObject(v) && Object.keys(v).length > 0) || (Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object'))
      const cell = nested && depth < MAX_DEPTH ? renderData(v, depth + 1) : scalarCell(v)
      return `<tr><th scope="row">${escapeHtml(humanize(k))}</th><td>${cell}</td></tr>`
    })
    .join('\n')
  return `<div class="table-wrap"><table class="kv"><tbody>\n${rows}\n</tbody></table></div>`
}

// ============================================================================
// Chart
// ============================================================================

/** Horizontal bars as plain HTML/CSS: no script, no SVG text to escape twice. */
export function renderChart(chart: ChartSpec): string {
  const n = Math.min(chart.labels.length, chart.values.length, 100)
  const values = chart.values.slice(0, n).map((v) => (Number.isFinite(v) ? v : 0))
  const max = Math.max(0, ...values.map((v) => Math.abs(v)))
  const unit = chart.unit ? ` ${escapeHtml(chart.unit)}` : ''
  const bars = values
    .map((v, i) => {
      const pct = max > 0 ? Math.round((Math.abs(v) / max) * 1000) / 10 : 0
      return (
        `<div class="bar-row"><span class="bar-label">${escapeHtml(truncate(String(chart.labels[i]), 120))}</span>` +
        `<span class="bar-track"><span class="bar${v < 0 ? ' neg' : ''}" style="width:${pct}%"></span></span>` +
        `<span class="bar-value num">${escapeHtml(formatNumber(v))}${unit}</span></div>`
      )
    })
    .join('\n')
  const title = chart.title ? `<figcaption>${escapeHtml(chart.title)}</figcaption>` : ''
  return `<figure class="chart">${title}\n${bars || '<p class="muted">No data.</p>'}\n</figure>`
}

// ============================================================================
// Document
// ============================================================================

const CSS = `
:root{--bg:#ffffff;--fg:#1d1f23;--muted:#5f6670;--line:#e2e5ea;--panel:#f6f7f9;--accent:#2f6fde;--bar:#2f6fde;--neg:#c2410c;--warn-bg:#fff7e6;--warn-line:#f0c36d}
@media (prefers-color-scheme: dark){:root{--bg:#121417;--fg:#e8eaed;--muted:#a0a6ae;--line:#2c3036;--panel:#1b1e22;--accent:#7aa7ff;--bar:#7aa7ff;--neg:#fb923c;--warn-bg:#2b2416;--warn-line:#7a5c1f}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}
header{border-bottom:1px solid var(--line);margin-bottom:24px;padding-bottom:12px}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 6px}
h2{font-size:1.2rem;margin:32px 0 12px}
h3,h4,h5,h6{font-size:1rem;margin:20px 0 8px}
.meta,.muted,.note{color:var(--muted)}
.note{font-size:.85rem;margin:6px 0 0}
a{color:var(--accent);overflow-wrap:anywhere}
code{font:.85em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--panel);padding:1px 4px;border-radius:4px;overflow-wrap:anywhere}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;vertical-align:top;padding:6px 10px;border-bottom:1px solid var(--line)}
thead th{background:var(--panel);font-weight:600;white-space:nowrap}
table.kv th{width:30%;background:var(--panel);font-weight:600}
tr:last-child td,tr:last-child th{border-bottom:0}
td .table-wrap{border:0}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.notice{background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px;padding:10px 12px}
figure.chart{margin:0;padding:12px;border:1px solid var(--line);border-radius:8px}
figcaption{font-weight:600;margin-bottom:8px}
.bar-row{display:grid;grid-template-columns:minmax(80px,30%) 1fr auto;gap:8px;align-items:center;margin:4px 0;font-size:.9rem}
.bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{background:var(--panel);border-radius:4px;height:12px;overflow:hidden}
.bar{display:block;height:100%;background:var(--bar)}
.bar.neg{background:var(--neg)}
footer{margin-top:40px;color:var(--muted);font-size:.8rem;border-top:1px solid var(--line);padding-top:12px}
@media (max-width:560px){.bar-row{grid-template-columns:1fr auto}.bar-track{grid-column:1/-1;order:3}}
`

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"

export function renderSection(section: ReportSection): string {
  const parts = [`<h2>${escapeHtml(section.heading)}</h2>`]
  if (section.not_run) {
    const tool = section.not_run.tool ? ` Run <code>${escapeHtml(section.not_run.tool)}</code> and save again.` : ''
    parts.push(`<div class="notice"><strong>Not run.</strong> ${escapeHtml(section.not_run.instructions)}${tool}</div>`)
  }
  if (section.markdown) parts.push(renderMarkdown(section.markdown))
  if (section.chart) parts.push(renderChart(section.chart))
  if (section.data !== undefined) parts.push(renderData(section.data))
  return `<section>\n${parts.join('\n')}\n</section>`
}

export function renderReport(doc: ReportDocument): string {
  const date = doc.generated_at.slice(0, 10)
  const meta = [escapeHtml(doc.site), escapeHtml(date), doc.template ? `template ${escapeHtml(doc.template)}` : null]
    .filter(Boolean)
    .join(' · ')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(doc.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(doc.title)}</h1>
<p class="meta">${meta}</p>
</header>
${doc.sections.map(renderSection).join('\n')}
<footer>Generated by GA4 Manager on ${escapeHtml(doc.generated_at)}. Self-contained file: no scripts, no remote resources.</footer>
</main>
</body>
</html>
`
}
