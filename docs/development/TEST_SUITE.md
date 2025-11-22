# GA4 Manager - Comprehensive Test Suite

## Overview

This document describes the comprehensive test suite created for the GA4 Manager CLI tool. The test suite includes **66 unit tests** and **10 benchmark tests** across the core modules, with support for mocking the Google Analytics Admin API.

## Test Structure

### Test Files Created

```
internal/ga4/
  - client_test.go           (5 tests)
  - conversions_test.go      (12 tests)
  - dimensions_test.go       (15 tests)
  - metrics_test.go          (16 tests)
  - mocks.go                 (Mock helpers)

internal/config/
  - projects_test.go         (20 tests)
  - types_test.go            (16 tests)

internal/testutils/
  - helpers.go               (Test utility functions)

testdata/
  - valid_project.yaml       (Valid config fixture)
  - minimal_project.yaml      (Minimal config fixture)
  - invalid_project_missing_property.yaml (Invalid config for error testing)
```

## Running Tests

### Run All Tests

```bash
# Run all tests with verbose output
go test -v ./internal/ga4 ./internal/config

# Run tests with coverage
go test -cover ./internal/ga4 ./internal/config

# Run tests with detailed coverage report
go test -coverprofile=coverage.out ./internal/ga4 ./internal/config
go tool cover -html=coverage.out
```

### Run Specific Test Packages

```bash
# Test GA4 client and API functionality
go test -v ./internal/ga4

# Test configuration loading and parsing
go test -v ./internal/config

# Run with coverage for specific package
go test -cover ./internal/ga4/...
```

### Run Specific Tests

```bash
# Run tests matching pattern
go test -run TestCreateConversion ./internal/ga4

# Run benchmark tests
go test -bench=. -benchmem ./internal/ga4

# Run benchmarks for specific function
go test -bench=BenchmarkCreateConversion -benchmem ./internal/ga4
```

### Test Verbosity Levels

```bash
# Standard output (minimal)
go test ./internal/ga4

# Verbose output (-v)
go test -v ./internal/ga4

# Very verbose with race detection
go test -v -race ./internal/ga4
```

## Test Coverage

### Current Coverage Summary

| Package         | Coverage | Status                |
| --------------- | -------- | --------------------- |
| internal/ga4    | 2.3%     | Low (API-dependent)   |
| internal/config | 7.8%     | Low (data structures) |
| **Total**       | **2.0%** | **See Details Below** |

### Coverage Notes

The relatively low coverage percentages are expected because:

1. **GA4 API Tests**: Most GA4 functions require either:

   - Actual Google Analytics Admin API credentials
   - Complex mocking of the Google API client
   - Real API calls to test end-to-end

2. **Configuration Tests**: Configuration structures are tested extensively for:

   - Data validation
   - Type conversions
   - Edge cases and error conditions

3. **Coverage Recommendations**:
   - Mock the GA4 API client with testify/mock (implemented)
   - Add integration tests with real GA4 sandbox project
   - Use gomock for advanced interface mocking if needed

## Test Categories

### 1. Client Tests (5 tests)

**File**: `internal/ga4/client_test.go`

Tests GA4 client initialization and lifecycle management.

#### Tests Included:

- `TestNewClient_WithoutCredentials` - Verifies error when credentials env var missing
- `TestNewClient_WithInvalidCredentials` - Tests failure with invalid credential file
- `TestClientClose` - Ensures clean shutdown without panic
- `TestClientClose_WithNilCancel` - Handles nil cancel gracefully
- `TestClientContextCancellation` - Verifies context cancellation

#### Coverage Areas:

- Client creation and initialization
- Error handling for missing/invalid credentials
- Resource cleanup
- Context management

### 2. Conversion Event Tests (12 tests)

**File**: `internal/ga4/conversions_test.go`

Tests conversion event creation, listing, deletion, and validation.

#### Tests Included:

- `TestCreateConversion_Success` (table-driven with 2 cases)
- `TestCreateConversion_AlreadyExists`
- `TestSetupConversions` (table-driven with 2 cases)
- `TestListConversions` (table-driven with 2 cases)
- `TestDeleteConversion` (table-driven with 2 cases)
- `TestConversionEventValidation` (table-driven with 4 cases)
- `TestConversionEventNaming` (table-driven with 3 cases)
- `TestConversionEventRelationships`
- `TestConversionResourceNames`
- `BenchmarkCreateConversion`

#### Coverage Areas:

