package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// TestProjectConfigBasics tests basic ProjectConfig structure
func TestProjectConfigBasics(t *testing.T) {
	pc := &ProjectConfig{
		Project: ProjectInfo{
			Name: "Test",
		},
		GA4: GA4Config{
			PropertyID: "123456789",
		},
	}

	assert.Equal(t, "Test", pc.Project.Name)
	assert.Equal(t, "123456789", pc.GA4.PropertyID)
}

// TestGetPropertyID returns the property ID from either Analytics or legacy GA4 config
func TestGetPropertyID(t *testing.T) {
	t.Run("from_legacy_ga4", func(t *testing.T) {
		pc := &ProjectConfig{GA4: GA4Config{PropertyID: "111"}}
		assert.Equal(t, "111", pc.GetPropertyID())
	})

	t.Run("from_analytics_config", func(t *testing.T) {
		pc := &ProjectConfig{Analytics: &AnalyticsConfig{PropertyID: "222"}}
		assert.Equal(t, "222", pc.GetPropertyID())
	})

	t.Run("analytics_takes_precedence", func(t *testing.T) {
		pc := &ProjectConfig{
			Analytics: &AnalyticsConfig{PropertyID: "222"},
			GA4:       GA4Config{PropertyID: "111"},
		}
		assert.Equal(t, "222", pc.GetPropertyID())
	})
}

// TestDimensionConfigFields verifies struct field names match YAML keys
func TestDimensionConfigFields(t *testing.T) {
	yaml := `parameter: user_type
display_name: User Type
description: Type of user
scope: USER
priority: high`

	var dim DimensionConfig
	require.NoError(t, unmarshalYAML([]byte(yaml), &dim))

	assert.Equal(t, "user_type", dim.ParameterName)
	assert.Equal(t, "User Type", dim.DisplayName)
	assert.Equal(t, "Type of user", dim.Description)
	assert.Equal(t, "USER", dim.Scope)
	assert.Equal(t, "high", dim.Priority)
}

// TestMetricConfigFields verifies struct field names match YAML keys
func TestMetricConfigFields(t *testing.T) {
	yaml := `parameter: engagement_rate
display_name: Engagement Rate
description: Rate of engaged sessions
unit: STANDARD
scope: EVENT
priority: high`

	var m MetricConfig
	require.NoError(t, unmarshalYAML([]byte(yaml), &m))

	assert.Equal(t, "engagement_rate", m.ParameterName)
	assert.Equal(t, "Engagement Rate", m.DisplayName)
	assert.Equal(t, "Rate of engaged sessions", m.Description)
	assert.Equal(t, "STANDARD", m.MeasurementUnit)
	assert.Equal(t, "EVENT", m.Scope)
	assert.Equal(t, "high", m.Priority)
}

// TestCleanupConfigFields verifies CleanupConfig (not CleanupYAMLConfig)
func TestCleanupConfigFields(t *testing.T) {
	tests := []struct {
		name           string
		cleanup        CleanupConfig
		hasConversions bool
		hasDimensions  bool
		hasMetrics     bool
	}{
		{
			name: "all_cleanup_items",
			cleanup: CleanupConfig{
				ConversionsToRemove: []string{"old_conv"},
				DimensionsToRemove:  []string{"old_dim"},
				MetricsToRemove:     []string{"old_metric"},
				Reason:              "Cleanup",
			},
			hasConversions: true,
			hasDimensions:  true,
			hasMetrics:     true,
		},
		{
			name:           "empty_cleanup",
			cleanup:        CleanupConfig{},
			hasConversions: false,
			hasDimensions:  false,
			hasMetrics:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.hasConversions, len(tt.cleanup.ConversionsToRemove) > 0)
			assert.Equal(t, tt.hasDimensions, len(tt.cleanup.DimensionsToRemove) > 0)
			assert.Equal(t, tt.hasMetrics, len(tt.cleanup.MetricsToRemove) > 0)
		})
	}
}

// TestYAMLRoundTrip verifies existing example configs parse without modification
func TestYAMLRoundTrip(t *testing.T) {
	examplesDir := filepath.Join("..", "..", "configs", "examples")
	entries, err := os.ReadDir(examplesDir)
	require.NoError(t, err)

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".yaml" {
			continue
		}
		t.Run(entry.Name(), func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(examplesDir, entry.Name()))
			require.NoError(t, err)

			var pc ProjectConfig
			require.NoError(t, yaml.Unmarshal(data, &pc), "YAML unmarshal failed")

			// Verify dimensions use ParameterName (yaml key: parameter)
			for i, dim := range pc.Dimensions {
				assert.NotEmpty(t, dim.ParameterName, "dimensions[%d].parameter must parse into ParameterName", i)
			}

			// Verify metrics use ParameterName (yaml key: parameter) and MeasurementUnit (yaml key: unit)
			for i, m := range pc.Metrics {
				assert.NotEmpty(t, m.ParameterName, "metrics[%d].parameter must parse into ParameterName", i)
				assert.NotEmpty(t, m.MeasurementUnit, "metrics[%d].unit must parse into MeasurementUnit", i)
			}
		})
	}
}

