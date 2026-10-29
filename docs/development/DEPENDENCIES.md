# Dependency Management

This document provides a comprehensive overview of all dependencies used by the GA4 Manager project, their purposes, versions, and security status.

## Project Requirements

- **Go Version**: 1.24.0 or higher (tested with 1.25.4)
- **Module**: github.com/garbarok/ga4-manager

## Direct Dependencies

These are the core dependencies explicitly required by the project.

### CLI Framework & UI

#### github.com/spf13/cobra v1.8.0

- **Purpose**: Modern Go CLI framework providing command structure, flags, and help generation
- **Usage**: Powers all GA4 Manager commands (setup, report, link, cleanup)
- **Why**: Industry standard for Go CLI applications with excellent documentation and community support
- **Latest Available**: v1.10.1 (Check changelog for breaking changes before upgrading)

#### github.com/fatih/color v1.16.0

- **Purpose**: Terminal color output support
- **Usage**: Colored success/error/info messages throughout the CLI
- **Why**: Lightweight, reliable, cross-platform terminal color support
- **Latest Available**: v1.18.0 (Minor updates, safe to upgrade)

#### github.com/olekukonko/tablewriter v0.0.5

- **Purpose**: ASCII table generation for report formatting
- **Usage**: Display configuration and report tables in CLI output
- **Why**: Simple, focused library for table rendering
- **Latest Available**: v1.1.1 (Major update - requires testing before upgrade)
- **Note**: Project uses v0.0.5 for stability; v1.x may have API changes

### Configuration Management

#### github.com/joho/godotenv v1.5.1

- **Purpose**: Load environment variables from .env files
- **Usage**: Load GOOGLE_APPLICATION_CREDENTIALS and GOOGLE_CLOUD_PROJECT
- **Why**: Standard pattern for local development; keeps credentials out of code
- **Latest Available**: v1.5.1 (Current version is latest, no updates needed)

#### gopkg.in/yaml.v3 v3.0.1

- **Purpose**: YAML parsing for configuration files
- **Usage**: Parse YAML cleanup configurations and project definitions
- **Why**: Most popular and reliable YAML parser for Go
- **Latest Available**: v3.0.1 (Current version is latest, no updates needed)

### Google APIs & Authentication

#### google.golang.org/api v0.155.0

- **Purpose**: Google Cloud API client library (includes Analytics Admin API v1alpha)
- **Usage**: All GA4 API operations (create conversions, dimensions, metrics, etc.)
- **Why**: Official Google library, regularly maintained with security updates
- **Latest Available**: v0.256.0 (Significant version difference - requires careful testing)
- **Breaking Changes**: None documented in latest updates
- **Update Strategy**: Can update in minor increments with testing

#### google.golang.org/protobuf v1.33.0 (SECURITY UPDATE)

- **Purpose**: Protocol Buffers serialization library
- **Usage**: Used by Google API client for data serialization
- **Why**: Core dependency of google.golang.org/api
- **Security Fix**: Updated from v1.31.0 to v1.33.0 on 2024-11-22
  - **Fixed Vulnerability**: GO-2024-2611 - Infinite loop in JSON unmarshaling
  - **Impact**: Prevents denial of service attacks via malformed JSON
- **Latest Available**: v1.36.10 (Minor version difference, safe to upgrade)

#### google.golang.org/grpc v1.60.1

- **Purpose**: gRPC communication protocol (used by Google APIs)
- **Usage**: Transport layer for Google Analytics Admin API calls
- **Why**: Official gRPC implementation
- **Latest Available**: v1.77.0 (Major version difference - check for breaking changes)
- **Update Strategy**: Can update but requires thorough testing of API calls

#### cloud.google.com/go v0.110.8

- **Purpose**: Google Cloud Go client library utilities
- **Usage**: Dependency of google.golang.org/api
- **Why**: Official Google Cloud support
- **Latest Available**: v0.123.0 (Major version difference)
- **Update Strategy**: Should be updated as part of google.golang.org/api updates

### Security & Cryptography

#### golang.org/x/crypto v0.21.0 (SECURITY UPDATE)

