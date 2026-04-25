#!/usr/bin/env bash
#
# GA4 Manager — interactive setup script.
#
# What this does:
#   1. Verifies prerequisites (gcloud, jq, optional: go, node, gh).
#   2. Helps you pick an auth path (ADC user creds OR service account key).
#   3. Runs gcloud auth with the right scopes for all four APIs.
#   4. Sets the GCP quota project (required for ADC user creds).
#   5. Enables the four Google APIs the tools use.
#   6. Smoke-tests each API and reports green/red.
#   7. Prints the per-resource permission steps you still need to do
#      manually (Search Console "add user", GA4 "Property access management").
#
# This script is safe to re-run — it is idempotent for the auth + API enable
# steps and never modifies your repo.
#
# Usage:
#   ./scripts/setup.sh
#   ./scripts/setup.sh --non-interactive      (skip prompts, defaults to ADC)
#   ./scripts/setup.sh --sa-key /path/to/key.json
#
set -uo pipefail

NON_INTERACTIVE=0
SA_KEY_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --sa-key) SA_KEY_PATH="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^set -uo/p' "$0" | sed -n '/^#/p' | sed 's/^# \?//'
      exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# ── Color / format helpers ───────────────────────────────────────────────────

if [[ -t 1 ]]; then
  # ANSI-C quoting ($'...') so the variables hold real escape bytes.
  # This makes the colors work inside heredocs (cat <<EOF), not just printf.
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'
  C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_BOLD=""; C_OFF=""
fi

ok()    { printf "${C_OK}✓${C_OFF} %s\n" "$1"; }
warn()  { printf "${C_WARN}!${C_OFF} %s\n" "$1"; }
err()   { printf "${C_ERR}✗${C_OFF} %s\n" "$1" >&2; }
step()  { printf "\n${C_BOLD}── %s${C_OFF}\n" "$1"; }
dim()   { printf "${C_DIM}%s${C_OFF}\n" "$1"; }

ask() {
  # ask "Question" "default-value" → echoes user input or default
  local q="$1" def="${2:-}"
  if [[ "$NON_INTERACTIVE" == "1" ]]; then
    echo "$def"
    return
  fi
  local prompt="$q"
  [[ -n "$def" ]] && prompt="$prompt [$def]"
  read -r -p "$prompt: " ans
  echo "${ans:-$def}"
}

# ── 1. Prerequisites ─────────────────────────────────────────────────────────

step "Checking prerequisites"

REQUIRED=(gcloud jq curl)
OPTIONAL=(go node npm gh)

for tool in "${REQUIRED[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool found"
  else
    err "$tool not found in PATH (required)"
    case "$tool" in
      gcloud) dim "  Install: https://cloud.google.com/sdk/docs/install" ;;
      jq)     dim "  Install: brew install jq  (macOS)  |  apt install jq  (Linux)" ;;
      curl)   dim "  Install: brew install curl  (macOS)  |  apt install curl  (Linux)" ;;
    esac
    exit 1
  fi
done

for tool in "${OPTIONAL[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool found (optional)"
  else
    warn "$tool not found (optional — needed only for some workflows)"
  fi
done

# ── 2. Choose auth path ──────────────────────────────────────────────────────

step "Choosing authentication path"

cat <<EOF
Two paths are supported:

  ${C_BOLD}A) ADC (user credentials)${C_OFF} — easier for individual / personal use
     • Logs in as YOU via browser
     • Uses your existing GA4 / Search Console access
     • One file at ~/.config/gcloud/application_default_credentials.json
     • Recommended unless you are running in CI or sharing with a team.

  ${C_BOLD}B) Service account key${C_OFF} — needed for CI, teams, or running headless
     • Requires creating an SA + downloading JSON key
     • SA email must be added to each Search Console site / GA4 property
     • Provision script available: mcp/scripts/provision-ga4-access.ts

EOF

AUTH_PATH=""
if [[ -n "$SA_KEY_PATH" ]]; then
  AUTH_PATH="B"
elif [[ "$NON_INTERACTIVE" == "1" ]]; then
  AUTH_PATH="A"
else
  AUTH_PATH=$(ask "Pick auth path (A or B)" "A")
fi

case "$AUTH_PATH" in
  [Aa])
    AUTH_PATH="A"
    ok "Using ADC user credentials"
    ;;
  [Bb])
    AUTH_PATH="B"
    if [[ -z "$SA_KEY_PATH" ]]; then
      SA_KEY_PATH=$(ask "Path to service account JSON key" "")
    fi
    if [[ ! -r "$SA_KEY_PATH" ]]; then
      err "Cannot read SA key at: $SA_KEY_PATH"
      exit 1
    fi
    ok "Using service account key at $SA_KEY_PATH"
    ;;
  *)
    err "Unknown auth path: $AUTH_PATH"
    exit 1
    ;;
esac