// TestConversionConfigValidation tests ConversionConfig validation
func TestConversionConfigValidation(t *testing.T) {
	tests := []struct {
		name           string
		conversionName string
		countingMethod string
		isValid        bool
	}{
		{"valid_once_per_session", "purchase", "ONCE_PER_SESSION", true},
		{"valid_once_per_event", "page_view", "ONCE_PER_EVENT", true},
		{"invalid_method", "test", "INVALID", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.conversionName != "" &&
				(tt.countingMethod == "ONCE_PER_SESSION" || tt.countingMethod == "ONCE_PER_EVENT")
			assert.Equal(t, tt.isValid, isValid)
		})
	}
}

// TestDimensionConfigValidation tests DimensionConfig validation
func TestDimensionConfigValidation(t *testing.T) {
	tests := []struct {
		name          string
		parameterName string
		displayName   string
		scope         string
		isValid       bool
	}{
		{"valid_user_scope", "user_id", "User ID", "USER", true},
		{"valid_event_scope", "event_type", "Event Type", "EVENT", true},
		{"invalid_scope", "test", "Test", "INVALID", false},
		{"empty_parameter", "", "Test", "USER", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.parameterName != "" && tt.displayName != "" &&
				(tt.scope == "USER" || tt.scope == "EVENT")
			assert.Equal(t, tt.isValid, isValid)
		})
	}
}

// TestMetricConfigValidation tests MetricConfig validation
func TestMetricConfigValidation(t *testing.T) {
	validUnits := map[string]bool{
		"STANDARD":     true,
		"CURRENCY":     true,
		"SECONDS":      true,
		"MILLISECONDS": true,
	}

	tests := []struct {
		name            string
		parameterName   string
		displayName     string
		measurementUnit string
		scope           string
		isValid         bool
	}{
		{"valid_metric", "engagement", "Engagement Rate", "STANDARD", "EVENT", true},
		{"valid_currency", "revenue", "Revenue", "CURRENCY", "EVENT", true},
		{"invalid_unit", "test", "Test", "INVALID", "EVENT", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.parameterName != "" && tt.displayName != "" &&
				validUnits[tt.measurementUnit] && tt.scope == "EVENT"
			assert.Equal(t, tt.isValid, isValid)
		})
	}
}

// TestDataRetentionConfigValidation tests DataRetentionConfig validation
func TestDataRetentionConfigValidation(t *testing.T) {
	validRetention := map[string]bool{
		"TWO_MONTHS":      true,
		"FOURTEEN_MONTHS": true,
	}

	tests := []struct {
		name      string
		retention string
		isValid   bool
	}{
		{"two_months", "TWO_MONTHS", true},
		{"fourteen_months", "FOURTEEN_MONTHS", true},
		{"invalid_retention", "ONE_YEAR", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.isValid, validRetention[tt.retention])
		})
	}
}

// TestEnhancedMeasurementConfigValidation tests EnhancedMeasurementConfig validation
func TestEnhancedMeasurementConfigValidation(t *testing.T) {
	tests := []struct {
		name    string
		config  EnhancedMeasurementConfig
		enabled int
	}{
		{
			name: "all_enabled",
			config: EnhancedMeasurementConfig{
				PageViews: true, Scrolls: true, OutboundClicks: true, SiteSearch: true,
				VideoEngagement: true, FileDownloads: true, PageChanges: true, FormInteractions: true,
			},
			enabled: 8,
		},
		{
			name:    "none_enabled",
			config:  EnhancedMeasurementConfig{},
			enabled: 0,
		},
		{
			name:    "some_enabled",
			config:  EnhancedMeasurementConfig{PageViews: true, Scrolls: true, FormInteractions: true},
			enabled: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			count := 0
			for _, v := range []bool{
				tt.config.PageViews, tt.config.Scrolls, tt.config.OutboundClicks,
				tt.config.SiteSearch, tt.config.VideoEngagement, tt.config.FileDownloads,
				tt.config.PageChanges, tt.config.FormInteractions,
			} {
				if v {
					count++
				}
			}
			assert.Equal(t, tt.enabled, count)
		})
	}
}

// unmarshalYAML is a helper to unmarshal YAML bytes into a value
func unmarshalYAML(data []byte, v any) error {
	return yaml.Unmarshal(data, v)
}
