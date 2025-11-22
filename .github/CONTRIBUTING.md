# Contributing to GA4 Manager

Thank you for your interest in contributing to GA4 Manager! This document provides guidelines and best practices for contributing.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Security Guidelines](#security-guidelines)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)

---

## Code of Conduct

Please be respectful and professional in all interactions. We aim to maintain a welcoming and inclusive environment for all contributors.

---

## Getting Started

### Prerequisites
- Go 1.21 or higher
- Google Cloud account with GA4 Admin API access
- Service account credentials
- golangci-lint v2.6.2+

### Initial Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/ga4-manager.git
   cd ga4-manager
   ```

2. **Set up your development environment**
   ```bash
   # Copy environment template
   cp .env.example .env

   # Edit .env with your credentials
   # IMPORTANT: Store credentials OUTSIDE this directory
   vim .env
   ```

3. **Install pre-commit hook**
   ```bash
   cp .githooks/pre-commit .git/hooks/pre-commit
   chmod +x .git/hooks/pre-commit
   ```

4. **Build and test**
   ```bash
   make build
   make test
   make lint
   ```

---

## Development Workflow

### 1. Create a Feature Branch
```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes
- Write clean, idiomatic Go code
- Follow existing code style and patterns
- Add tests for new functionality
- Update documentation as needed

### 3. Run Quality Checks
```bash
# Format code
gofmt -w .

# Run linter
make lint

# Run tests
make test

# Run security audit
./scripts/security-audit.sh
```

### 4. Commit Your Changes
```bash
git add .
git commit -m "feat: Add your feature description"
```

The pre-commit hook will automatically:
- Check for accidentally staged .env files
- Scan for credential files
- Detect potential secrets
- Verify code formatting

### 5. Push and Create Pull Request
```bash
git push origin feature/your-feature-name
```

Then create a pull request on GitHub.

---

## Security Guidelines

### Critical Rules

**NEVER commit these files:**
- `.env` files
- Credential files (*.json, *.pem, *.key)
- Service account keys
- API tokens or secrets

**Before every commit:**
1. Run the security audit: `./scripts/security-audit.sh`
2. Verify the pre-commit hook is installed
3. Review staged changes for sensitive data

### Handling Credentials

**DO:**
- Store credentials in `~/.config/gcloud/` or similar secure location
- Use `.env.example` for documentation (with placeholders only)
- Set restrictive permissions: `chmod 600 ~/.config/gcloud/credentials.json`
- Use separate service accounts for development and testing

**DON'T:**
- Never commit real credentials
- Never hardcode API keys or tokens
- Never store credentials in the repository directory
- Never share service account keys via insecure channels

### If You Accidentally Commit Secrets

1. **Immediately revoke the credentials** in Google Cloud Console
2. **Remove from git history** (see [SECURITY.md](../SECURITY.md))
3. **Notify maintainers** if the commit was pushed
4. **Generate new credentials**

For detailed instructions, see [SECURITY.md](../SECURITY.md).

---

## Pull Request Process

### Before Submitting

1. **Update documentation**
   - Update README.md if adding new features
   - Update CLAUDE.md if changing architecture
   - Add/update code comments

2. **Run all checks**
   ```bash
   make build
   make test
   make lint
   ./scripts/security-audit.sh
   ```

3. **Test your changes**
   - Build and run the binary
   - Test with both projects (SnapCompress, Personal Website)
   - Verify error handling

### PR Description Template

```markdown
## Description
Brief description of your changes

## Type of Change
- [ ] Bug fix (non-breaking change)
- [ ] New feature (non-breaking change)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update

## Testing
- [ ] Tested with SnapCompress project
- [ ] Tested with Personal Website project
- [ ] All tests passing
- [ ] Lint checks passing
- [ ] Security audit passing

## Checklist
- [ ] Code follows the project's style guidelines
- [ ] Self-reviewed my own code
- [ ] Commented code, particularly in hard-to-understand areas
- [ ] Updated documentation (README.md, CLAUDE.md)
- [ ] No new warnings generated
- [ ] Added tests that prove the fix/feature works
- [ ] New and existing tests pass locally
- [ ] No sensitive data in commits
```

### Review Process

1. Maintainers will review your PR within 7 days
2. Address any feedback or requested changes
3. Once approved, maintainers will merge your PR
4. Your contribution will be acknowledged in the release notes

---

## Coding Standards

### Go Style

Follow [Effective Go](https://golang.org/doc/effective_go.html) and these project-specific guidelines:

**1. Code Organization**
```go
// Package-level documentation
package cmd

// Imports grouped by: standard library, external, internal
import (
    "fmt"
    "os"

    "github.com/spf13/cobra"

    "github.com/garbarok/ga4-manager/internal/config"
)
```

**2. Naming Conventions**
- Use camelCase for variables: `projectConfig`
- Use PascalCase for exports: `SetupCommand`
- Use descriptive names: `getUserCredentials()` not `getUC()`

**3. Error Handling**
```go
// Always check errors explicitly
if err != nil {
    return fmt.Errorf("failed to create client: %w", err)
}

// Use error wrapping for context
if err := client.CreateConversion(conv); err != nil {
    return fmt.Errorf("creating conversion %s: %w", conv.Name, err)
}
```

**4. Comments**
```go
// Function comments should start with the function name
// CreateConversion creates a new conversion event in GA4.
// It returns an error if the API call fails.
func CreateConversion(conv *Conversion) error {
    // Implementation
}
```

**5. Formatting**
- Run `gofmt -w .` before committing
- Use tabs for indentation (Go standard)
- Limit line length to 100 characters when practical

### Project-Specific Patterns

**1. CLI Commands** (in `cmd/`)
- Use Cobra command structure
- Include examples in command help
- Validate flags before execution
- Use colored output for user feedback

**2. GA4 API Calls** (in `internal/ga4/`)
- Always return wrapped errors with context
- Use property path format: `properties/{propertyID}`
- Handle API rate limits gracefully
- Log API calls in verbose mode

**3. Configuration** (in `internal/config/`)
- Keep project configs in `projects.go`
- Use struct tags for YAML/JSON mapping
- Validate configurations on load
- Document all fields

### Testing

**Write tests for:**
- New functions and methods
- Bug fixes
- Edge cases and error conditions

**Test structure:**
```go
func TestCreateConversion(t *testing.T) {
    tests := []struct {
        name    string
        input   *Conversion
        want    error
        wantErr bool
    }{
        {
            name: "valid conversion",
            input: &Conversion{Name: "test_event"},
            want: nil,
            wantErr: false,
        },
        // More test cases...
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := CreateConversion(tt.input)
            if (got != nil) != tt.wantErr {
                t.Errorf("CreateConversion() error = %v, wantErr %v", got, tt.wantErr)
            }
        })
    }
}
```

---

## Common Tasks

### Adding a New Command

1. Create new file in `cmd/` (e.g., `cmd/mycommand.go`)
2. Define Cobra command structure
3. Implement command logic
4. Add to root command in `cmd/root.go`
5. Update README.md with usage examples
6. Add tests

### Adding a New GA4 Feature

1. Create new file in `internal/ga4/` (e.g., `internal/ga4/myfeature.go`)
2. Implement GA4 API client methods
3. Add configuration structs in `internal/config/`
4. Create command handler in `cmd/`
5. Update project configs in `internal/config/projects.go`
6. Test with real GA4 property
7. Update documentation

### Updating Dependencies

```bash
# Update all dependencies
go get -u ./...

# Tidy up
go mod tidy

# Verify
go mod verify

# Test
make test
make lint
```

---

## Getting Help

### Documentation
- [README.md](../README.md) - Project overview and usage
- [CLAUDE.md](../CLAUDE.md) - Architecture and development guide
- [SECURITY.md](../SECURITY.md) - Security guidelines
- [OPEN_SOURCE_READINESS.md](../OPEN_SOURCE_READINESS.md) - Security audit report

### Resources
- [Google Analytics Admin API](https://developers.google.com/analytics/devguides/config/admin/v1)
- [Cobra CLI Framework](https://github.com/spf13/cobra)
- [Effective Go](https://golang.org/doc/effective_go.html)

### Contact
- Create an issue for bugs or feature requests
- Tag maintainers for urgent security issues
- See [SECURITY.md](../SECURITY.md) for security-specific contact

---

## Release Process (Maintainers Only)

### Creating a Release

1. **Update version in relevant files**
2. **Update CHANGELOG.md**
3. **Run full test suite**
   ```bash
   make build
   make test
   make lint
   ./scripts/security-audit.sh
   ```

4. **Create and push tag**
   ```bash
   git tag v1.x.x
   git push origin v1.x.x
   ```

5. **Create GitHub release**
   ```bash
   gh release create v1.x.x --generate-notes
   ```

The GitHub Actions workflow will automatically build binaries for all platforms.

---

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see [LICENSE](../LICENSE)).

---

## Thank You!

Your contributions help make GA4 Manager better for everyone. We appreciate your time and effort!