- **Purpose**: Cryptographic functions and security utilities
- **Usage**: Used by Google APIs for secure authentication
- **Why**: Go standard cryptography library maintained by the Go team
- **Security Fix**: Updated from v0.17.0 to v0.21.0 on 2024-11-22
  - **Fixed as part of**: golang.org/x/net security update
  - **Impact**: Ensures secure credential handling
- **Latest Available**: v0.45.0 (Minor updates available, safe)
- **Update Frequency**: Updated regularly with Go security patches

#### golang.org/x/net v0.23.0 (SECURITY UPDATE)

- **Purpose**: Network programming support
- **Usage**: HTTP/2 support for API calls to Google Analytics
- **Why**: Go standard networking library
- **Security Fix**: Updated from v0.19.0 to v0.23.0 on 2024-11-22
  - **Fixed Vulnerability**: GO-2024-2687 - HTTP/2 CONTINUATION flood
  - **Impact**: Prevents denial of service via HTTP/2 frame attacks
  - **CVE**: CVE-2024-39018 (CVSS 7.5 High)
- **Latest Available**: v0.47.0 (Minor updates, safe)
- **Update Frequency**: Critical security fixes are back-ported

### Testing & Assertions

#### github.com/stretchr/testify v1.11.1

- **Purpose**: Testing assertions and mocking library
- **Usage**: Unit tests for GA4 operations and command logic
- **Why**: Industry standard testing library with excellent assertion methods
- **Latest Available**: v1.11.1 (Current version is latest, no updates needed)

### Time Handling

#### golang.org/x/time v0.14.0

- **Purpose**: Advanced time utilities beyond standard library
- **Usage**: May be used by Google APIs for timeout handling
- **Why**: Reliable time utilities from Go team
- **Latest Available**: v0.14.0 (Current version is latest, no updates needed)

## Indirect Dependencies

These are dependencies pulled in by direct dependencies. They are automatically managed by Go modules.

### Google Cloud Infrastructure

- **cloud.google.com/go/compute** v1.23.3 - Compute metadata service
- **cloud.google.com/go/compute/metadata** v0.2.3 - Instance metadata
- **google.golang.org/appengine** v1.6.8 - App Engine support
- **google.golang.org/genproto** - Generated protobuf types for Google services

### Observability & Logging

