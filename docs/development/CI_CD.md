# CI/CD Documentation

This document describes the continuous integration and deployment workflows for GA4 Manager.

## Overview

GA4 Manager uses GitHub Actions for automated testing, security scanning, dependency management, and release automation. All workflows are located in `.github/workflows/`.

## Workflows

### 1. Test Workflow (`test.yml`)

**Trigger**: Push to main, Pull Requests

**Purpose**: Validates code quality through testing, linting, and building.

**Jobs**:

- **Test Matrix**:
  - **Operating Systems**: Ubuntu, macOS, Windows
  - **Go Versions**: 1.21, 1.22, 1.23
  - **Total Combinations**: 9 parallel jobs
  - **Coverage**: Generates coverage report and uploads to Codecov (Ubuntu + Go 1.23 only)

- **Lint**:
  - Runs `golangci-lint` v2.6.2
  - Timeout: 5 minutes
  - Only on Ubuntu with Go 1.23

- **Build**:
  - Verifies binary compilation
  - Runs `./ga4 --version` to test the build
  - Timeout: 5 minutes

**Caching**: Go module cache enabled for all jobs

**Example**:
```bash
# Locally replicate test workflow
make test
make lint
make build
./ga4 --version
```

### 2. Security Workflow (`security.yml`)

**Trigger**: Push to main, Pull Requests, Weekly schedule (Mondays at 8:00 UTC)

**Purpose**: Comprehensive security scanning with multiple tools.

**Jobs**:

- **govulncheck** (Vulnerability Check):
  - Scans for known vulnerabilities in dependencies
  - Uses official Go vulnerability database
  - Timeout: 10 minutes

- **gosec** (Security Scan):
  - Static security analyzer for Go code
  - Version: v2.19.0 (pinned for security)
  - Severity filter: HIGH and above
  - Uploads SARIF results to GitHub Security tab
  - Timeout: 10 minutes

- **dependency-review** (Pull Requests Only):
  - Reviews dependency changes in PRs
  - Fails on HIGH severity vulnerabilities
  - Comments summary in PR automatically
  - Timeout: 5 minutes

- **trivy** (Vulnerability Scanner):
  - Scans filesystem for vulnerabilities
  - Version: 0.17.0 (pinned for security)
  - Severity filter: CRITICAL and HIGH
  - Uploads SARIF results to GitHub Security
  - Timeout: 10 minutes

**Security Features**:
- All jobs use `continue-on-error: true` to ensure SARIF uploads complete
- Minimal permissions: `contents: read`, `security-events: write`
- Pinned action versions to prevent supply chain attacks

**Viewing Results**:
1. Go to **Security** → **Code scanning alerts** in GitHub
2. Filter by tool (gosec, trivy)
3. View detailed vulnerability information