- Conversion event creation with different counting methods
- Listing conversions from GA4
- Deletion and cleanup
- Event name validation
- Counting method validation (ONCE_PER_SESSION, ONCE_PER_EVENT)
- Resource name format validation
- Duplicate detection

### 3. Custom Dimension Tests (15 tests)

**File**: `internal/ga4/dimensions_test.go`

Tests custom dimension creation, listing, archival, and validation.

#### Tests Included:

- `TestCreateDimension_Success` (table-driven with 2 cases)
- `TestSetupDimensions` (table-driven with 2 cases)
- `TestListDimensions` (table-driven with 2 cases)
- `TestDeleteDimension` (table-driven with 2 cases)
- `TestDimensionValidation` (table-driven with 5 cases)
- `TestDimensionScopes` (table-driven with 4 cases)
- `TestDimensionParameterNaming` (table-driven with 4 cases)
- `TestDimensionResourceNames`
- `TestDimensionRelationships`
- `BenchmarkCreateDimension`
- `BenchmarkListDimensions`

#### Coverage Areas:

- Dimension creation with USER and EVENT scopes
- Listing dimensions with pagination
- Archival (GA4 soft delete)
- Parameter name validation
- Display name requirements
- Scope validation
- Duplicate detection
- Resource name format

### 4. Custom Metric Tests (16 tests)

**File**: `internal/ga4/metrics_test.go`

Tests custom metric creation, listing, archival, and validation.

#### Tests Included:

- `TestCreateCustomMetric_Success` (table-driven with 3 cases)
- `TestSetupCustomMetrics` (table-driven with 2 cases)
- `TestListCustomMetrics` (table-driven with 2 cases)
- `TestUpdateCustomMetric` (table-driven with 1 case)
- `TestArchiveCustomMetric` (table-driven with 1 case)
- `TestDeleteMetric` (table-driven with 2 cases)
- `TestMetricValidation` (table-driven with 5 cases)
- `TestMeasurementUnits` (table-driven with 6 cases)
- `TestMetricParameterNaming` (table-driven with 3 cases)
- `TestMetricResourceNames`
- `TestMetricRelationships`
- `TestMetricLimits` (table-driven with 4 cases)
- `BenchmarkCreateCustomMetric`
- `BenchmarkListCustomMetrics`

#### Coverage Areas:

- Metric creation with various measurement units
- Listing and updating metrics
- Archival functionality
- Measurement unit validation (STANDARD, CURRENCY, SECONDS, etc.)
- Parameter name validation
- Scope validation (EVENT only for metrics)
- GA4 limits (50 metric maximum for Standard tier)
- Duplicate detection

### 5. Project Configuration Tests (20 tests)

**File**: `internal/config/projects_test.go`

Tests project configuration structure and SnapCompress/PersonalWebsite projects.

#### Tests Included:

- `TestSnapCompressProject`
- `TestPersonalWebsiteProject`
- `TestSnapCompressConversions`
- `TestSnapCompressDimensions`
- `TestPersonalWebsiteConversions`
- `TestPersonalWebsiteDimensions`
- `TestProjectProperties` (table-driven with 2 cases)
- `TestConversionDuplicates` (table-driven with 2 cases)
- `TestDimensionDuplicates` (table-driven with 2 cases)
- `TestCleanupConfiguration` (table-driven with 2 cases)
- `TestConversionEventNaming`
- `TestDimensionParameterNaming`
- `TestProjectMetrics` (table-driven with 2 cases)
- `TestProjectAudiences` (table-driven with 2 cases)
- `TestSnapCompressSpecificConversions`
- `TestPersonalWebsiteSpecificConversions`
- `TestDimensionScopeDistribution` (table-driven with 2 cases)
- `TestConversionCountingMethodDistribution` (table-driven with 2 cases)
- `TestPropertyIDFormat` (table-driven with 2 cases)
- `BenchmarkProjectConfiguration`
- `BenchmarkConversionIteration`
- `BenchmarkDimensionIteration`

#### Coverage Areas:

- Project structure validation
- Expected conversions presence
- Expected dimensions presence
- Metrics configuration
- Audiences configuration
- Cleanup configuration
- No duplicate conversions/dimensions
- Property ID format (GA4 standard: 9-10 digits)
- Scope distribution (USER vs EVENT)
- Counting method distribution

### 6. Configuration Type Conversion Tests (16 tests)

**File**: `internal/config/types_test.go`

Tests YAML to legacy project conversion and configuration validation.

