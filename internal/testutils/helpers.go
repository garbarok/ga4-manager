package testutils

import (
	"testing"

	"github.com/garbarok/ga4-manager/internal/config"
)

// NewTestProject creates a test project configuration
func NewTestProject(name string, propertyID string) config.Project {
	return config.Project{
		Name:       name,
		PropertyID: propertyID,
		Conversions: []config.Conversion{
			{Name: "test_conversion_1", CountingMethod: "ONCE_PER_SESSION"},
			{Name: "test_conversion_2", CountingMethod: "ONCE_PER_EVENT"},
		},
		Dimensions: []config.CustomDimension{
			{ParameterName: "test_dimension_1", DisplayName: "Test Dimension 1", Scope: "USER"},
			{ParameterName: "test_dimension_2", DisplayName: "Test Dimension 2", Scope: "EVENT"},
		},
		Metrics: []config.CustomMetric{
			{DisplayName: "Test Metric 1", EventParameter: "test_metric_1", MeasurementUnit: "STANDARD", Scope: "EVENT"},
			{DisplayName: "Test Metric 2", EventParameter: "test_metric_2", MeasurementUnit: "CURRENCY", Scope: "EVENT"},
		},
	}
}

// NewTestConversion creates a test conversion
func NewTestConversion(name string, countingMethod string) config.Conversion {
	return config.Conversion{
		Name:           name,
		CountingMethod: countingMethod,
	}
}

// NewTestDimension creates a test custom dimension
func NewTestDimension(parameterName string, displayName string, scope string) config.CustomDimension {
	return config.CustomDimension{
		ParameterName: parameterName,
		DisplayName:   displayName,
		Scope:         scope,
	}
}

// NewTestMetric creates a test custom metric
func NewTestMetric(displayName string, eventParameter string, unit string) config.CustomMetric {
	return config.CustomMetric{
		DisplayName:     displayName,
		EventParameter:  eventParameter,
		MeasurementUnit: unit,
		Scope:           "EVENT",
	}
}

// AssertNoError asserts that there is no error
func AssertNoError(t *testing.T, err error, message string) {
	t.Helper()
	if err != nil {
		t.Fatalf("%s: %v", message, err)
	}
}

// AssertError asserts that there is an error
func AssertError(t *testing.T, err error, message string) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected error but got nil", message)
	}
}
