# Changelog

All notable changes to GA4 Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Priority filtering (`--priority high/medium/low`)
- Incremental updates for partial updates

## [2.1.0] - 2025-12-28

### Major UX Improvements & Architecture Refactoring

#### Added

**Auto-Install System**
- First-run binary installation with sudo transparency and user consent
- Automatic binary placement in `/usr/local/bin` (user-approved)
- Shell-specific fallback instructions (Fish, Zsh, Bash) when auto-install is declined
- Smart detection: skips in dev environments (git repos) or if already installed
- Professional onboarding: download binary → run once → everything configured

**Auto-Config Creation**
- Embedded configuration templates compiled into binary (zero external dependencies)
- Automatic creation of `~/.config/ga4/configs/` directory on first run
- Three example configs: minimal, ecommerce, content site
- No manual file downloads or directory setup required

**Report Export**
- JSON export: Full structured data with all fields
- CSV export: Separate files for conversions, dimensions, metrics
- Markdown export: Human-readable formatted tables
- CLI mode: `--output` and `--format` flags for scripting
- Interactive mode: Export from report viewing menu
- Proper file handle cleanup with named returns (critical bug fix)

**Enhanced TUI**
- Complete interactive menu system built with Bubble Tea framework
- Link management: Search Console, BigQuery, Channel Groups
- Channel group operations: create, list, update, delete
- Setup wizards with real-time progress indicators
- Consistent styling across all interactive components
- Improved navigation and user feedback

**Configuration Validation**
- Implemented `ga4 validate` command for pre-flight checks
- Validates YAML syntax, property IDs, event names, parameter names
- Checks for reserved prefixes (google_, ga_, firebase_)
- Provides actionable error messages with line numbers

#### Changed

**SOLID Architecture Refactoring**
- Split 500+ line `cmd/interactive.go` into 7 focused handlers:
  - `handler_setup.go` - Setup operations (39 lines)
  - `handler_report.go` - Report viewing and export (98 lines)
  - `handler_cleanup.go` - Cleanup operations (44 lines)
  - `handler_link.go` - External service links (291 lines)
  - `handler_export.go` - Export functionality (70 lines)
  - `handler_validate.go` - Config validation (39 lines)
- Each handler follows Single Responsibility Principle
- Improved testability and maintainability
- Clearer separation of concerns

**Enhanced Error Handling**
- Fixed critical CSV resource leak (named return for proper error handling)
- Fixed path traversal panic risk (bounds check + filepath.Join)
- Better error context throughout codebase

#### Fixed

**Critical Security Issues**
- **CSV Resource Leak** (cmd/export.go:246-256): Used named return to ensure file.Close() error is properly handled
- **Path Traversal Panic** (cmd/init.go:89-96): Added bounds checking and proper path joining to prevent panic on empty credential paths

**Code Quality**
- All errcheck warnings resolved
- All staticcheck issues fixed
- All govet warnings addressed
- Zero linter issues

#### Testing

**New Test Suite**
- `cmd/export_test.go` with 5 test functions and 15+ test cases:
  - TestExportToJSON (valid data, empty data)
  - TestExportToCSV (valid data, empty conversions)
  - TestExportToMarkdown (valid data)
  - TestWriteCSV (conversion/dimension/metric data)
  - TestWriteCSV_VerifyFileClose (resource cleanup verification)
- All 100+ tests passing across entire codebase
- Cross-platform CI validation (macOS, Linux, Windows)

#### Documentation

**New Documentation**
- `docs/REFACTORING_INTERACTIVE.md` - Architecture decisions and patterns
- `cmd/configs/README.md` - Configuration guide with examples
- Updated README.md with auto-install and export features
- Updated .goreleaser.yaml with new release workflow

#### Impact

**User Experience**
- Onboarding reduced from 7+ manual steps to 2 commands
- Zero breaking changes - fully backward compatible
- Professional first-run experience with clear guidance
- Export capabilities for reporting and analysis

**Developer Experience**
- Easier to add new interactive features
- Clear separation of concerns for maintainability
- Comprehensive test coverage for new functionality
- Better code organization following SOLID principles

#### Files Changed
- **Added**: 18 new files (+3,769 lines)
- **Modified**: 8 files (-17 lines)
- **Total**: 25 files changed

#### CI/CD Status
✅ All checks passing:
- Build, Lint, Tests (macOS/Linux/Windows)
- Security scans (Trivy, gosec, vulnerability checks)
- CodeRabbit AI review: APPROVED

