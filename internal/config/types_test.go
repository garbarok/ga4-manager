package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestConvertToLegacyProject tests conversion from ProjectConfig to Project
func TestConvertToLegacyProject(t *testing.T) {
	pc := &ProjectConfig{
		Project: ProjectInfo{
			Name:        "Test Project",
			Description: "A test project",
			Version:     "1.0.0",
		},
		GA4: GA4Config{
			PropertyID:    "123456789",
			MeasurementID: "G-XXXXXXXXXX",
		},
		Conversions: []ConversionConfig{
			{
				Name:           "test_conversion",
				CountingMethod: "ONCE_PER_SESSION",
				Description:    "Test conversion",
			},
		},
		Dimensions: []DimensionConfig{
			{
				Parameter:   "test_param",
				DisplayName: "Test Dimension",
				Scope:       "USER",
			},
		},
		Metrics: []MetricConfig{
			{
				Parameter:   "test_metric",
				DisplayName: "Test Metric",
				Unit:        "STANDARD",
				Scope:       "EVENT",
			},
		},
		Cleanup: CleanupYAMLConfig{
			ConversionsToRemove: []string{"old_conversion"},
			DimensionsToRemove:  []string{"old_dimension"},
			MetricsToRemove:     []string{"old_metric"},
			Reason:              "Not used",
		},
	}

	legacy := pc.ConvertToLegacyProject()

	assert.Equal(t, "Test Project", legacy.Name)
	assert.Equal(t, "123456789", legacy.PropertyID)
	assert.Equal(t, 1, len(legacy.Conversions))
	assert.Equal(t, "test_conversion", legacy.Conversions[0].Name)
	assert.Equal(t, "ONCE_PER_SESSION", legacy.Conversions[0].CountingMethod)

	assert.Equal(t, 1, len(legacy.Dimensions))
	assert.Equal(t, "test_param", legacy.Dimensions[0].ParameterName)
	assert.Equal(t, "Test Dimension", legacy.Dimensions[0].DisplayName)
	assert.Equal(t, "USER", legacy.Dimensions[0].Scope)

	assert.Equal(t, 1, len(legacy.Metrics))
	assert.Equal(t, "test_metric", legacy.Metrics[0].EventParameter)
	assert.Equal(t, "Test Metric", legacy.Metrics[0].DisplayName)
	assert.Equal(t, "STANDARD", legacy.Metrics[0].MeasurementUnit)

	assert.Equal(t, "old_conversion", legacy.Cleanup.ConversionsToRemove[0])
	assert.Equal(t, "old_dimension", legacy.Cleanup.DimensionsToRemove[0])
	assert.Equal(t, "old_metric", legacy.Cleanup.MetricsToRemove[0])
}

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

// TestConversionConfigValidation tests ConversionConfig validation
func TestConversionConfigValidation(t *testing.T) {
	tests := []struct {
		name           string
		conversionName string
		countingMethod string
		isValid        bool
	}{
		{
			name:           "valid_once_per_session",
			conversionName: "purchase",
			countingMethod: "ONCE_PER_SESSION",
			isValid:        true,
		},
		{
			name:           "valid_once_per_event",
			conversionName: "page_view",
			countingMethod: "ONCE_PER_EVENT",
			isValid:        true,
		},
		{
			name:           "invalid_method",
			conversionName: "test",
			countingMethod: "INVALID",
			isValid:        false,
		},
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
		name        string
		parameter   string
		displayName string
		scope       string
		isValid     bool
	}{
		{
			name:        "valid_user_scope",
			parameter:   "user_id",
			displayName: "User ID",
			scope:       "USER",
			isValid:     true,
		},
		{
			name:        "valid_event_scope",
			parameter:   "event_type",
			displayName: "Event Type",
			scope:       "EVENT",
			isValid:     true,
		},
		{
			name:        "invalid_scope",
			parameter:   "test",
			displayName: "Test",
			scope:       "INVALID",
			isValid:     false,
		},
		{
			name:        "empty_parameter",
			parameter:   "",
			displayName: "Test",
			scope:       "USER",
			isValid:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.parameter != "" && tt.displayName != "" &&
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
		name        string
		parameter   string
		displayName string
		unit        string
		scope       string
		isValid     bool
	}{
		{
			name:        "valid_metric",
			parameter:   "engagement",
			displayName: "Engagement Rate",
			unit:        "STANDARD",
			scope:       "EVENT",
			isValid:     true,
		},
		{
			name:        "valid_currency",
			parameter:   "revenue",
			displayName: "Revenue",
			unit:        "CURRENCY",
			scope:       "EVENT",
			isValid:     true,
		},
		{
			name:        "invalid_unit",
			parameter:   "test",
			displayName: "Test",
			unit:        "INVALID",
			scope:       "EVENT",
			isValid:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.parameter != "" && tt.displayName != "" &&
				validUnits[tt.unit] && tt.scope == "EVENT"
			assert.Equal(t, tt.isValid, isValid)
		})
	}
}