**Example**:
```bash
# Locally replicate security checks
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

### 3. Release Workflow (`release.yml`)

**Trigger**: Push tags (`v*`), Manual workflow dispatch

**Purpose**: Builds multi-platform binaries and creates GitHub releases.

**Current Implementation** (Matrix-based):

**Build Matrix**:
- Linux: amd64, arm64
- macOS: amd64 (Intel), arm64 (Apple Silicon)
- Windows: amd64

**Process**:
1. **Build Job** (parallel for all platforms):
   - Checkout code
   - Setup Go 1.23 with caching
   - Build binary with version injection
   - Upload artifacts

2. **Release Job** (depends on build):
   - Download all artifacts
   - Create compressed archives (`.tar.gz` for Unix, `.zip` for Windows)
   - Create GitHub release with auto-generated notes
   - Attach all binaries to release

**Version Injection**:
```bash
# Version is injected via ldflags
-X 'github.com/garbarok/ga4-manager/cmd.Version=${{ github.ref_name }}'
```

**Permissions**: `contents: write` (minimal for creating releases)

### 4. GoReleaser Workflow (`release-goreleaser.yml`) - NEW!

**Trigger**: Push tags (`v*`), Manual workflow dispatch

**Purpose**: Simplified release process using GoReleaser.

**Advantages over Matrix Build**:
- ✅ Single job (faster, ~1-2 minutes total)
- ✅ Automatic SHA256 checksum generation
- ✅ Better changelog with grouped categories
- ✅ Customizable release notes template
- ✅ Ready for Homebrew tap integration
- ✅ Consistent with `.goreleaser.yaml` configuration

**Configuration**: See `.goreleaser.yaml` for full details

**Changelog Groups**:
- New Features (feat)
- Bug Fixes (fix)
- Performance Improvements (perf)
- Refactors (refactor)
- Other Changes

**To Use GoReleaser Instead of Matrix Build**:

1. **Option A**: Rename workflows
   ```bash
   mv .github/workflows/release.yml .github/workflows/release-matrix-backup.yml
   mv .github/workflows/release-goreleaser.yml .github/workflows/release.yml
   ```

2. **Option B**: Disable matrix build workflow and use GoReleaser manually
   ```bash
   gh workflow disable release.yml
   gh workflow run release-goreleaser.yml
   ```

### 5. Dependabot Configuration (`dependabot.yml`)

**Purpose**: Automated dependency updates

**Update Schedules**:

- **Go Modules** (`go.mod`):
  - Schedule: Weekly (Mondays at 8:00 UTC)
  - Open PR Limit: 10
  - Labels: `dependencies`, `go`
  - Groups minor and patch updates together

- **GitHub Actions**:
  - Schedule: Monthly (Mondays at 8:00 UTC)
  - Open PR Limit: 5
  - Labels: `dependencies`, `github-actions`

**Commit Message Format**:
- Go modules: `chore(deps): <description>`
- GitHub Actions: `chore(ci): <description>`

### 6. Claude Code Workflows

**claude.yml**: Responds to `@claude` mentions in issues and PRs

**claude-code-review.yml**: Automatic PR reviews (optional)

See `.github/workflows/claude.yml` and `.github/workflows/claude-code-review.yml` for details.

## Release Process

### Creating a New Release

#### Method 1: Using GitHub CLI (Recommended)

```bash
# Create release with auto-generated notes
gh release create v1.2.0 --generate-notes

# Or with custom notes
gh release create v1.2.0 --title "v1.2.0 - Feature Release" --notes "Release notes here"
```

#### Method 2: Git Tags

```bash
# Create and push a tag
git tag v1.2.0
git push origin v1.2.0
```

The workflow will automatically:
1. Build binaries for all 5 platforms (or use GoReleaser)
2. Create compressed archives
3. Generate checksums (GoReleaser only)
4. Create GitHub release
5. Attach all binaries

#### Method 3: Manual Trigger

Go to **Actions** → **Release** → **Run workflow**

### Release Artifacts

Each release includes:
- `ga4-linux-amd64.tar.gz` - Linux x86_64
- `ga4-linux-arm64.tar.gz` - Linux ARM64
- `ga4-darwin-amd64.tar.gz` - macOS Intel
- `ga4-darwin-arm64.tar.gz` - macOS Apple Silicon
- `ga4-windows-amd64.zip` - Windows x86_64
- `checksums.txt` - SHA256 checksums (GoReleaser only)

### Versioning

**Version Format**: `vX.Y.Z` (semantic versioning)

**Version Injection**:
- Releases: Version from git tag (e.g., `v1.2.0`)
- Local builds: Version from `git describe` (e.g., `a08a95f-dirty`)
- Variable location: `cmd/root.go`

**Check Version**:
```bash
./ga4 --version
# Output: ga4 version v1.2.0
```

### Deleting a Release

If you need to delete and retry:

```bash
# Delete release and tag
gh release delete v1.2.0 --yes
git push origin :refs/tags/v1.2.0

# Recreate release
gh release create v1.2.0 --generate-notes
```

## Monitoring Workflows

### View Workflow Status

```bash
# List recent workflow runs
gh run list --limit 10

# View specific workflow runs
gh run list --workflow=test.yml --limit 5

# Watch a running workflow
gh run watch
```

### View Release Details

```bash
# View latest release
gh release view --web

# List release assets
gh release view v1.2.0 --json assets --jq '.assets[] | .name'

