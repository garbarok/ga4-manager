# Changelog

All notable changes to GA4 Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Configuration validation command (`ga4 validate`)
- Export hardcoded configs to YAML (`ga4 export`)
- Priority filtering (`--priority high/medium/low`)
- Incremental updates (`--conversions-only`, `--dimensions-only`, `--metrics-only`)

## [1.1.0] - 2025-11-22

### Added
- **Custom Metrics Cleanup**: Extended cleanup command to archive custom metrics in addition to conversions and dimensions
- `DeleteMetric()` function in `internal/ga4/metrics.go` to find and archive metrics by parameter name
- `MetricsToRemove` field to `CleanupConfig` and `CleanupYAMLConfig` structs
- `--type metrics` flag option for cleanup command
- Metrics display table and cleanup logic in `cmd/cleanup.go`
- `PageSize(200)` to `ListDimensions()` to ensure all dimensions are retrieved

### Changed
- Extended `--type` flag to accept `metrics` value in cleanup command
- Updated cleanup command help text with metrics examples
- Updated `ConvertToLegacyProject()` to include metrics cleanup configuration

### Technical Details
- Provides complete GA4 property cleanup capability for conversions, dimensions, and metrics
- Addresses GA4 Standard tier limits (50 metrics maximum)
- Fully tested and functional

### Commits
- `a8f2fdf` - feat: Add custom metrics cleanup support

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

- **v1.1.0** (2025-11-22): Added custom metrics cleanup support
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
- [Unreleased]: https://github.com/garbarok/ga4-manager/compare/v1.1.0...HEAD
- [1.1.0]: https://github.com/garbarok/ga4-manager/compare/v1.0.0...v1.1.0
- [1.0.0]: https://github.com/garbarok/ga4-manager/releases/tag/v1.0.0