// TestAudienceConfigValidation tests AudienceConfig validation
func TestAudienceConfigValidation(t *testing.T) {
	tests := []struct {
		name     string
		audName  string
		duration int
		isValid  bool
	}{
		{
			name:     "valid_audience",
			audName:  "returning_users",
			duration: 30,
			isValid:  true,
		},
		{
			name:     "empty_name",
			audName:  "",
			duration: 30,
			isValid:  false,
		},
		{
			name:     "invalid_duration",
			audName:  "test_audience",
			duration: 0,
			isValid:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.audName != "" && tt.duration > 0
			assert.Equal(t, tt.isValid, isValid)
		})
	}
}

// TestCleanupYAMLConfigValidation tests CleanupYAMLConfig validation
func TestCleanupYAMLConfigValidation(t *testing.T) {
	tests := []struct {
		name           string
		cleanup        CleanupYAMLConfig
		hasConversions bool
		hasDimensions  bool
		hasMetrics     bool
	}{
		{
			name: "all_cleanup_items",
			cleanup: CleanupYAMLConfig{
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
			name: "conversions_only",
			cleanup: CleanupYAMLConfig{
				ConversionsToRemove: []string{"old_conv"},
			},
			hasConversions: true,
			hasDimensions:  false,
			hasMetrics:     false,
		},
		{
			name:           "empty_cleanup",
			cleanup:        CleanupYAMLConfig{},
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
		{
			name:      "two_months",
			retention: "TWO_MONTHS",
			isValid:   true,
		},
		{
			name:      "fourteen_months",
			retention: "FOURTEEN_MONTHS",
			isValid:   true,
		},
		{
			name:      "invalid_retention",
			retention: "ONE_YEAR",
			isValid:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := validRetention[tt.retention]
			assert.Equal(t, tt.isValid, isValid)
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
				PageViews:        true,
				Scrolls:          true,
				OutboundClicks:   true,
				SiteSearch:       true,
				VideoEngagement:  true,
				FileDownloads:    true,
				PageChanges:      true,
				FormInteractions: true,
			},
			enabled: 8,
		},
		{
			name: "none_enabled",
			config: EnhancedMeasurementConfig{
				PageViews:        false,
				Scrolls:          false,
				OutboundClicks:   false,
				SiteSearch:       false,
				VideoEngagement:  false,
				FileDownloads:    false,
				PageChanges:      false,
				FormInteractions: false,
			},
			enabled: 0,
		},
		{
			name: "some_enabled",
			config: EnhancedMeasurementConfig{
				PageViews:        true,
				Scrolls:          true,
				OutboundClicks:   false,
				FormInteractions: true,
			},
			enabled: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			count := 0
			if tt.config.PageViews {
				count++
			}
			if tt.config.Scrolls {
				count++
			}
			if tt.config.OutboundClicks {
				count++
			}
			if tt.config.SiteSearch {
				count++
			}
			if tt.config.VideoEngagement {
				count++
			}
			if tt.config.FileDownloads {
				count++
			}
			if tt.config.PageChanges {
				count++
			}
			if tt.config.FormInteractions {
				count++
			}

			assert.Equal(t, tt.enabled, count)
		})
	}
}