# ── 3. Run the auth flow ─────────────────────────────────────────────────────

step "Running auth flow"

SCOPES="openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/analytics,https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/webmasters,https://www.googleapis.com/auth/userinfo.email"

if [[ "$AUTH_PATH" == "A" ]]; then
  ADC_FILE="$HOME/.config/gcloud/application_default_credentials.json"

  REQUIRED_SCOPES=(
    "https://www.googleapis.com/auth/cloud-platform"
    "https://www.googleapis.com/auth/analytics"
    "https://www.googleapis.com/auth/analytics.readonly"
    "https://www.googleapis.com/auth/webmasters"
  )

  # If ADC already exists, check whether its token has the required scopes
  RELOGIN=1
  if [[ -f "$ADC_FILE" ]]; then
    dim "ADC file already exists at $ADC_FILE — checking scopes..."

    # Mint a token from the existing ADC and ask Google what scopes it carries
    EXISTING_TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null || echo "")
    GRANTED_SCOPES=""
    if [[ -n "$EXISTING_TOKEN" ]]; then
      GRANTED_SCOPES=$(curl -s "https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=$EXISTING_TOKEN" \
        | jq -r '.scope // ""' 2>/dev/null || echo "")
    fi

    MISSING=()
    for scope in "${REQUIRED_SCOPES[@]}"; do
      if [[ "$GRANTED_SCOPES" != *"$scope"* ]]; then
        MISSING+=("$scope")
      fi
    done

    if [[ ${#MISSING[@]} -eq 0 ]]; then
      ok "All required scopes already granted (cloud-platform, analytics, analytics.readonly, webmasters)"
      RELOGIN=0
    else
      warn "Existing ADC is missing ${#MISSING[@]} required scope(s):"
      for s in "${MISSING[@]}"; do
        printf "    - %s\n" "$s"
      done
      if [[ "$NON_INTERACTIVE" == "1" ]]; then
        dim "Re-running login automatically (non-interactive)"
        RELOGIN=1
      else
        ans=$(ask "Re-login now to grant the missing scopes? (y/n)" "y")
        if [[ "$ans" =~ ^[Yy]$ ]]; then
          RELOGIN=1
        else
          RELOGIN=0
          warn "Continuing without re-login. Tools that need the missing scopes will fail."
          warn "Re-run setup.sh later, or run the gcloud login command manually:"
          printf "    gcloud auth application-default login --scopes=%s\n" "$SCOPES"
        fi
      fi
    fi
  fi

  if [[ "$RELOGIN" == "1" ]]; then
    dim "Browser will open. Consent the listed scopes."
    gcloud auth application-default login --scopes="$SCOPES"
  fi

  # Set quota project for ADC user creds (otherwise APIs reject as SERVICE_DISABLED)
  step "Setting GCP quota project for ADC"
  CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
  QUOTA_PROJECT=$(ask "GCP project ID for billing/quota" "$CURRENT_PROJECT")
  if [[ -z "$QUOTA_PROJECT" ]]; then
    err "Quota project required for ADC user creds"
    dim "  Find/create one at: https://console.cloud.google.com"
    exit 1
  fi
  gcloud auth application-default set-quota-project "$QUOTA_PROJECT"
  ok "Quota project set to $QUOTA_PROJECT"

  export GOOGLE_APPLICATION_CREDENTIALS="$ADC_FILE"
  export GCP_PROJECT="$QUOTA_PROJECT"

else
  gcloud auth activate-service-account --key-file="$SA_KEY_PATH"
  export GOOGLE_APPLICATION_CREDENTIALS="$SA_KEY_PATH"

  CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
  QUOTA_PROJECT=$(ask "GCP project ID for the SA" "$CURRENT_PROJECT")
  export GCP_PROJECT="$QUOTA_PROJECT"

  ok "Activated SA: $(jq -r .client_email < "$SA_KEY_PATH")"
fi

# ── 4. Enable APIs ───────────────────────────────────────────────────────────

step "Enabling required APIs in project $QUOTA_PROJECT"

APIS=(
  "analyticsdata.googleapis.com"
  "analyticsadmin.googleapis.com"
  "searchconsole.googleapis.com"
  "pagespeedonline.googleapis.com"
)

for api in "${APIS[@]}"; do
  if gcloud services list --enabled --project="$QUOTA_PROJECT" --filter="config.name:$api" --format="value(config.name)" 2>/dev/null | grep -q "$api"; then
    ok "$api already enabled"
  else
    dim "Enabling $api ..."
    if gcloud services enable "$api" --project="$QUOTA_PROJECT" 2>&1 | tail -3; then
      ok "$api enabled"
    else
      warn "$api could not be enabled — continuing (may need manual enable)"
    fi
  fi
done

# ── 5. Smoke tests ───────────────────────────────────────────────────────────

step "Smoke-testing API access"

if [[ "$AUTH_PATH" == "A" ]]; then
  TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null)
else
  TOKEN=$(gcloud auth print-access-token 2>/dev/null)
fi

if [[ -z "$TOKEN" ]]; then
  err "Could not mint access token. Re-run auth step."
  exit 1
fi

QHEADER=()
[[ "$AUTH_PATH" == "A" ]] && QHEADER=(-H "X-Goog-User-Project: $QUOTA_PROJECT")

# 5a. GA4 Admin — list account summaries
dim "GA4 Admin (analyticsadmin.googleapis.com) — listing account summaries..."
GA4_ADMIN_RES=$(curl -s -w '\n%{http_code}' "https://analyticsadmin.googleapis.com/v1beta/accountSummaries" \
  -H "Authorization: Bearer $TOKEN" \
  "${QHEADER[@]}")
GA4_ADMIN_CODE=$(echo "$GA4_ADMIN_RES" | tail -1)
GA4_ADMIN_BODY=$(echo "$GA4_ADMIN_RES" | sed '$d')

if [[ "$GA4_ADMIN_CODE" == "200" ]]; then
  COUNT=$(echo "$GA4_ADMIN_BODY" | jq -r '[.accountSummaries[]?.propertySummaries[]?] | length' 2>/dev/null || echo "?")
  ok "GA4 Admin reachable — $COUNT property summaries visible"
else
  err "GA4 Admin returned HTTP $GA4_ADMIN_CODE"
  echo "$GA4_ADMIN_BODY" | jq -r '.error.message // .' 2>/dev/null | head -3
fi

# 5b. Search Console — list sites
dim "Search Console (searchconsole.googleapis.com) — listing sites..."
GSC_RES=$(curl -s -w '\n%{http_code}' "https://www.googleapis.com/webmasters/v3/sites" \
  -H "Authorization: Bearer $TOKEN" \
  "${QHEADER[@]}")
GSC_CODE=$(echo "$GSC_RES" | tail -1)
GSC_BODY=$(echo "$GSC_RES" | sed '$d')

if [[ "$GSC_CODE" == "200" ]]; then
  COUNT=$(echo "$GSC_BODY" | jq -r '.siteEntry | length' 2>/dev/null || echo "?")
  ok "Search Console reachable — $COUNT sites visible"
else
  err "Search Console returned HTTP $GSC_CODE"
  echo "$GSC_BODY" | jq -r '.error.message // .' 2>/dev/null | head -3
fi

# 5c. PageSpeed Insights — public-domain ping (no auth needed)
dim "PageSpeed Insights (pagespeedonline.googleapis.com) — pinging..."
PSI_CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://www.google.com&strategy=mobile")
if [[ "$PSI_CODE" == "200" ]]; then
  ok "PageSpeed Insights reachable"
else
  warn "PageSpeed Insights returned HTTP $PSI_CODE (works without API key, but rate-limited)"
fi

# ── 6. Print next steps ──────────────────────────────────────────────────────

step "Next steps"

cat <<EOF
${C_BOLD}1. Per-resource permissions (manual)${C_OFF}

   ${C_BOLD}Search Console${C_OFF} — Add yourself (or the SA email) as a user on each property
       you want to query. Open https://search.google.com/search-console
       → Settings → Users and permissions → Add user.

   ${C_BOLD}GA4${C_OFF} — Add yourself (or the SA email) as Viewer on each property.
       Open https://analytics.google.com → Admin → Property access management.

   For batch GA4 onboarding, see: mcp/scripts/provision-ga4-access.ts
   See: mcp/PERMISSIONS.md  for full per-tool permission matrix.

${C_BOLD}2. Configure your MCP client${C_OFF}

   Claude Desktop / CLI / VS Code — see mcp/CONFIGURATION.md

   Minimal env vars (already set in this shell):
     GOOGLE_APPLICATION_CREDENTIALS=$GOOGLE_APPLICATION_CREDENTIALS
     GCP_PROJECT=$GCP_PROJECT

   To persist them, add to your shell rc:
     echo 'export GOOGLE_APPLICATION_CREDENTIALS=$GOOGLE_APPLICATION_CREDENTIALS' >> ~/.zshrc
     echo 'export GCP_PROJECT=$GCP_PROJECT' >> ~/.zshrc
   (Fish: 'set -Ux GOOGLE_APPLICATION_CREDENTIALS $GOOGLE_APPLICATION_CREDENTIALS')

${C_BOLD}3. Verify with the CLI${C_OFF}

   ./ga4 --version                              # binary works
   ./ga4 validate --all                         # validates every config under configs/
   ./ga4 report --config configs/<your-file>.yaml   # report from a config file
   # or after editing configs/examples/*.yaml with your real GA4 property ID:
   ./ga4 report --project basic-ecommerce

${C_BOLD}4. Common errors${C_OFF}

   See mcp/TROUBLESHOOTING.md for every error message you might see and the
   exact fix.

EOF

ok "Setup complete."