### Commits
- `bd3ea9c` - feat: Auto-install, export reports, and refactor interactive mode (#17)

## [1.1.0] - 2025-11-22

### Infrastructure & Tooling Improvements

#### Added
- **CI/CD Pipeline**: Comprehensive GitHub Actions workflows for automated testing, security scanning, and releases
- **Multi-Platform Testing**: Automated testing on Linux, macOS, and Windows
- **Security Scanning**: Weekly automated vulnerability scanning (govulncheck, gosec, trivy)
- **GoReleaser Integration**: Automated multi-platform binary releases
- **golangci-lint v2.6.2**: Code quality enforcement with golangci-lint-action v7

#### Changed
- **Go 1.25 Required**: Updated from Go 1.24 (which didn't exist) to Go 1.25
- **Dependencies Updated**:
  - `github.com/fatih/color` v1.16.0 → v1.18.0
  - `github.com/spf13/cobra` v1.8.0 → v1.9.1
  - `google.golang.org/api` v0.155.0 → v0.223.0
  - Added 200+ transitive dependencies from golangci-lint tooling

#### Fixed
- **Windows CI Tests**: Added `shell: bash` to fix PowerShell argument parsing issues
- **Race Detector**: Disabled on Windows (CGO limitations)
- **Lint Action**: Updated to golangci-lint-action v7 for v2.x linter support

#### CI/CD Features
- Test matrix: Go 1.25 on ubuntu-latest, macos-latest, windows-latest
- Security: Weekly automated scans for vulnerabilities
- Release: Automated multi-platform binary building with GoReleaser
- Lint: golangci-lint v2.6.2 with comprehensive checks

#### Notes
- **No functional changes** to CLI tool - same features as v1.0.0
- All changes are infrastructure and build improvements
- Binary functionality identical to v1.0.0
- Improved code quality and release automation

### Commits
- `fed29b0` - feat(ci): add comprehensive CI/CD pipeline with Go 1.25 support

## [1.0.0] - 2025-11-22

### Added
- **Release Automation**: GitHub Actions workflow for automated multi-platform binary building
- **Version Support**: Version injection via ldflags, accessible via `--version` flag
- **Code Quality**: golangci-lint integration with comprehensive linting rules
- **Production Features**: Rate limiting, structured logging, input validation, timeout configuration
- **Dry-Run Mode**: Preview changes before applying with `--dry-run` flag
- **Configuration Profiles**: Default, Production, and Development client configurations
- **YAML Configuration**: Support for external YAML configuration files via `--config` flag
- **Cleanup Command**: Remove unused conversions and dimensions with confirmation prompts
- **Link Command**: Manage external service integrations (Search Console, BigQuery, Channel Groups)
- **Data Retention**: Configure GA4 data retention settings
- **Enhanced Measurement**: Configure auto-tracking features (page views, scrolls, clicks, etc.)
- **Audience Documentation**: Comprehensive audience setup guides (API cannot create audiences)

### Fixed
- **BigQuery API Types**: Removed non-existent `Dataset` field from `BigQueryLink` struct
- **Channel Groups API**: Fixed filter types (`InListFilter`, `StringFilter`, `FilterExpressions`)
- **Link Command**: Replaced non-existent `config.GetProject()` with proper switch statement
- **Error Handling**: Fixed all unchecked error returns from color print functions
- **Boolean Comparisons**: Simplified `group.SystemDefined == true` to `group.SystemDefined`
- **Code Quality**: Fixed unnecessary `fmt.Sprintf` usage and capitalized error strings

### Changed
- Updated all error messages to include full context (operation name, property ID, resource names)
- Enhanced logging with structured key-value pairs for better observability
- Improved validation error messages with detailed explanations

### Build & Release
- Multi-platform binaries: Linux (amd64, arm64), macOS (Intel, Apple Silicon), Windows (amd64)
- Automated binary compression (.tar.gz for Unix, .zip for Windows)
- Auto-generated release notes from commits
- Parallel builds for faster release creation (~1 minute total)
- Version injection from git tags

### Documentation
- Comprehensive README.md with feature overview and quick start
- INSTALL.md with detailed installation instructions for all platforms
- SECURITY.md with security best practices
- CLAUDE.md with development documentation and AI guidance
- configs/examples/README.md with YAML configuration guide

### Supported Platforms
- macOS (Apple Silicon arm64)
- macOS (Intel amd64)
- Linux (x86_64 amd64)
- Linux (ARM64)
- Windows (x86_64 amd64)

### Commits
- `acb6f25` - feat: improve credential setup UX for binary downloads
- `4b9274f` - docs: add comprehensive installation guide
- `b9c913b` - feat: production-ready release with security, tests, and docs
- `48580c6` - docs: Document release workflow in CLAUDE.md

### Known Limitations
- **Audiences**: Cannot be created via API (complex filter logic), must be configured manually in GA4 UI
- **Search Console Links**: GA4 Admin API does not support programmatic creation, manual setup required
- **BigQuery Links**: Partially supported - can list/retrieve but cannot create/delete via API
- **Archived Dimensions/Metrics**: Parameter names are permanently reserved in GA4 even after archiving

## [0.9.0] - 2025-11-21 (Pre-release)

### Added
- Initial CLI implementation with Cobra framework
- GA4 Admin API integration for conversions, dimensions, and metrics
- Basic setup and report commands
- Hardcoded project configurations for initial development
- Core Web Vitals dimension support
- Custom metrics and calculated metrics support

### Technical Foundation
- Go 1.21+ requirement
- Google Analytics Admin API v1alpha client
- Color-coded terminal output
- Table-formatted configuration reports
- Environment variable support (.env file loading)

## Version History Summary

- **v1.1.0** (2025-11-22): Infrastructure & tooling improvements - CI/CD pipeline, Go 1.25 support, multi-platform testing, security scanning
- **v1.0.0** (2025-11-22): First public release with production features, multi-platform binaries, and comprehensive documentation
- **v0.9.0** (2025-11-21): Pre-release development version

---

## Release Notes Format

### Version Header
- Version number follows [Semantic Versioning](https://semver.org/)
- Release date in ISO format (YYYY-MM-DD)

### Sections
- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security improvements

### Links
- [Unreleased]: https://github.com/garbarok/ga4-manager/compare/v2.1.0...HEAD
- [2.1.0]: https://github.com/garbarok/ga4-manager/compare/v2.0.0...v2.1.0
- [1.1.0]: https://github.com/garbarok/ga4-manager/compare/v1.0.0...v1.1.0
- [1.0.0]: https://github.com/garbarok/ga4-manager/releases/tag/v1.0.0
