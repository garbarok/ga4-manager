# Cloud sessions

How to run the GA4 Manager MCP server in [Claude Code cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web) (claude.ai/code, `claude --cloud`, scheduled cloud tasks), where there is no local key file or `~/.claude.json`.

Nothing in this repository points at an account. The server reads every credential and key from the environment of whoever runs it. Forks and clones bring their own.

## Overview

A cloud session starts from a fresh VM with your repository cloned. It needs four things:

| What | Where it goes |
|---|---|
| The `ga4` binary and the MCP package | The environment's **setup script** (cached between sessions) |
| Google credentials and API keys | The environment's **environment variables** |
| The MCP server definition | A `.mcp.json` committed to the site's repository |
| Site configs and state (project context, research log, audits) | Committed to the site's repository, if it is private |

## 1. Setup script

In claude.ai/code, edit the environment, open **Setup script** and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/garbarok/ga4-manager/main/scripts/cloud-setup.sh | bash
```

[`scripts/cloud-setup.sh`](../scripts/cloud-setup.sh) installs `ga4` into `/usr/local/bin`, from the GitHub release and checked against `checksums.txt`. If that download is blocked, it builds the binary with `go install`. It also installs the latest `ga4-manager-mcp` globally. To pin a version, put `GA4M_VERSION=5.0.1` before `bash`.

Setup scripts run before the environment variables are set, so the script reads no secrets. A fork that publishes its own releases sets `GA4M_REPO`, `GA4M_NPM_PACKAGE` and `GA4M_GO_MODULE`.

## 2. Credentials and keys

Add these as the environment's **environment variables** (`.env` format, one per line):

```text
GA4_CREDENTIALS_B64=<base64 of a Google credential JSON>
GOOGLE_CLOUD_PROJECT=<your GCP project id>
GA4M_MAX_SPEND_USD=2
# Optional, per provider:
DATAFORSEO_USERNAME=<login>
DATAFORSEO_PASSWORD=<password>
PSI_API_KEY=<key>
VALUESERP_API_KEY=<key>
CF_ACCOUNT_ID=<id>
CF_API_TOKEN=<token>
```

`GA4_CREDENTIALS_B64` exists because cloud sessions have no key file:

- At startup, the server (and `ga4m`) decodes the value into a private file (mode 600) under the system temp directory and points `GOOGLE_APPLICATION_CREDENTIALS` at it.
- A `GOOGLE_APPLICATION_CREDENTIALS` that already names a readable file wins.
- A malformed value is reported on stderr and ignored. `server_info` then shows the credentials as not set.

Encode a key file without line breaks:

```bash
base64 < key.json | tr -d '\n'
```

**Use a dedicated service account, not your personal login.**

- Environment variables are readable by anyone who can use the environment, and by any command a session runs. Keep these values in an environment only you use.
- A service-account key can be scoped and revoked on its own. An ADC `authorized_user` file (`~/.config/gcloud/application_default_credentials.json`) carries a refresh token for your whole Google account.
- Give the service account read access only where it is needed. In Search Console, add its email as a user on each property. In GA4, give it the Viewer role.
- For sessions that should never change anything, add `GA4M_READ_ONLY=1`.

## 3. Network access

The default **Limited** access with **Allow package managers** already reaches the setup script's hosts and every Google API (`*.googleapis.com`). Add the hosts of the providers you use under **Allowed domains**, plus the sites you crawl or audit:

```text
api.dataforseo.com
api.valueserp.com
api.cloudflare.com
api.indexnow.org
example.com
*.example.com
```

## 4. The site repository

Commit a `.mcp.json` at the root of the repository the session works in:

```json
{
  "mcpServers": {
    "ga4-manager": {
      "command": "npx",
      "args": ["-y", "ga4-manager-mcp"],
      "env": {
        "GA4M_CONFIG_DIR": "seo",
        "GA4M_STATE_DIR": "seo/.ga4-state"
      }
    }
  }
}
```

- The server inherits the session's environment variables, so `.mcp.json` holds no secrets.
- Relative paths are resolved from the repository root. With these two values, the site config lives in `seo/<site>.yaml` and the state in `seo/.ga4-state/`.
- A local MCP entry with the same name (added with `claude mcp add`) takes precedence on your own machine. Give it the same two paths if local and cloud sessions should share state.

**Commit state only to a private repository.** `seo/.ga4-state/` holds the project context, the research log of paid lookups with their costs, audits and reports. In a public repository, add `seo/.ga4-state/` to `.gitignore`. That keeps state on the VM only, and it is lost when the VM is reclaimed.

## 5. Check it

In a new cloud session, ask Claude to run `server_info`. It should report:

- the server and `ga4` versions;
- credentials `readable`;
- the tool groups you configured as enabled.