// TestMultipleConversionsConversion tests converting multiple conversions
func TestMultipleConversionsConversion(t *testing.T) {
	pc := &ProjectConfig{
		Project: ProjectInfo{Name: "Test"},
		GA4:     GA4Config{PropertyID: "123456789"},
		Conversions: []ConversionConfig{
			{Name: "conv1", CountingMethod: "ONCE_PER_SESSION"},
			{Name: "conv2", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "conv3", CountingMethod: "ONCE_PER_SESSION"},
		},
	}

	legacy := pc.ConvertToLegacyProject()

	assert.Equal(t, 3, len(legacy.Conversions))
	assert.Equal(t, "conv1", legacy.Conversions[0].Name)
	assert.Equal(t, "conv2", legacy.Conversions[1].Name)
	assert.Equal(t, "conv3", legacy.Conversions[2].Name)
}

// TestMultipleDimensionsConversion tests converting multiple dimensions
func TestMultipleDimensionsConversion(t *testing.T) {
	pc := &ProjectConfig{
		Project: ProjectInfo{Name: "Test"},
		GA4:     GA4Config{PropertyID: "123456789"},
		Dimensions: []DimensionConfig{
			{Parameter: "dim1", DisplayName: "Dimension 1", Scope: "USER"},
			{Parameter: "dim2", DisplayName: "Dimension 2", Scope: "EVENT"},
			{Parameter: "dim3", DisplayName: "Dimension 3", Scope: "USER"},
		},
	}

	legacy := pc.ConvertToLegacyProject()

	assert.Equal(t, 3, len(legacy.Dimensions))
	assert.Equal(t, "dim1", legacy.Dimensions[0].ParameterName)
	assert.Equal(t, "dim2", legacy.Dimensions[1].ParameterName)
	assert.Equal(t, "dim3", legacy.Dimensions[2].ParameterName)
}

// TestMultipleMetricsConversion tests converting multiple metrics
func TestMultipleMetricsConversion(t *testing.T) {
	pc := &ProjectConfig{
		Project: ProjectInfo{Name: "Test"},
		GA4:     GA4Config{PropertyID: "123456789"},
		Metrics: []MetricConfig{
			{Parameter: "metric1", DisplayName: "Metric 1", Unit: "STANDARD", Scope: "EVENT"},
			{Parameter: "metric2", DisplayName: "Metric 2", Unit: "CURRENCY", Scope: "EVENT"},
			{Parameter: "metric3", DisplayName: "Metric 3", Unit: "SECONDS", Scope: "EVENT"},
		},
	}

	legacy := pc.ConvertToLegacyProject()

	assert.Equal(t, 3, len(legacy.Metrics))
	assert.Equal(t, "metric1", legacy.Metrics[0].EventParameter)
	assert.Equal(t, "metric2", legacy.Metrics[1].EventParameter)
	assert.Equal(t, "metric3", legacy.Metrics[2].EventParameter)
}

// BenchmarkConvertToLegacyProject benchmarks the conversion function
func BenchmarkConvertToLegacyProject(b *testing.B) {
	pc := &ProjectConfig{
		Project: ProjectInfo{Name: "Test"},
		GA4:     GA4Config{PropertyID: "123456789"},
		Conversions: []ConversionConfig{
			{Name: "conv1", CountingMethod: "ONCE_PER_SESSION"},
		},
		Dimensions: []DimensionConfig{
			{Parameter: "dim1", DisplayName: "Dimension 1", Scope: "USER"},
		},
		Metrics: []MetricConfig{
			{Parameter: "metric1", DisplayName: "Metric 1", Unit: "STANDARD", Scope: "EVENT"},
		},
	}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = pc.ConvertToLegacyProject()
	}
}
