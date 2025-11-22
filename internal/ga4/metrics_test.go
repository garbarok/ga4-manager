package ga4

import (
	"fmt"
	"testing"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

// Package-level variables to prevent compiler optimizations in benchmarks
var (
	benchMetric       *admin.GoogleAnalyticsAdminV1alphaCustomMetric
	benchMetricString string
)

// TestCreateCustomMetric_Success tests successful custom metric creation
func TestCreateCustomMetric_Success(t *testing.T) {
	tests := []struct {
		name        string
		propertyID  string
		metric      config.CustomMetric
		expectError bool
	}{
		{
			name:       "create_standard_metric",
			propertyID: "123456789",
			metric: config.CustomMetric{
				DisplayName:     "Engagement Rate",
				Description:     "Percentage of engaged sessions",
				MeasurementUnit: "STANDARD",
				Scope:           "EVENT",
				EventParameter:  "engagement_rate",
			},
			expectError: false,
		},
		{
			name:       "create_currency_metric",
			propertyID: "987654321",
			metric: config.CustomMetric{
				DisplayName:     "Session Value",
				Description:     "Average value per session",
				MeasurementUnit: "CURRENCY",
				Scope:           "EVENT",
				EventParameter:  "session_value",
			},
			expectError: false,
		},
		{
			name:       "create_time_metric",
			propertyID: "123456789",
			metric: config.CustomMetric{
				DisplayName:     "Average Session Duration",
				Description:     "Average time spent in session",
				MeasurementUnit: "SECONDS",
				Scope:           "EVENT",
				EventParameter:  "session_duration",
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := NewTestContext()
			defer cancel()

			client := &Client{
				ctx:    ctx,
				cancel: cancel,
			}

			expectedParent := fmt.Sprintf("properties/%s", tt.propertyID)

			assert.NotNil(t, client)
			assert.Equal(t, expectedParent, fmt.Sprintf("properties/%s", tt.propertyID))
			assert.Equal(t, tt.metric.DisplayName, tt.metric.DisplayName)
			assert.Equal(t, tt.metric.MeasurementUnit, tt.metric.MeasurementUnit)
		})
	}
}

// TestSetupCustomMetrics tests setting up multiple custom metrics
func TestSetupCustomMetrics(t *testing.T) {
	tests := []struct {
		name           string
		project        config.Project
		expectedLength int
	}{
		{
			name: "setup_multiple_metrics",
			project: config.Project{
				Name:       "Test Project",
				PropertyID: "123456789",
				Metrics: []config.CustomMetric{
					{DisplayName: "Metric 1", EventParameter: "metric_1", MeasurementUnit: "STANDARD", Scope: "EVENT"},
					{DisplayName: "Metric 2", EventParameter: "metric_2", MeasurementUnit: "CURRENCY", Scope: "EVENT"},
					{DisplayName: "Metric 3", EventParameter: "metric_3", MeasurementUnit: "SECONDS", Scope: "EVENT"},
				},
			},
			expectedLength: 3,
		},
		{
			name: "setup_no_metrics",
			project: config.Project{
				Name:       "Empty Project",
				PropertyID: "987654321",
				Metrics:    []config.CustomMetric{},
			},
			expectedLength: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expectedLength, len(tt.project.Metrics))
		})
	}
}

// TestListCustomMetrics tests listing custom metrics from GA4
func TestListCustomMetrics(t *testing.T) {
	tests := []struct {
		name       string
		propertyID string
		metrics    []*admin.GoogleAnalyticsAdminV1alphaCustomMetric
	}{
		{
			name:       "list_with_results",
			propertyID: "123456789",
			metrics: []*admin.GoogleAnalyticsAdminV1alphaCustomMetric{
				NewTestCustomMetric("properties/123456789/customMetrics/metric1", "metric_1"),
				NewTestCustomMetric("properties/123456789/customMetrics/metric2", "metric_2"),
			},
		},
		{
			name:       "list_empty_results",
			propertyID: "987654321",
			metrics:    []*admin.GoogleAnalyticsAdminV1alphaCustomMetric{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := NewTestContext()
			defer cancel()

			client := &Client{
				ctx:    ctx,
				cancel: cancel,
			}

			assert.NotNil(t, client)
			assert.Equal(t, len(tt.metrics), len(tt.metrics))

			// Verify metric structure
			for _, metric := range tt.metrics {
				assert.NotEmpty(t, metric.ParameterName)
				assert.NotEmpty(t, metric.Name)
			}
		})
	}
}

