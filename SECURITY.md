# Security Policy

## Overview

GA4 Manager handles sensitive Google Analytics credentials and API access. This document outlines security best practices and how to report vulnerabilities.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Security Best Practices

### 1. Credential Management

**DO:**
- Store credentials **outside** the repository directory (e.g., `~/.config/gcloud/`)
- Use dedicated service accounts with minimal required permissions
- Set restrictive file permissions: `chmod 600 /path/to/credentials.json`
- Use different service accounts for development and production
- Regularly rotate service account keys (recommended: every 90 days)

**DON'T:**
- Never commit `.env` files or credential files to git
- Never share service account keys via email, Slack, or other channels
- Never store credentials in the repository directory
- Never use production credentials for development/testing

### 2. Required OAuth Scopes

Use the principle of least privilege. The minimum required scopes are:

```
https://www.googleapis.com/auth/analytics.edit       # For setup/cleanup operations
https://www.googleapis.com/auth/analytics.readonly   # For report operations
```

For read-only operations (like `ga4 report`), consider using a separate service account with only the `readonly` scope.

### 3. Environment Configuration

```bash
# Recommended directory structure
~/.config/gcloud/
  ├── ga4-manager-dev-credentials.json      # Development credentials
  └── ga4-manager-prod-credentials.json     # Production credentials

# Set permissions
chmod 600 ~/.config/gcloud/*.json

# Reference in .env
GOOGLE_APPLICATION_CREDENTIALS=/Users/yourusername/.config/gcloud/ga4-manager-dev-credentials.json
GOOGLE_CLOUD_PROJECT=your-project-id
```

### 4. Pre-commit Checklist

Before committing code:

1. Verify `.env` is not staged: `git status`
2. Check for credential files: `git diff --cached`
3. Scan for secrets: `git diff --cached | grep -i "credentials\|password\|secret\|key"`
4. Verify `.gitignore` is protecting sensitive files

### 5. If Credentials Are Compromised

If you accidentally commit credentials or suspect they are compromised:

**Immediate Actions:**
1. **Revoke the service account key** in Google Cloud Console immediately
2. **Generate a new service account key**
3. **Update your local `.env` file** with the new credentials
4. **Notify your security team** if applicable

**Remove from Git History** (if committed):
```bash
# WARNING: This rewrites git history. Coordinate with your team first.

# Install BFG Repo-Cleaner (recommended) or use git-filter-repo
brew install bfg

# Remove the credentials file from all commits
bfg --delete-files credentials.json

# Or remove .env from all commits
bfg --delete-files .env

# Cleanup and force push (WARNING: destructive)
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push origin --force --all
git push origin --force --tags
```

**Alternative using git-filter-repo:**
```bash
pip install git-filter-repo

# Remove .env from entire history
git filter-repo --path .env --invert-paths

# Force push
git push origin --force --all
```

### 6. Audit Your Repository

Regularly check for accidentally committed secrets:

```bash
# Check if .env was ever committed
git log --all --full-history --oneline -- .env

# Check for credential files
git log --all --full-history --oneline -- "*.json"

# Search for potential secrets in code
git grep -i "GOOGLE_APPLICATION_CREDENTIALS.*=.*\.json"
git grep -i "api[_-]?key"
git grep -i "secret[_-]?key"
```

### 7. GitHub Repository Settings (Recommended)

If hosting on GitHub:

1. **Enable secret scanning** (Settings → Code security and analysis)
2. **Enable Dependabot alerts**
3. **Add branch protection rules** for `main` branch
4. **Limit repository access** to necessary team members
5. **Enable 2FA** for all contributors

### 8. Service Account Permissions

Create service accounts with minimal permissions:

**Development Service Account:**
```
Role: Analytics Editor (roles/analytics.editor)
Scope: Limited to test properties only
```

**Production Service Account (Read-Only):**
```
Role: Analytics Viewer (roles/analytics.viewer)
Scope: Production properties, read-only operations
```

**Production Service Account (Admin):**
```
Role: Analytics Administrator (roles/analytics.admin)
Scope: Production properties, setup/cleanup operations
Use: Only for maintenance windows, not for regular use
```

## Reporting a Vulnerability

If you discover a security vulnerability in GA4 Manager, please report it responsibly:

### How to Report

**Email:** [Your contact email - UPDATE THIS]

**What to Include:**
1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if you have one)

### Response Timeline

- **Initial Response:** Within 48 hours
- **Status Update:** Within 7 days
- **Fix Timeline:** Depends on severity
  - Critical: Within 7 days
  - High: Within 14 days
  - Medium: Within 30 days
  - Low: Next release cycle

### Disclosure Policy

- Please allow us reasonable time to address the issue before public disclosure
- We will acknowledge your contribution in the security advisory (unless you prefer to remain anonymous)
- We may provide early access to the fix for testing

## Security Features in GA4 Manager

### Built-in Protections

1. **Credential Validation** (v1.1.0+)
   - Checks for empty credential paths
   - Detects placeholder values
   - Verifies credential file existence
   - Validates against common mistakes

2. **Gitignore Protection**
   - Comprehensive patterns for credential files
   - Multiple .env variations covered
   - JSON credential file patterns
   - Certificate and key file patterns

3. **Error Handling**
   - No credential exposure in error messages
   - Safe logging practices
   - Graceful failure without leaking sensitive data

### Known Limitations

1. **Local File Storage:** Credentials are stored as files on disk
   - Mitigation: Use encrypted filesystem or secrets manager

2. **Environment Variables:** Credentials passed via environment
   - Mitigation: Clear environment after use, use short-lived sessions

3. **No Built-in Encryption:** Credential files are not encrypted by the tool
   - Mitigation: Use OS-level encryption (FileVault, BitLocker, LUKS)

## Secure Development Workflow

### For Contributors

1. **Never commit credentials**
   ```bash
   # Before committing
   git diff --cached | grep -i "credentials\|password\|api.*key"
   ```

2. **Use pre-commit hooks** (optional but recommended)
   ```bash
   # .git/hooks/pre-commit
   #!/bin/bash
   if git diff --cached --name-only | grep -E "\.env$|credentials.*\.json$"; then
       echo "ERROR: Attempting to commit sensitive files!"
       exit 1
   fi
   ```

3. **Review code for security issues**
   - Check for hardcoded secrets
   - Validate error messages don't leak credentials
   - Ensure proper error handling

4. **Run security scans**
   ```bash
   # Scan for secrets in code
   git secrets --scan

   # Or use gitleaks
   gitleaks detect --source . --verbose
   ```

### For Maintainers

1. **Review all pull requests** for security implications
2. **Keep dependencies updated** to patch vulnerabilities
3. **Monitor GitHub security advisories**
4. **Rotate release signing keys** regularly (if applicable)

## Additional Resources

- [Google Cloud Security Best Practices](https://cloud.google.com/security/best-practices)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)
- [Git Secrets Prevention](https://git-secret.io/)

## Changelog

| Date       | Version | Changes |
|------------|---------|---------|
| 2025-11-22 | 1.1.0   | Initial security policy, credential validation, enhanced .gitignore |

---

**Last Updated:** 2025-11-22
**Contact:** [UPDATE WITH YOUR CONTACT INFO]