# Download release asset
gh release download v1.2.0 -p '*darwin-arm64*'
```

### View Security Alerts

```bash
# List security alerts (requires GitHub CLI extension)
gh api repos/garbarok/ga4-manager/code-scanning/alerts | jq
```

Or visit: **Security** → **Code scanning alerts** in GitHub UI

## Badges

The README.md includes the following status badges:

- **Test Status**: ![Test](https://github.com/garbarok/ga4-manager/actions/workflows/test.yml/badge.svg)
- **Security**: ![Security](https://github.com/garbarok/ga4-manager/actions/workflows/security.yml/badge.svg)
- **Release**: ![Release](https://github.com/garbarok/ga4-manager/actions/workflows/release.yml/badge.svg)
- **Go Report Card**: [![Go Report](https://goreportcard.com/badge/github.com/garbarok/ga4-manager)](https://goreportcard.com/report/github.com/garbarok/ga4-manager)
- **Latest Release**: ![Version](https://img.shields.io/github/v/release/garbarok/ga4-manager)

## Troubleshooting

### Workflow Failures

**Test Failures**:
```bash
# Replicate locally
make test
go test -v -race ./...
```

**Lint Failures**:
```bash
# Replicate locally
make lint
golangci-lint run
```

**Security Scan Failures**:
```bash
# Check for vulnerabilities
govulncheck ./...
```

**Build Failures**:
```bash
# Test build locally
make build
./ga4 --version
```

### Common Issues

**1. Release Workflow Not Triggering**

**Issue**: Pushed tag but workflow didn't run

**Solution**: Ensure tag format matches `v*` (e.g., `v1.2.0`, not `1.2.0`)

```bash
# Check tag format
git tag -l

# Delete incorrect tag
git tag -d 1.2.0

# Create correct tag
git tag v1.2.0
git push origin v1.2.0
```

**2. Security Scan Reporting False Positives**

**Issue**: Security workflow fails on false positive

**Solution**:
1. Review the alert in **Security** → **Code scanning alerts**
2. If false positive, dismiss the alert with reason
3. Consider adding to `.trivyignore` or `.gosecignore`

**3. Dependabot PR Merge Conflicts**

**Issue**: Dependabot PR has merge conflicts

**Solution**:
```bash
# Rebase Dependabot branch
gh pr checkout 123
git rebase main
git push --force-with-lease
```

Or close and let Dependabot recreate the PR.

## Best Practices

### Commit Messages

Follow conventional commits for better changelog generation:

- `feat: add new feature` - New features
- `fix: resolve bug` - Bug fixes
- `perf: improve performance` - Performance improvements
- `refactor: restructure code` - Code refactoring
- `docs: update documentation` - Documentation changes
- `test: add tests` - Test additions
- `chore: maintain project` - Maintenance tasks

### Pull Request Workflow

1. Create feature branch
2. Make changes with conventional commits
3. Push branch and create PR
4. Wait for CI checks to pass (test, security, lint)
5. Address any issues found by automated checks
6. Merge after approval

### Release Checklist

Before creating a release:

1. ✅ All tests passing
2. ✅ Security scans clean
3. ✅ Lint checks passing
4. ✅ Documentation updated
5. ✅ CHANGELOG.md updated (or use auto-generated notes)
6. ✅ Version bumped appropriately

### Security

- ⚠️ Never commit credentials or API keys
- ⚠️ Always use secrets for sensitive values
- ⚠️ Pin action versions to prevent supply chain attacks
- ⚠️ Review Dependabot PRs before merging
- ⚠️ Address security alerts promptly

## Configuration Files

### Workflow Files
- `.github/workflows/test.yml` - CI testing
- `.github/workflows/security.yml` - Security scanning
- `.github/workflows/release.yml` - Release automation (matrix)
- `.github/workflows/release-goreleaser.yml` - Release automation (GoReleaser)
- `.github/dependabot.yml` - Dependency updates

### Build Configuration
- `.goreleaser.yaml` - GoReleaser configuration
- `.golangci.yml` - Linter configuration
- `Makefile` - Build commands

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GoReleaser Documentation](https://goreleaser.com/intro/)
- [golangci-lint Documentation](https://golangci-lint.run/)
- [govulncheck Documentation](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck)
- [Codecov Documentation](https://docs.codecov.com/)

## Support

For CI/CD issues:
1. Check workflow logs in GitHub Actions tab
2. Replicate locally using `make` commands
3. Review this documentation
4. Open an issue with workflow logs attached