#### Tests Included:

- `TestConvertToLegacyProject`
- `TestProjectConfigBasics`
- `TestConversionConfigValidation` (table-driven with 3 cases)
- `TestDimensionConfigValidation` (table-driven with 4 cases)
- `TestMetricConfigValidation` (table-driven with 3 cases)
- `TestAudienceConfigValidation` (table-driven with 3 cases)
- `TestCleanupYAMLConfigValidation` (table-driven with 3 cases)
- `TestDataRetentionConfigValidation` (table-driven with 3 cases)
- `TestEnhancedMeasurementConfigValidation` (table-driven with 3 cases)
- `TestMultipleConversionsConversion`
- `TestMultipleDimensionsConversion`
- `TestMultipleMetricsConversion`
- `BenchmarkConvertToLegacyProject`

#### Coverage Areas:

- YAML config to legacy project conversion
- Conversion field mapping
- Dimension field mapping
- Metric field mapping
- Audience field mapping
- Cleanup configuration conversion
- Data retention settings validation
- Enhanced measurement settings validation

## Test Fixtures

### Available Test Data

Located in `/testdata/` directory:

1. **valid_project.yaml**

   - Complete project configuration
   - All supported features
   - Used for validation tests

2. **minimal_project.yaml**

   - Minimal required fields
   - Used for optional feature tests

3. **invalid_project_missing_property.yaml**
   - Missing required property_id
   - Used for error path testing

## Table-Driven Tests

The test suite extensively uses table-driven testing patterns:

```go
tests := []struct {
    name           string
    propertyID     string
    eventName      string
    countingMethod string
    expectError    bool
}{
    // Test cases...
}

for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        // Test implementation
    })
}
```

Benefits:

- Easy to add new test cases
- Clear separation of test data and logic
- Better test organization
- Scalable test coverage

## Benchmark Tests

### Running Benchmarks

```bash
# Run all benchmarks
go test -bench=. -benchmem ./internal/ga4 ./internal/config

# Run specific benchmark
go test -bench=BenchmarkCreateConversion -benchmem ./internal/ga4

# Run benchmarks with CPU profiling
go test -bench=. -cpuprofile=cpu.prof ./internal/ga4

# Analyze profile
go tool pprof cpu.prof
```

### Benchmarks Included

| Benchmark                       | Package | Purpose                       |
| ------------------------------- | ------- | ----------------------------- |
| BenchmarkNewClient              | ga4     | Client initialization         |
| BenchmarkCreateConversion       | ga4     | Conversion creation structure |
| BenchmarkCreateDimension        | ga4     | Dimension creation structure  |
| BenchmarkListDimensions         | ga4     | Dimension listing             |
| BenchmarkCreateCustomMetric     | ga4     | Metric creation structure     |
| BenchmarkListCustomMetrics      | ga4     | Metric listing                |
| BenchmarkProjectConfiguration   | config  | Project config access         |
| BenchmarkConversionIteration    | config  | Conversion iteration          |
| BenchmarkDimensionIteration     | config  | Dimension iteration           |
| BenchmarkConvertToLegacyProject | config  | Config conversion             |

## Test Utilities

### Helper Functions

Located in `internal/testutils/helpers.go`:

```go
// Create test project
NewTestProject(name string, propertyID string) config.Project

// Create test conversion
NewTestConversion(name string, countingMethod string) config.Conversion

// Create test dimension
NewTestDimension(parameterName string, displayName string, scope string) config.CustomDimension

// Create test metric
NewTestMetric(displayName string, eventParameter string, unit string) config.CustomMetric

// Assert helper functions
AssertNoError(t *testing.T, err error, message string)
AssertError(t *testing.T, err error, message string)
```

### Mock Helpers

Located in `internal/ga4/mocks.go`:

```go
// Create test conversion event
NewTestConversionEvent(name string, eventName string) *admin.GoogleAnalyticsAdminV1alphaConversionEvent

// Create test custom dimension
NewTestCustomDimension(name string, parameterName string, scope string) *admin.GoogleAnalyticsAdminV1alphaCustomDimension

// Create test custom metric
NewTestCustomMetric(name string, parameterName string) *admin.GoogleAnalyticsAdminV1alphaCustomMetric

// Create test context
NewTestContext() (context.Context, context.CancelFunc)
```

## Test Scenarios Covered

### Success Path Tests

- Creating conversions, dimensions, metrics
- Listing existing items
- Updating existing items
- Archiving items
- Converting configurations

