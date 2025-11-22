# Contributing to GA4 Manager

Thank you for your interest in contributing to GA4 Manager! This document provides guidelines for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Testing](#testing)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

This project follows a standard Code of Conduct. By participating, you are expected to:

- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

### Prerequisites

- **Go 1.21 or later** - [Install Go](https://go.dev/doc/install)
- **Git** - [Install Git](https://git-scm.com/downloads)
- **Make** - Usually pre-installed on Unix systems
- **golangci-lint v2.6.2** - [Install golangci-lint](https://golangci-lint.run/usage/install/)
- **Google Cloud credentials** - For testing (see [INSTALL.md](INSTALL.md))

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/ga4-manager.git
   cd ga4-manager
   ```
3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/garbarok/ga4-manager.git
   ```

## Development Setup

### Install Dependencies

```bash
# Download Go dependencies
go mod download

# Verify dependencies
go mod verify

# Install golangci-lint (if not installed)
# macOS
brew install golangci-lint

# Linux
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(go env GOPATH)/bin v2.6.2

# Windows
# See: https://golangci-lint.run/usage/install/#windows
```

### Environment Setup

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/credentials.json
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
```

See [INSTALL.md](INSTALL.md) for detailed credential setup.

### Build and Test

```bash
# Run tests
make test

# Run linter
make lint

# Build binary
make build

# Install locally
make install

# Verify installation
ga4 --version
```

## Development Workflow

### Branch Naming

Use descriptive branch names with prefixes:

- `feat/` - New features (e.g., `feat/add-audience-support`)
- `fix/` - Bug fixes (e.g., `fix/rate-limiter-crash`)
- `docs/` - Documentation changes (e.g., `docs/update-install-guide`)
- `refactor/` - Code refactoring (e.g., `refactor/simplify-client`)
- `test/` - Test additions (e.g., `test/add-validation-tests`)
- `chore/` - Maintenance tasks (e.g., `chore/update-deps`)

### Making Changes

1. **Create a feature branch**:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes**:
   - Write clean, readable code
   - Follow Go best practices
   - Add tests for new functionality
   - Update documentation as needed

3. **Run tests and linter**:
   ```bash
   make test
   make lint
   ```

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

5. **Keep your branch updated**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

6. **Push to your fork**:
   ```bash
   git push origin feat/your-feature-name
   ```

## Code Style

### Go Style Guidelines

- Follow [Effective Go](https://go.dev/doc/effective_go)
- Use `gofmt` for formatting (automatically handled by golangci-lint)
- Use meaningful variable and function names
- Add comments for exported functions and types
- Keep functions small and focused

### Project Conventions

**Package Organization**:
```
ga4-manager/
├── cmd/              # CLI commands (Cobra)
├── internal/
│   ├── config/       # Configuration management
│   ├── ga4/          # GA4 API client and operations
│   └── validation/   # Input validation
├── configs/          # Example YAML configurations
└── docs/             # Documentation
```

**Error Handling**:
```go
// Wrap errors with context
if err != nil {
    return fmt.Errorf("failed to create conversion %s: %w", eventName, err)
}

// Log errors with structured logging
client.logger.Error("operation failed", "error", err, "property_id", propertyID)
```

**Input Validation**:
```go
// Always validate inputs before API calls
if err := validation.ValidatePropertyID(propertyID); err != nil {
    return err
}
```

**Configuration**:
```go
// Use structured configuration
cfg := config.DefaultClientConfig()
client, err := ga4.NewClient(ga4.WithConfig(cfg))
```

## Testing

### Running Tests

```bash
# Run all tests
make test

# Run tests with verbose output
go test -v ./...

# Run tests with coverage
go test -v -race -coverprofile=coverage.out ./...

# View coverage report
go tool cover -html=coverage.out

# Run specific package tests
go test -v ./internal/validation/...
```

### Writing Tests

**Test File Naming**: `*_test.go` (e.g., `validation_test.go`)

**Table-Driven Tests**:
```go
func TestValidateEventName(t *testing.T) {
    tests := []struct {
        name      string
        eventName string
        wantErr   bool
        errMsg    string
    }{
        {
            name:      "valid event name",
            eventName: "purchase",
            wantErr:   false,
        },
        {
            name:      "invalid: starts with number",
            eventName: "2purchase",
            wantErr:   true,
            errMsg:    "must start with letter",
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := validation.ValidateEventName(tt.eventName)
            if (err != nil) != tt.wantErr {
                t.Errorf("ValidateEventName() error = %v, wantErr %v", err, tt.wantErr)
            }
            if tt.wantErr && err != nil && !strings.Contains(err.Error(), tt.errMsg) {
                t.Errorf("error message = %v, want substring %v", err.Error(), tt.errMsg)
            }
        })
    }
}
```

### Test Coverage

Aim for **80%+ coverage** for new code:
- All validation functions should be 100% covered
- API client functions should have integration tests (if credentials available)
- CLI commands should have unit tests for logic

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) for consistent commit messages and automated changelog generation.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Test additions or modifications
- `chore`: Build process or auxiliary tool changes
- `ci`: CI/CD configuration changes

### Scopes (Optional)

- `cli`: CLI commands
- `api`: GA4 API client
- `config`: Configuration management
- `validation`: Input validation
- `deps`: Dependencies

### Examples

```bash
# Feature addition
git commit -m "feat(api): add support for calculated metrics"

# Bug fix
git commit -m "fix(validation): prevent panic on empty event name"

# Documentation
git commit -m "docs: update installation guide with Windows instructions"

# Refactoring
git commit -m "refactor(client): simplify rate limiter initialization"

# Breaking change
git commit -m "feat(api)!: change dimension scope format to uppercase

BREAKING CHANGE: dimension scopes must now be uppercase (USER, EVENT, ITEM)"
```

## Pull Request Process

### Before Submitting

1. ✅ All tests pass (`make test`)
2. ✅ Linter passes (`make lint`)
3. ✅ Code is properly formatted
4. ✅ Documentation is updated
5. ✅ Commit messages follow conventions
6. ✅ Branch is up-to-date with `main`

### Creating a Pull Request

1. **Push your branch**:
   ```bash
   git push origin feat/your-feature-name
   ```

2. **Create PR on GitHub**:
   - Go to https://github.com/garbarok/ga4-manager
   - Click "New Pull Request"
   - Select your branch
   - Fill out the PR template

3. **PR Title**: Use conventional commit format
   ```
   feat: add support for custom channel groups
   ```

4. **PR Description**: Include:
   - Summary of changes
   - Related issue number (if applicable)
   - Testing performed
   - Screenshots (if UI changes)
   - Breaking changes (if any)

### PR Template Example

```markdown
## Summary
Brief description of what this PR does.

## Related Issue
Closes #123

## Changes
- Added X functionality
- Fixed Y bug
- Updated Z documentation

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed

## Checklist
- [ ] Tests pass locally
- [ ] Linter passes
- [ ] Documentation updated
- [ ] Conventional commit messages used
```

### Review Process

1. **Automated Checks**: All CI checks must pass
   - Test workflow
   - Security workflow
   - Lint checks

2. **Code Review**: At least one maintainer approval required

3. **Address Feedback**: Make requested changes and push updates

4. **Merge**: Maintainers will merge once approved

## Release Process

Releases are automated via GitHub Actions. Only maintainers can create releases.

### Version Numbering

We use [Semantic Versioning](https://semver.org/) (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking changes (e.g., `v2.0.0`)
- **MINOR**: New features, backward compatible (e.g., `v1.1.0`)
- **PATCH**: Bug fixes, backward compatible (e.g., `v1.0.1`)

### Creating a Release (Maintainers)

#### Step 1: Prepare Release

1. **Update version-specific code** (if needed):
   - Update `CHANGELOG.md` (or rely on auto-generated notes)
   - Update documentation with new features

2. **Test locally**:
   ```bash
   make build
   make test
   make lint
   ```

3. **Ensure `main` branch is clean**:
   ```bash
   git checkout main
   git pull upstream main
   ```

#### Step 2: Create and Push Tag

**Option A: Using GitHub CLI** (Recommended):
```bash
# Create release with auto-generated notes
gh release create v1.2.0 --generate-notes

# Or with custom notes
gh release create v1.2.0 --title "v1.2.0 - Feature Release" --notes "Custom release notes"
```

**Option B: Using Git Tags**:
```bash
# Create tag
git tag v1.2.0

# Push tag (triggers release workflow)
git push upstream v1.2.0
```

#### Step 3: Verify Release Workflow

1. **Monitor workflow**:
   ```bash
   gh run list --workflow=release.yml --limit 1
   gh run watch
   ```

2. **Check release**:
   ```bash
   gh release view v1.2.0
   ```

3. **Download and test binary**:
   ```bash
   gh release download v1.2.0 -p '*darwin-arm64*'
   tar -xzf ga4-darwin-arm64.tar.gz
   ./ga4-darwin-arm64 --version
   ```

#### Step 4: Verify Release Assets

Each release should include:
- ✅ Binary archives for all platforms (5 total)
- ✅ Release notes (auto-generated or custom)
- ✅ Checksums (if using GoReleaser)

### Release Artifacts

Automatically generated for each release:
- `ga4-linux-amd64.tar.gz` - Linux x86_64
- `ga4-linux-arm64.tar.gz` - Linux ARM64
- `ga4-darwin-amd64.tar.gz` - macOS Intel
- `ga4-darwin-arm64.tar.gz` - macOS Apple Silicon
- `ga4-windows-amd64.zip` - Windows x86_64
- `checksums.txt` - SHA256 checksums (GoReleaser only)

### Release Checklist

- [ ] All tests passing on `main`
- [ ] Security scans clean
- [ ] Documentation updated
- [ ] Version number decided (MAJOR.MINOR.PATCH)
- [ ] CHANGELOG.md updated (or auto-generated)
- [ ] Tag created and pushed
- [ ] Release workflow completed successfully
- [ ] Binaries attached to release
- [ ] Release notes published
- [ ] Community notified (if major release)

### Rolling Back a Release

If issues are discovered:

```bash
# Delete GitHub release
gh release delete v1.2.0 --yes

# Delete git tag
git tag -d v1.2.0
git push upstream :refs/tags/v1.2.0

# Fix issues, then recreate release
gh release create v1.2.0 --generate-notes
```

## Reporting Issues

### Bug Reports

Use the bug report template and include:
- **Description**: Clear description of the bug
- **Steps to Reproduce**: Numbered steps to reproduce
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Environment**:
  - OS and version
  - Go version (`go version`)
  - ga4 version (`ga4 --version`)
- **Logs**: Relevant error messages or logs
- **Configuration**: Relevant YAML config (sanitized)

### Feature Requests

Use the feature request template and include:
- **Feature Description**: Clear description of the feature
- **Use Case**: Why this feature is needed
- **Proposed Solution**: How you envision it working
- **Alternatives**: Other solutions you've considered

### Security Vulnerabilities

**DO NOT** open a public issue for security vulnerabilities. Instead:
1. See [SECURITY.md](SECURITY.md) for reporting instructions
2. Email maintainers directly
3. Allow time for fix before public disclosure

## Getting Help

- **Documentation**: Check [docs/](docs/) folder
- **Issues**: Search existing issues first
- **Discussions**: Use GitHub Discussions for questions
- **CI/CD**: See [docs/development/CI_CD.md](docs/development/CI_CD.md)

## Additional Resources

- [Go Documentation](https://go.dev/doc/)
- [Cobra Documentation](https://cobra.dev/)
- [Google Analytics Admin API](https://developers.google.com/analytics/devguides/config/admin/v1)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Thank You!

Your contributions make GA4 Manager better for everyone. Thank you for taking the time to contribute! 🎉
