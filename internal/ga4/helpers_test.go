package ga4

import (
	"context"

	"github.com/stretchr/testify/mock"
	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

// MockAdminService is a mock of the Google Analytics Admin API service
type MockAdminService struct {
	mock.Mock
	Properties *MockPropertiesService
}

// MockPropertiesService is a mock of the Properties service
type MockPropertiesService struct {
	mock.Mock
	ConversionEvents  *MockConversionEventsService
	CustomDimensions  *MockCustomDimensionsService
	CustomMetrics     *MockCustomMetricsService
	CalculatedMetrics *MockCalculatedMetricsService
}

// MockConversionEventsService is a mock of the ConversionEvents service
type MockConversionEventsService struct {
	mock.Mock
}

// MockCustomDimensionsService is a mock of the CustomDimensions service
type MockCustomDimensionsService struct {
	mock.Mock
}

// MockCustomMetricsService is a mock of the CustomMetrics service
type MockCustomMetricsService struct {
	mock.Mock
}

// MockCalculatedMetricsService is a mock of the CalculatedMetrics service
type MockCalculatedMetricsService struct {
	mock.Mock
}

// Helper function to create test conversion events
func NewTestConversionEvent(name string, eventName string) *admin.GoogleAnalyticsAdminV1alphaConversionEvent {
	return &admin.GoogleAnalyticsAdminV1alphaConversionEvent{
		Name:      name,
		EventName: eventName,
	}
}

// Helper function to create test custom dimensions
func NewTestCustomDimension(name string, parameterName string, scope string) *admin.GoogleAnalyticsAdminV1alphaCustomDimension {
	return &admin.GoogleAnalyticsAdminV1alphaCustomDimension{
		Name:          name,
		ParameterName: parameterName,
		DisplayName:   "Test " + parameterName,
		Scope:         scope,
	}
}

// Helper function to create test custom metrics
func NewTestCustomMetric(name string, parameterName string) *admin.GoogleAnalyticsAdminV1alphaCustomMetric {
	return &admin.GoogleAnalyticsAdminV1alphaCustomMetric{
		Name:            name,
		ParameterName:   parameterName,
		DisplayName:     "Test " + parameterName,
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
	}
}

// NewTestContext creates a test context with cancel
func NewTestContext() (context.Context, context.CancelFunc) {
	return context.WithCancel(context.Background())
}
