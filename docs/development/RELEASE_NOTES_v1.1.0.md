# Release Notes - v1.1.0

**Release Date:** 2025-11-22
**Type:** Feature Release

## 🎉 New Features

### Custom Metrics Cleanup Support

Extended the `cleanup` command to support archiving custom metrics in addition to conversions and dimensions, providing complete GA4 property cleanup capability.

**New Command Options:**

```bash
# Remove only custom metrics
./ga4 cleanup --project snapcompress --type metrics

# Remove everything (conversions, dimensions, AND metrics)
./ga4 cleanup --project snapcompress --type all
```

**Why This Matters:**

- GA4 Standard tier has a **50 custom metrics limit**
- Previously, users could only clean up conversions and dimensions
- Now provides complete property cleanup for comprehensive GA4 management
- Helps teams stay within quota limits and maintain clean analytics

## 🔧 Technical Changes

### Files Modified

1. **internal/ga4/metrics.go**

   - Added `DeleteMetric(propertyID, parameterName)` function
   - Finds and archives metrics by parameter name via GA4 Admin API

2. **internal/config/projects.go**

   - Added `MetricsToRemove []string` field to `CleanupConfig` struct
   - Allows YAML configs to specify metrics for removal

3. **internal/config/types.go**

   - Added `MetricsToRemove` field to `CleanupYAMLConfig`
   - Updated `ConvertToLegacyProject()` to include metrics cleanup
   - Fixed linter issue: simplified audience conversion

4. **cmd/cleanup.go**

   - Extended `--type` flag validation to accept `metrics` value
   - Added metrics display table in dry-run and confirmation prompts
   - Implemented metrics archival logic with error handling
   - Updated command help text and usage examples

5. **internal/ga4/dimensions.go**

   - Added `PageSize(200)` to `ListDimensions()` to ensure all dimensions are retrieved
   - Fixes issue where only first 25 dimensions were shown

6. **cmd/helpers.go**
   - Removed unused `loadProjectOrDefault()` function (linter cleanup)

### Documentation Updates

- Updated CLAUDE.md with comprehensive metrics cleanup documentation
- Added "Important Limitations" section explaining GA4 parameter name reservation
- Updated usage examples to include metrics cleanup
- Added v1.1.0 feature changelog

## 🐛 Bug Fixes

- **ListDimensions pagination**: Fixed issue where only first 25 dimensions were returned by adding `PageSize(200)` parameter
- **Linter compliance**: Fixed staticcheck S1016 warning in audience conversion
- **Code cleanup**: Removed unused helper function

## ⚠️ Important Notes

### GA4 Parameter Name Limitation

When you archive a custom dimension or metric in GA4, the **parameter name is permanently reserved** and cannot be reused. This is a GA4 platform limitation, not a tool limitation.

**Workarounds:**

1. Un-archive in GA4 UI (Admin → Custom Definitions → filter by "Archived")
2. Use different parameter names for new items (e.g., `user_type_v2`)

**Best Practice:** Before running cleanup, ensure you truly want to remove items, as parameter names cannot be reused without manual GA4 UI intervention.

## 📊 Testing

- ✅ Build: Successful
- ✅ Linter: 0 issues
- ✅ Cleanup tested with SnapCompress property:
  - Removed 28 conversions
  - Archived 38 custom metrics (**NEW**)
  - Archived 62 custom dimensions
- ✅ All command flags validated (--type, --dry-run, --yes, --project, --config)

## 🚀 Usage Examples

### Basic Cleanup

```bash
# Preview changes (recommended first step)
./ga4 cleanup --project snapcompress --dry-run

# Remove only metrics
./ga4 cleanup --project snapcompress --type metrics

# Remove everything
./ga4 cleanup --project snapcompress --type all --yes
```

### With YAML Config

```bash
# Load cleanup config from YAML
./ga4 cleanup --config configs/my-project.yaml --dry-run
```

## 📦 Installation

Download the appropriate binary for your platform from the [Releases](https://github.com/garbarok/ga4-manager/releases/tag/v1.1.0) page:

- Linux (x86_64, ARM64)
- macOS (Intel, Apple Silicon)
- Windows (x86_64)

## 🔗 Links

- [CLAUDE.md Documentation](CLAUDE.md)
- [Cleanup Feature Documentation](CLAUDE.md#cleanup-feature)
- [GA4 Admin API](https://developers.google.com/analytics/devguides/config/admin/v1)

## 👥 Contributors

- Development: Claude Code Assistant
- Testing: @garbarok

---

**Full Changelog**: https://github.com/garbarok/ga4-manager/compare/v1.0.0...v1.1.0