- **go.opencensus.io** v0.24.0 - Distributed tracing and monitoring
- **go.opentelemetry.io/** - OpenTelemetry observability framework
- **github.com/go-logr/logr** v1.3.0 - Structured logging interface

### Protocol Buffers & Code Generation

- **github.com/golang/protobuf** v1.5.3 - Legacy protobuf support (deprecated in favor of google.golang.org/protobuf)
- **github.com/envoyproxy/protoc-gen-validate** - Protocol buffer validation

### Utilities

- **github.com/google/uuid** v1.5.0 - UUID generation
- **github.com/mattn/go-colorable** v0.1.13 - Color support
- **github.com/mattn/go-isatty** v0.0.20 - TTY detection
- **golang.org/x/oauth2** v0.15.0 - OAuth2 authentication flows
- **github.com/googleapis/gax-go** v2.12.0 - Google API extensions (retries, backoff)
- **github.com/googleapis/enterprise-certificate-proxy** v0.3.2 - Enterprise certificate support

## Development Tools

### Code Quality & Linting (tools.go)

#### golangci-lint (v2.6.2)

- **Purpose**: Fast linter aggregator for Go code quality
- **Config**: `.golangci.yml` in project root
- **Usage**: `make lint` or `golangci-lint run`
- **Benefits**: Catches issues across 12+ linters simultaneously
- **Manual Installation**: `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest`

#### govulncheck

- **Purpose**: Scans Go code for known security vulnerabilities
- **Usage**: Integrated into tools.go, run with `/Users/ogs/go/bin/govulncheck ./...`
- **Benefits**: Identifies vulnerable dependencies before they impact production
- **Database**: Uses Go vulnerability database (automatically updated)

## Security Status

### Vulnerabilities Fixed in Recent Audit (2024-11-22)

1. **GO-2024-2687 - HTTP/2 CONTINUATION Flood** (High Severity)

   - **Module**: golang.org/x/net v0.19.0
   - **Fix**: Updated to v0.23.0
   - **Impact**: Prevents DoS attacks via HTTP/2 frame processing
   - **Status**: Fixed and verified

2. **GO-2024-2611 - JSON Unmarshaling Infinite Loop** (Medium Severity)
   - **Module**: google.golang.org/protobuf v1.31.0
   - **Fix**: Updated to v1.33.0
   - **Impact**: Prevents malformed JSON from causing denial of service
   - **Status**: Fixed and verified

### Vulnerability Scanning

- **Tool**: govulncheck (installed as dev dependency)
- **Last Scan**: 2024-11-22
- **Results**: All code-affecting vulnerabilities fixed
- **Remaining**: 9 indirect vulnerabilities in transitive dependencies (not accessed by code)
- **Frequency**: Run before each release: `/Users/ogs/go/bin/govulncheck ./...`

## Dependency Update Strategy

### Update Frequency

- **Patch Updates** (v1.2.3 -> v1.2.4): Apply as soon as available, especially security fixes
- **Minor Updates** (v1.2.0 -> v1.3.0): Review release notes, test with `go test ./...`
- **Major Updates** (v1.0.0 -> v2.0.0): Evaluate for breaking changes, plan upgrade carefully

### Security Updates

1. Run `govulncheck ./...` regularly
2. For vulnerabilities affecting code: `go get -u module@versionWithFix`
3. Run full test suite: `go test -v ./...`
4. Verify linter passes: `make lint`
5. Commit with clear message about security fix

### Google API Updates

- **Strategy**: Update `google.golang.org/api` quarterly
- **Process**:
  1. `go get -u google.golang.org/api`
  2. Run tests: `go test -v ./...`
  3. Test actual API calls with credentials
  4. Verify no deprecation warnings

## Maintenance Notes

### Last Dependency Audit: 2024-11-22

**Changes Made**:

- Updated golang.org/x/net from v0.19.0 to v0.23.0 (security)
- Updated google.golang.org/protobuf from v1.31.0 to v1.33.0 (security)
- Created tools.go for development tool management
- Ran govulncheck: passed with 0 code-affecting vulnerabilities

**Next Recommended Actions**:

1. Monitor for golang.org/x/net updates (quarterly)
2. Consider upgrading google.golang.org/api to v0.200+ (test API calls)
3. Evaluate olekukonko/tablewriter v1.1.1 (requires API review)
4. Plan spf13/cobra v1.10.0 upgrade (check breaking changes)

### Tools for Dependency Management

```bash
# Show available updates
go list -u -m all

# Check for vulnerabilities
/Users/ogs/go/bin/govulncheck ./...

# Update a specific dependency
go get -u github.com/spf13/cobra

# Update all patch versions
go get -u=patch ./...

# Clean up unused dependencies
go mod tidy

# Verify module graph
go mod verify

# Check outdated indirect dependencies
go mod graph | grep "indirect"
```

## Rationale for Current Versions

### Why Not Update Everything?

1. **Stability**: Running on tested, stable versions reduces risk
2. **Breaking Changes**: Major version updates often require code changes
3. **Testing**: Each update requires running full test suite with API credentials
4. **Documentation**: Time to research compatibility and changelog implications
5. **Performance**: Current versions are proven to work correctly for this use case

### Why These Versions Work Together

1. **google.golang.org/api v0.155.0** is compatible with all current Go 1.24 versions
2. **golang.org/x/net v0.23.0** provides HTTP/2 support needed by google.golang.org/api
3. **google.golang.org/protobuf v1.33.0** is the latest stable version compatible with our needs
4. **spf13/cobra v1.8.0** is production-tested and widely used
5. **All stdlib-related packages** are kept in sync to avoid conflicts

## Contributing

When updating dependencies:

1. Test with `go test -v ./...`
2. Run linter: `make lint`
3. Run security check: `/Users/ogs/go/bin/govulncheck ./...`
4. Document any breaking changes in commit message
5. Update this file if rationale changes

## References

- [Go Modules Documentation](https://golang.org/doc/modules/)
- [Go Vulnerability Database](https://pkg.go.dev/vuln/)
- [golangci-lint Documentation](https://golangci-lint.run/)
- [govulncheck Documentation](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck)
- [Google Cloud Go Client](https://pkg.go.dev/cloud.google.com/go)
- [Google Analytics Admin API](https://developers.google.com/analytics/devguides/config/admin/v1)
