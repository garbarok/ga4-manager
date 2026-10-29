#!/usr/bin/env tsx
/**
 * Batch-grant Viewer access to a GA4 service account across multiple properties.
 *
 * Usage:
 *   npx tsx scripts/provision-ga4-access.ts \
 *     --sa-email "sa@project.iam.gserviceaccount.com" \
 *     123456789 987654321
 *
 *   npx tsx scripts/provision-ga4-access.ts \
 *     --sa-email "sa@project.iam.gserviceaccount.com" \
 *     --properties-file properties.txt
 *
 * The --sa-email flag is optional: when omitted the email is read from
 * $GOOGLE_APPLICATION_CREDENTIALS automatically.
 *
 * Docs: mcp/PERMISSIONS.md — Batch Onboarding
 */

import { readFileSync } from 'fs'
import { GoogleAuth } from 'google-auth-library'

const GA4_ADMIN_BASE = 'https://analyticsadmin.googleapis.com/v1alpha'
const VIEWER_ROLE = 'predefinedRoles/viewer'

// ── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  saEmail: string | null
  propertyIds: string[]
} {
  const args = argv.slice(2)
  let saEmail: string | null = null
  let propertiesFile: string | null = null
  const propertyIds: string[] = []

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sa-email' && args[i + 1]) {
      saEmail = args[++i]
    } else if (args[i] === '--properties-file' && args[i + 1]) {
      propertiesFile = args[++i]
    } else if (!args[i].startsWith('--')) {
      // Strip "properties/" prefix if present
      propertyIds.push(args[i].replace(/^properties\//, ''))
    }
  }

  if (propertiesFile) {
    const lines = readFileSync(propertiesFile, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
    for (const line of lines) {
      propertyIds.push(line.replace(/^properties\//, ''))
    }
  }

  return { saEmail, propertyIds }
}

// ── Service account email resolution ────────────────────────────────────────

function resolveServiceAccountEmail(): string {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credsPath) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS is not set. ' +
        'Set it or pass --sa-email explicitly.',
    )
  }
  const creds = JSON.parse(readFileSync(credsPath, 'utf8')) as {
    client_email?: string
  }
  if (!creds.client_email) {
    throw new Error(
      `No client_email found in ${credsPath}. ` +
        'Pass --sa-email explicitly.',
    )
  }
  return creds.client_email
}

// ── GA4 API call ─────────────────────────────────────────────────────────────

async function grantViewerAccess(
  accessToken: string,
  propertyId: string,
  saEmail: string,
): Promise<void> {
  const url = `${GA4_ADMIN_BASE}/properties/${propertyId}/accessBindings`
  const body = JSON.stringify({
    user: saEmail,
    roles: [VIEWER_ROLE],
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    let detail: string
    try {
      const json = JSON.parse(text) as { error?: { message?: string } }
      detail = json.error?.message ?? text
    } catch {
      detail = text
    }
    throw new Error(`HTTP ${res.status}: ${detail}`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { saEmail: rawSaEmail, propertyIds } = parseArgs(process.argv)

  if (propertyIds.length === 0) {
    console.error(
      'No property IDs provided.\n\n' +
        'Usage:\n' +
        '  npx tsx scripts/provision-ga4-access.ts \\\n' +
        '    --sa-email "sa@project.iam.gserviceaccount.com" \\\n' +
        '    123456789 987654321\n\n' +
        'Or read from file:\n' +
        '  npx tsx scripts/provision-ga4-access.ts \\\n' +
        '    --sa-email "sa@project.iam.gserviceaccount.com" \\\n' +
        '    --properties-file properties.txt',
    )
    process.exit(1)
  }

  const saEmail = rawSaEmail ?? resolveServiceAccountEmail()

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/analytics.manage.users'],
  })
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken = tokenResponse.token
  if (!accessToken) {
    throw new Error('Failed to obtain access token from google-auth-library.')
  }

  console.log(`Granting Viewer access to: ${saEmail}\n`)

  let succeeded = 0
  let failed = 0

  for (const propertyId of propertyIds) {
    try {
      await grantViewerAccess(accessToken, propertyId, saEmail)
      console.log(`  ✓ properties/${propertyId} — access granted`)
      succeeded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  ✗ properties/${propertyId} — ${msg}`)
      failed++
    }
  }

  console.log(`\nSummary: ${succeeded} succeeded, ${failed} failed`)

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