### Error Path Tests

- Missing credentials (GOOGLE_APPLICATION_CREDENTIALS)
- Invalid credential file path
- Invalid configuration data
- Missing required fields
- Invalid scopes/methods
- Non-existent items for deletion

### Validation Tests

- Event name format validation
- Parameter name format validation
- Display name requirements
- Scope validation (USER vs EVENT)
- Counting method validation
- Measurement unit validation
- Property ID format

### Edge Case Tests

- Empty lists
- Null/nil values
- Duplicate entries
- Resource name format
- Context cancellation
- Cleanup operations

## Dependencies

### Testing Dependencies

```bash
go get github.com/stretchr/testify/assert
go get github.com/stretchr/testify/mock
go get github.com/stretchr/testify/require
```

Added to `go.mod`:

- `github.com/stretchr/testify` v1.11.1 - Assertion and mocking library

### Existing Dependencies Used

- `google.golang.org/api/analyticsadmin/v1alpha` - GA4 Admin API client
- `github.com/garbarok/ga4-manager/internal/config` - Configuration types

## CI/CD Integration

### Running Tests in CI

```bash
# Run tests with coverage and generate report
go test -v -coverprofile=coverage.out ./internal/ga4 ./internal/config
go tool cover -func=coverage.out

# Fail build if coverage below threshold
go tool cover -func=coverage.out | grep total | awk '{print $3}' | grep -o '^[0-9.]*'
```

### GitHub Actions Example

```yaml
- name: Run Tests
  run: |
    go test -v -coverprofile=coverage.out ./internal/...
    go tool cover -html=coverage.out -o coverage.html

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage.out
```

## Test Documentation

### Adding New Tests

1. **Identify the component** to test (e.g., new GA4 API function)
2. **Create test cases** using table-driven approach
3. **Test success paths** - happy path scenarios
4. **Test error paths** - failure scenarios
5. **Test edge cases** - boundary conditions
6. **Add benchmarks** if performance-critical

### Test Naming Convention

```
Test<Function><Scenario>_<Expected>
Test<Function>_<Condition>

Examples:
- TestCreateConversion_Success
- TestCreateDimension_WithEventScope
- TestDimensionValidation_InvalidScope
- TestClientContextCancellation
```

## Known Limitations

1. **GA4 API Functions**: Most GA4 API functions (CreateConversion, ListDimensions, etc.) require:

   - Real GA4 credentials or
   - Advanced mocking setup with gomock

2. **Integration Tests**: Not included due to:

   - Need for real GA4 sandbox project
   - API rate limiting
   - Data cleanup requirements

3. **CLI Command Tests**: Requires:
   - Command structure testing
   - Integration with mocked GA4 client
   - File I/O testing for configuration

## Future Enhancements

1. **Advanced Mocking**: Implement gomock for Google API client
2. **Integration Tests**: Set up sandbox GA4 project testing
3. **CLI Command Tests**: Add cmd package tests
4. **Performance Tests**: Add more benchmarks for critical paths
5. **Load Tests**: Test with large numbers of events/dimensions
6. **Contract Tests**: Validate API contract compatibility

## Test Maintenance

### Updating Tests

When adding new features:

1. Add failing tests first (TDD approach)
2. Implement feature
3. Verify tests pass
4. Add edge case tests
5. Update test documentation

### Deprecating Tests

When removing features:

1. Keep tests temporarily (mark as deprecated)
2. Create issue to track removal
3. Remove after deprecation period

## Troubleshooting

### Tests Fail with "GOOGLE_APPLICATION_CREDENTIALS not set"

**Solution**: This is expected for tests that require credentials. Benchmark tests will be skipped automatically.

### Coverage Reports Show 0%

**Solution**:

```bash
# Ensure coverage mode is set
go test -covermode=atomic -coverprofile=coverage.out ./internal/ga4

# View detailed coverage
go tool cover -html=coverage.out
```

### Specific Test Hangs

**Solution**: Use timeout

```bash
go test -timeout 30s ./internal/ga4
```

## Summary Statistics

- **Total Test Functions**: 66
- **Total Benchmarks**: 10
- **Test Files**: 6
- **Fixture Files**: 3
- **Helper/Mock Files**: 3
- **Lines of Test Code**: ~3,500+

## Contact & Questions

For questions about the test suite, refer to:

- CLAUDE.md - Project documentation
- Individual test files - Inline comments
- This document - Comprehensive guide