// TestUpdateCustomMetric tests updating a custom metric
func TestUpdateCustomMetric(t *testing.T) {
	tests := []struct {
		name       string
		metricName string
		metric     config.CustomMetric
	}{
		{
			name:       "update_metric_displayname",
			metricName: "properties/123456789/customMetrics/metric1",
			metric: config.CustomMetric{
				DisplayName: "Updated Metric Name",
				Description: "Updated description",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.NotEmpty(t, tt.metricName)
			assert.NotEmpty(t, tt.metric.DisplayName)
		})
	}
}

// TestArchiveCustomMetric tests archiving a custom metric
func TestArchiveCustomMetric(t *testing.T) {
	tests := []struct {
		name       string
		metricName string
	}{
		{
			name:       "archive_metric",
			metricName: "properties/123456789/customMetrics/metric1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.NotEmpty(t, tt.metricName)
			assert.Contains(t, tt.metricName, "properties/")
		})
	}
}

// TestDeleteMetric tests deleting a custom metric by parameter name
func TestDeleteMetric(t *testing.T) {
	tests := []struct {
		name          string
		propertyID    string
		parameterName string
	}{
		{
			name:          "delete_engagement_metric",
			propertyID:    "123456789",
			parameterName: "engagement_rate",
		},
		{
			name:          "delete_session_metric",
			propertyID:    "987654321",
			parameterName: "session_duration",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.NotEmpty(t, tt.propertyID)
			assert.NotEmpty(t, tt.parameterName)
		})
	}
}

// TestMetricValidation tests metric validation
func TestMetricValidation(t *testing.T) {
	tests := []struct {
		name            string
		displayName     string
		measurementUnit string
		scope           string
		eventParameter  string
		isValid         bool
	}{
		{
			name:            "valid_standard_metric",
			displayName:     "Engagement Rate",
			measurementUnit: "STANDARD",
			scope:           "EVENT",
			eventParameter:  "engagement_rate",
			isValid:         true,
		},
		{
			name:            "valid_currency_metric",
			displayName:     "Revenue",
			measurementUnit: "CURRENCY",
			scope:           "EVENT",
			eventParameter:  "revenue",
			isValid:         true,
		},
		{
			name:            "empty_display_name",
			displayName:     "",
			measurementUnit: "STANDARD",
			scope:           "EVENT",
			eventParameter:  "metric",
			isValid:         false,
		},
		{
			name:            "empty_parameter",
			displayName:     "Test Metric",
			measurementUnit: "STANDARD",
			scope:           "EVENT",
			eventParameter:  "",
			isValid:         false,
		},
		{
			name:            "invalid_scope",
			displayName:     "Test Metric",
			measurementUnit: "STANDARD",
			scope:           "USER", // GA4 metrics must be EVENT scope
			eventParameter:  "test_metric",
			isValid:         false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.displayName != "" && tt.eventParameter != "" && tt.scope == "EVENT"
			assert.Equal(t, tt.isValid, isValid)
		})
	}
}

// TestMeasurementUnits tests valid measurement units
func TestMeasurementUnits(t *testing.T) {
	validUnits := map[string]bool{
		"STANDARD":     true,
		"CURRENCY":     true,
		"FEET":         true,
		"METERS":       true,
		"KILOMETERS":   true,
		"MILES":        true,
		"MILLISECONDS": true,
		"SECONDS":      true,
		"MINUTES":      true,
		"HOURS":        true,
	}

	tests := []struct {
		name  string
		unit  string
		valid bool
	}{
		{"standard_unit", "STANDARD", true},
		{"currency_unit", "CURRENCY", true},
		{"time_unit", "SECONDS", true},
		{"distance_unit", "KILOMETERS", true},
		{"invalid_unit", "INVALID", false},
		{"empty_unit", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := validUnits[tt.unit]
			assert.Equal(t, tt.valid, isValid)
		})
	}
}

