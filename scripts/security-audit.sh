#!/bin/bash
# Security audit script for ga4-manager repository
# Run this before open-sourcing or before each release

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ISSUES_FOUND=0

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}GA4 Manager Security Audit${NC}"
echo -e "${BLUE}===========================================${NC}"
echo ""

# Check 1: .env in git history
echo -e "${BLUE}[1/8] Checking if .env was ever committed...${NC}"
if git log --all --full-history --oneline -- .env | grep -q .; then
    echo -e "${RED}✗ CRITICAL: .env found in git history!${NC}"
    echo "  You must remove it from history before open-sourcing."
    echo "  See SECURITY.md for instructions."
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
    echo -e "${GREEN}✓ .env has never been committed${NC}"
fi
echo ""

# Check 2: Credential files in git history
echo -e "${BLUE}[2/8] Checking for credential files in git...${NC}"
CRED_FILES=$(git log --all --full-history --name-only --pretty=format: | grep -E "credentials.*\.json$|service-account.*\.json$|.*\.pem$|.*\.key$" | sort -u || true)
if [ -n "$CRED_FILES" ]; then
    echo -e "${RED}✗ CRITICAL: Credential files found in git history!${NC}"
    echo "$CRED_FILES"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
    echo -e "${GREEN}✓ No credential files in git history${NC}"
fi
echo ""

# Check 3: Secrets in code
echo -e "${BLUE}[3/8] Scanning for hardcoded secrets in code...${NC}"
SECRET_PATTERNS=0

# Check for API keys
if git grep -inE "api[_-]?key\s*[:=]\s*['\"][a-zA-Z0-9]{20,}['\"]" -- "*.go" "*.yaml" "*.yml" "*.json" ":!.env.example" 2>/dev/null; then
    echo -e "${RED}✗ Potential API keys found${NC}"
    SECRET_PATTERNS=$((SECRET_PATTERNS + 1))
fi

# Check for passwords
if git grep -inE "password\s*[:=]\s*['\"][^'\"]{8,}['\"]" -- "*.go" ":!.env.example" 2>/dev/null; then
    echo -e "${RED}✗ Potential passwords found${NC}"
    SECRET_PATTERNS=$((SECRET_PATTERNS + 1))
fi

# Check for service account JSON structure
if git grep -inE "\"type\":\s*\"service_account\"" -- "*.go" "*.json" ":!.env.example" 2>/dev/null; then
    echo -e "${RED}✗ Service account JSON structure found${NC}"
    SECRET_PATTERNS=$((SECRET_PATTERNS + 1))
fi

# Check for hardcoded tokens
if git grep -inE "token\s*[:=]\s*['\"][a-zA-Z0-9_-]{20,}['\"]" -- "*.go" ":!.env.example" 2>/dev/null; then
    echo -e "${RED}✗ Potential tokens found${NC}"
    SECRET_PATTERNS=$((SECRET_PATTERNS + 1))
fi

if [ $SECRET_PATTERNS -eq 0 ]; then
    echo -e "${GREEN}✓ No hardcoded secrets detected${NC}"
else
    echo -e "${RED}✗ Found $SECRET_PATTERNS potential secret patterns${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi
echo ""

# Check 4: .gitignore coverage
echo -e "${BLUE}[4/8] Verifying .gitignore coverage...${NC}"
MISSING_PATTERNS=0

required_patterns=(
    ".env"
    "*.pem"
    "*.key"
    "*credentials*.json"
)

for pattern in "${required_patterns[@]}"; do
    if ! grep -q "$pattern" .gitignore; then
        echo -e "${YELLOW}⚠ Missing pattern: $pattern${NC}"
        MISSING_PATTERNS=$((MISSING_PATTERNS + 1))
    fi
done

if [ $MISSING_PATTERNS -eq 0 ]; then
    echo -e "${GREEN}✓ .gitignore has comprehensive coverage${NC}"
