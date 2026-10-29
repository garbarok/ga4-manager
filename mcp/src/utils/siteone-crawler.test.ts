import { describe, it, expect } from 'vitest'
import { writeFile, access } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  buildCrawlerArgs,
  discoverWithSiteOne,
  parseSiteOneReport,
  type CrawlerRunner,
} from './siteone-crawler.js'
import { ToolError, ErrorCode } from './errors.js'

// Shape per SiteOne docs/JSON-OUTPUT.md: results[].status is a string, type 1 = HTML.
const REPORT = {
  crawler: { name: 'SiteOne Crawler' },
  results: [
    { url: 'https://example.com/', status: '200', type: 1 },
    { url: 'https://example.com/about', status: '200', type: 1 },
    { url: 'https://example.com/style.css', status: '200', type: 3 },
    { url: 'https://example.com/logo.png', status: '200', type: 4 },
    { url: 'https://example.com/old', status: '301', type: 1 },
    { url: 'https://example.com/gone', status: '404', type: 1 },
    { url: 'https://example.com/boom', status: '503', type: 1 },
  ],
  tables: {
    redirects: [
      { statusCode: 301, url: 'https://example.com/old', targetUrl: 'https://example.com/about', sourceUqId: 'a1' },
    ],
    '404': [{ statusCode: 404, url: 'https://example.com/gone', sourceUqId: 'a2' }],
  },
}

/** Fake runner: records the call and writes the fixture where --output-json-file points. */
function fakeRunner(report: unknown, exitCode = 0) {
  const calls: { binary: string; args: string[]; cwd?: string }[] = []
  const runner: CrawlerRunner = async (binary, args, opts) => {
    calls.push({ binary, args, cwd: opts.cwd })
    const flag = args.find((a) => a.startsWith('--output-json-file='))
    if (flag && report !== undefined) {
      await writeFile(flag.slice('--output-json-file='.length), typeof report === 'string' ? report : JSON.stringify(report))
    }
    return { exitCode, stderr: '' }
  }
  return { runner, calls }
}

describe('parseSiteOneReport', () => {
  it('splits HTML 200s, broken links and redirects', () => {
    const out = parseSiteOneReport(JSON.stringify(REPORT))
    expect(out.html_urls).toEqual(['https://example.com/', 'https://example.com/about'])
    expect(out.broken_links).toEqual([
      { url: 'https://example.com/gone', status: 404 },
      { url: 'https://example.com/boom', status: 503 },
    ])
    expect(out.redirects).toEqual([
      { url: 'https://example.com/old', target_url: 'https://example.com/about', status: 301 },
    ])
  })

  it('tolerates wrapped tables and a missing tables key', () => {
    const wrapped = parseSiteOneReport(
      JSON.stringify({ results: [], tables: { redirects: { rows: [{ statusCode: '302', url: 'https://e.com/a', targetUrl: 'https://e.com/b' }] } } }),
    )
    expect(wrapped.redirects).toEqual([{ url: 'https://e.com/a', target_url: 'https://e.com/b', status: 302 }])
    expect(parseSiteOneReport('{}')).toEqual({ html_urls: [], broken_links: [], redirects: [] })
  })

  it('rejects unreadable JSON', () => {
    expect(() => parseSiteOneReport('not json')).toThrow(ToolError)
    expect(() => parseSiteOneReport('[]')).toThrow(ToolError)
  })
})

describe('discoverWithSiteOne', () => {
  it('runs the binary with the documented flags and parses the report', async () => {
    const { runner, calls } = fakeRunner(REPORT)
    const out = await discoverWithSiteOne('https://example.com/', 25, {
      runner,
      resolveBinary: async () => '/usr/local/bin/siteone-crawler',
    })

    expect(out.html_urls).toHaveLength(2)
    expect(calls).toHaveLength(1)
    expect(calls[0].binary).toBe('/usr/local/bin/siteone-crawler')
    expect(calls[0].args).toContain('--url=https://example.com/')
    expect(calls[0].args).toContain('--max-visited-urls=25')
    expect(calls[0].args).toContain('--output=json')
    expect(calls[0].args).toContain('--no-cache')
    expect(calls[0].args).toContain('--output-html-report=')
    expect(calls[0].args).toContain('--output-text-file=')
    const jsonFlag = calls[0].args.find((a) => a.startsWith('--output-json-file='))!
    expect(calls[0].cwd).toBe(dirname(jsonFlag.slice('--output-json-file='.length)))
    expect(buildCrawlerArgs('https://x.com/', 1, '/tmp/o.json')).toContain('--output-json-file=/tmp/o.json')
  })

  it('fails with an install hint when the binary is missing, without running anything', async () => {
    const { runner, calls } = fakeRunner(REPORT)
    const err = await discoverWithSiteOne('https://example.com/', 25, {
      runner,
      resolveBinary: async () => null,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ToolError)
    expect((err as ToolError).code).toBe(ErrorCode.NOT_FOUND)
    expect((err as ToolError).hint).toContain('https://github.com/janreges/siteone-crawler')
    expect(calls).toHaveLength(0)
  })

  it('accepts exit code 10 (CI gate) when a report was written', async () => {
    const { runner } = fakeRunner(REPORT, 10)
    const out = await discoverWithSiteOne('https://example.com/', 25, { runner, resolveBinary: async () => '/bin/sc' })
    expect(out.html_urls).toHaveLength(2)
  })

  it('errors when the crawler wrote no report', async () => {
    const { runner } = fakeRunner(undefined, 1)
    await expect(
      discoverWithSiteOne('https://example.com/', 25, { runner, resolveBinary: async () => '/bin/sc' }),
    ).rejects.toThrow(/no JSON report/)
  })

  it('wraps a runner crash in a ToolError', async () => {
    const runner: CrawlerRunner = async () => {
      throw new Error('spawn EACCES')
    }
    await expect(
      discoverWithSiteOne('https://example.com/', 25, { runner, resolveBinary: async () => '/bin/sc' }),
    ).rejects.toThrow(/failed to run: spawn EACCES/)
  })

  it.each([
    ['rejects', 'crawl timed out after 90s; lower max_urls'],
    ['throws a timeout error', 'timed out'],
  ])('removes the temp dir when the runner %s', async (_label, message) => {
    let dir = ''
    const runner: CrawlerRunner = async (_b, args) => {
      dir = dirname(args.find((a) => a.startsWith('--output-json-file='))!.slice('--output-json-file='.length))
      throw new Error(message)
    }
    await expect(
      discoverWithSiteOne('https://example.com/', 25, { runner, resolveBinary: async () => '/bin/sc' }),
    ).rejects.toThrow(/failed to run: .*(timed out)/)
    await expect(access(dir)).rejects.toThrow()
  })
})
