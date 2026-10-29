#!/usr/bin/env node
// Smoke-test the npm package as users get it: pack the tarball, install it in
// an empty directory, start the server with no `ga4` binary and no credentials,
// and check tools/list, prompts/list and a CLI-backed call. Catches what the
// in-repo tests cannot see (missing files, a startup that needs the repo).
//
//   node scripts/pack-smoke.mjs        (from mcp/; run by prepublishOnly)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(MCP_DIR, 'manifest.json'), 'utf8'))
const work = mkdtempSync(join(tmpdir(), 'ga4m-pack-smoke-'))
const fail = (msg) => {
  console.error(`pack-smoke: FAIL — ${msg}`)
  process.exitCode = 1
}

try {
  const [{ filename }] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], { cwd: MCP_DIR, encoding: 'utf8' }),
  )
  writeFileSync(join(work, 'package.json'), '{"private":true}')
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--omit=dev', '--ignore-scripts', join(work, filename)], {
    cwd: work,
    stdio: 'ignore',
  })

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(work, 'node_modules', 'ga4-manager-mcp', 'dist', 'index.js')],
    // Deliberately bare: no ga4 binary, no Google or DataForSEO credentials.
    env: { PATH: dirname(process.execPath), HOME: work, GA4_BINARY_PATH: join(work, 'no-such-ga4') },
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (d) => (stderr += d))
  const client = new Client({ name: 'pack-smoke', version: '0' })
  try {
    await client.connect(transport)
  } catch (err) {
    throw new Error(`server did not start: ${err.message}\n${stderr}`)
  }

  const tools = (await client.listTools()).tools.map((t) => t.name)
  const expected = manifest.tools.map((t) => t.name)
  if (JSON.stringify(tools) !== JSON.stringify(expected)) fail(`tools/list (${tools.length}) differs from manifest.json (${expected.length})`)

  const prompts = (await client.listPrompts()).prompts
  if (prompts.length === 0) fail('prompts/list is empty')

  const cli = await client.callTool({ name: 'ga4_validate', arguments: { config_file: 'x.yaml' } })
  const text = cli.content?.[0]?.text ?? ''
  if (!cli.isError || !text.includes('GA4_BINARY_PATH')) fail(`CLI-backed tool without binary should fail with an install hint, got: ${text.slice(0, 200)}`)

  await client.close()
  if (!process.exitCode) console.log(`pack-smoke: ok — ${filename}: ${tools.length} tools, ${prompts.length} prompts, starts without the ga4 binary`)
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
} finally {
  rmSync(work, { recursive: true, force: true })
}