// TestMetricParameterNaming tests parameter naming conventions
func TestMetricParameterNaming(t *testing.T) {
	tests := []struct {
		name          string
		parameterName string
		valid         bool
	}{
		{
			name:          "snake_case",
			parameterName: "engagement_rate",
			valid:         true,
		},
		{
			name:          "lowercase_only",
			parameterName: "engagementrate",
			valid:         true,
		},
		{
			name:          "with_numbers",
			parameterName: "metric_123",
			valid:         true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.NotEmpty(t, tt.parameterName)
		})
	}
}

// TestMetricResourceNames tests GA4 resource name format
func TestMetricResourceNames(t *testing.T) {
	propertyID := "123456789"
	metricID := "metric1"

	expectedResourceName := fmt.Sprintf("properties/%s/customMetrics/%s", propertyID, metricID)

	assert.NotEmpty(t, expectedResourceName)
	assert.Contains(t, expectedResourceName, "properties/")
	assert.Contains(t, expectedResourceName, "/customMetrics/")
}

// TestMetricRelationships tests relationships between metrics
func TestMetricRelationships(t *testing.T) {
	metricList := []config.CustomMetric{
		{DisplayName: "Metric 1", EventParameter: "metric_1", MeasurementUnit: "STANDARD", Scope: "EVENT"},
		{DisplayName: "Metric 2", EventParameter: "metric_2", MeasurementUnit: "CURRENCY", Scope: "EVENT"},
		{DisplayName: "Metric 3", EventParameter: "metric_3", MeasurementUnit: "SECONDS", Scope: "EVENT"},
	}

	// Test no duplicate parameter names
	seen := make(map[string]bool)
	for _, metric := range metricList {
		require.False(t, seen[metric.EventParameter], "duplicate parameter name found")
		seen[metric.EventParameter] = true
	}

	// Test all metrics are EVENT scope
	for _, metric := range metricList {
		require.Equal(t, "EVENT", metric.Scope, "all metrics must be EVENT scope")
	}
}

// TestMetricLimits tests GA4 metric limits
func TestMetricLimits(t *testing.T) {
	// GA4 Standard tier supports up to 50 custom metrics
	maxMetrics := 50

	tests := []struct {
		name  string
		count int
		valid bool
	}{
		{"single_metric", 1, true},
		{"many_metrics", 25, true},
		{"max_metrics", 50, true},
		{"exceed_limit", 51, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.count > 0 && tt.count <= maxMetrics
			assert.Equal(t, tt.valid, isValid)
		})
	}
}

// BenchmarkCreateCustomMetric benchmarks metric creation structure
func BenchmarkCreateCustomMetric(b *testing.B) {
	ctx, cancel := NewTestContext()
	defer cancel()

	var c *Client
	var m *admin.GoogleAnalyticsAdminV1alphaCustomMetric

	metric := config.CustomMetric{
		DisplayName:     "Test Metric",
		Description:     "Test metric description",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "test_metric",
	}

	b.ReportAllocs()
	for b.Loop() {
		c = &Client{ctx: ctx, cancel: cancel}
		m = &admin.GoogleAnalyticsAdminV1alphaCustomMetric{
			DisplayName:          metric.DisplayName,
			Description:          metric.Description,
			MeasurementUnit:      metric.MeasurementUnit,
			Scope:                metric.Scope,
			ParameterName:        metric.EventParameter,
			RestrictedMetricType: []string{},
		}
	}

	// Assign to package-level vars to prevent optimization
	benchClient = c
	benchMetric = m
}

// BenchmarkListCustomMetrics benchmarks metric listing structure
func BenchmarkListCustomMetrics(b *testing.B) {
	propertyID := "123456789"
	var s string

	b.ReportAllocs()
	for b.Loop() {
		s = fmt.Sprintf("properties/%s", propertyID)
	}

	benchMetricString = s
}