else
    echo -e "${YELLOW}⚠ .gitignore could be more defensive${NC}"
fi
echo ""

# Check 5: .env.example exists and is safe
echo -e "${BLUE}[5/8] Checking .env.example...${NC}"
if [ ! -f .env.example ]; then
    echo -e "${RED}✗ .env.example does not exist${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
    # Check if .env.example contains placeholders
    if grep -qE "(/path/to/|your-|example-|placeholder)" .env.example; then
        echo -e "${GREEN}✓ .env.example contains only placeholders${NC}"
    else
        echo -e "${YELLOW}⚠ .env.example might contain real values${NC}"
    fi

    # Check if .env.example is committed
    if git ls-files --error-unmatch .env.example >/dev/null 2>&1; then
        echo -e "${GREEN}✓ .env.example is committed to git${NC}"
    else
        echo -e "${YELLOW}⚠ .env.example should be committed${NC}"
    fi
fi
echo ""

# Check 6: Actual .env file safety
echo -e "${BLUE}[6/8] Checking actual .env file...${NC}"
if [ -f .env ]; then
    echo -e "${GREEN}✓ .env exists locally${NC}"

    # Verify it's in .gitignore
    if git check-ignore .env >/dev/null 2>&1; then
        echo -e "${GREEN}✓ .env is properly ignored by git${NC}"
    else
        echo -e "${RED}✗ CRITICAL: .env is NOT ignored by git!${NC}"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
    fi

    # Check file permissions
    PERMS=$(stat -f "%A" .env 2>/dev/null || stat -c "%a" .env 2>/dev/null)
    if [ "$PERMS" = "600" ] || [ "$PERMS" = "400" ]; then
        echo -e "${GREEN}✓ .env has secure permissions ($PERMS)${NC}"
    else
        echo -e "${YELLOW}⚠ .env permissions are $PERMS (recommend 600)${NC}"
        echo "  Run: chmod 600 .env"
    fi
else
    echo -e "${YELLOW}⚠ .env does not exist (OK for fresh clone)${NC}"
fi
echo ""

# Check 7: SECURITY.md exists
echo -e "${BLUE}[7/8] Checking security documentation...${NC}"
if [ -f SECURITY.md ]; then
    echo -e "${GREEN}✓ SECURITY.md exists${NC}"
else
    echo -e "${YELLOW}⚠ SECURITY.md is missing${NC}"
fi
echo ""

# Check 8: Pre-commit hook
echo -e "${BLUE}[8/8] Checking pre-commit hook...${NC}"
if [ -f .githooks/pre-commit ]; then
    echo -e "${GREEN}✓ Pre-commit hook template exists${NC}"

    if [ -x .githooks/pre-commit ]; then
        echo -e "${GREEN}✓ Pre-commit hook is executable${NC}"
    else
        echo -e "${YELLOW}⚠ Pre-commit hook is not executable${NC}"
        echo "  Run: chmod +x .githooks/pre-commit"
    fi

    if [ -f .git/hooks/pre-commit ]; then
        echo -e "${GREEN}✓ Pre-commit hook is installed${NC}"
    else
        echo -e "${YELLOW}⚠ Pre-commit hook not installed in .git/hooks/${NC}"
        echo "  Run: cp .githooks/pre-commit .git/hooks/pre-commit"
    fi
else
    echo -e "${YELLOW}⚠ Pre-commit hook template missing${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}Audit Summary${NC}"
echo -e "${BLUE}===========================================${NC}"
echo ""

if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "${GREEN}✓ No critical security issues found!${NC}"
    echo -e "${GREEN}  Repository appears ready for open-sourcing.${NC}"
    exit 0
else
    echo -e "${RED}✗ Found $ISSUES_FOUND critical security issue(s)${NC}"
    echo -e "${RED}  Please fix these before open-sourcing.${NC}"
    echo ""
    echo "See SECURITY.md for remediation steps."
    exit 1
fi
