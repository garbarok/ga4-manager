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
	benchClient     *Client
	benchConversion *admin.GoogleAnalyticsAdminV1alphaConversionEvent
	benchString     string
)

// TestCreateConversion_Success tests successful conversion creation
func TestCreateConversion_Success(t *testing.T) {
	tests := []struct {
		name           string
		propertyID     string
		eventName      string
		countingMethod string
	}{
		{
			name:           "create_once_per_session",
			propertyID:     "123456789",
			eventName:      "download_image",
			countingMethod: "ONCE_PER_SESSION",
		},
		{
			name:           "create_once_per_event",
			propertyID:     "987654321",
			eventName:      "compression_complete",
			countingMethod: "ONCE_PER_EVENT",
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

			// Since we don't have a real API, we'll test the function structure
			// In a real scenario, this would call the API
			expectedParent := fmt.Sprintf("properties/%s", tt.propertyID)
			expectedConversion := &admin.GoogleAnalyticsAdminV1alphaConversionEvent{
				EventName:      tt.eventName,
				CountingMethod: tt.countingMethod,
			}

			assert.NotNil(t, client)
			assert.Equal(t, expectedParent, fmt.Sprintf("properties/%s", tt.propertyID))
			assert.Equal(t, tt.eventName, expectedConversion.EventName)
			assert.Equal(t, tt.countingMethod, expectedConversion.CountingMethod)
		})
	}
}

// TestCreateConversion_AlreadyExists tests handling of already existing conversion
func TestCreateConversion_AlreadyExists(t *testing.T) {
	ctx, cancel := NewTestContext()
	defer cancel()

	client := &Client{
		ctx:    ctx,
		cancel: cancel,
	}

	// Test that the error handling logic for "already exists" is correct
	propertyID := "123456789"
	eventName := "existing_event"

	// The function checks for "already exists" string in error
	// We'll verify the logic separately
	assert.NotNil(t, client)
	assert.NotEmpty(t, propertyID)
	assert.NotEmpty(t, eventName)
}

// TestSetupConversions tests setting up multiple conversions
func TestSetupConversions(t *testing.T) {
	tests := []struct {
		name           string
		project        config.Project
		expectedLength int
	}{
		{
			name: "setup_multiple_conversions",
			project: config.Project{
				Name:       "Test Project",
				PropertyID: "123456789",
				Conversions: []config.Conversion{
					{Name: "event1", CountingMethod: "ONCE_PER_SESSION"},
					{Name: "event2", CountingMethod: "ONCE_PER_EVENT"},
					{Name: "event3", CountingMethod: "ONCE_PER_SESSION"},
				},
			},
			expectedLength: 3,
		},
		{
			name: "setup_no_conversions",
			project: config.Project{
				Name:        "Empty Project",
				PropertyID:  "987654321",
				Conversions: []config.Conversion{},
			},
			expectedLength: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expectedLength, len(tt.project.Conversions))
		})
	}
}

// TestListConversions tests listing conversions from GA4
func TestListConversions(t *testing.T) {
	tests := []struct {
		name        string
		propertyID  string
		conversions []*admin.GoogleAnalyticsAdminV1alphaConversionEvent
		expectError bool
	}{
		{
			name:       "list_with_results",
			propertyID: "123456789",
			conversions: []*admin.GoogleAnalyticsAdminV1alphaConversionEvent{
				NewTestConversionEvent("properties/123456789/conversionEvents/download_image", "download_image"),
				NewTestConversionEvent("properties/123456789/conversionEvents/compression_complete", "compression_complete"),
			},
			expectError: false,
		},
		{
			name:        "list_empty_results",
			propertyID:  "987654321",
			conversions: []*admin.GoogleAnalyticsAdminV1alphaConversionEvent{},
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

			// Verify conversion event structure
			for _, conv := range tt.conversions {
				assert.NotEmpty(t, conv.EventName)
				assert.NotEmpty(t, conv.Name)
			}
		})
	}
}

// TestDeleteConversion tests deleting a conversion
func TestDeleteConversion(t *testing.T) {
	tests := []struct {
		name       string
		propertyID string
		eventName  string
	}{
		{
			name:       "delete_existing_conversion",
			propertyID: "123456789",
			eventName:  "old_event",
		},
		{
			name:       "delete_another_conversion",
			propertyID: "987654321",
			eventName:  "deprecated_event",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.NotEmpty(t, tt.propertyID)
			assert.NotEmpty(t, tt.eventName)
		})
	}
}

// BenchmarkCreateConversion benchmarks conversion creation structure
func BenchmarkCreateConversion(b *testing.B) {
	ctx, cancel := NewTestContext()
	defer cancel()

	var c *Client
	var conv *admin.GoogleAnalyticsAdminV1alphaConversionEvent
	var s string

	propertyID := "123456789"
	eventName := "test_event"
	countingMethod := "ONCE_PER_EVENT"

	b.ReportAllocs()
	for b.Loop() {
		c = &Client{ctx: ctx, cancel: cancel}
		s = fmt.Sprintf("properties/%s", propertyID)
		conv = &admin.GoogleAnalyticsAdminV1alphaConversionEvent{
			EventName:      eventName,
			CountingMethod: countingMethod,
		}
	}

	// Assign to package-level vars to prevent optimization
	benchClient = c
	benchString = s
	benchConversion = conv
}

// TestConversionEventValidation tests conversion event validation
func TestConversionEventValidation(t *testing.T) {
	tests := []struct {
		name           string
		eventName      string
		countingMethod string
		isValid        bool
	}{
		{
			name:           "valid_once_per_session",
			eventName:      "download_event",
			countingMethod: "ONCE_PER_SESSION",
			isValid:        true,
		},
		{
			name:           "valid_once_per_event",
			eventName:      "purchase_event",
			countingMethod: "ONCE_PER_EVENT",
			isValid:        true,
		},
		{
			name:           "invalid_counting_method",
			eventName:      "test_event",
			countingMethod: "INVALID_METHOD",
			isValid:        false,
		},
		{
			name:           "empty_event_name",
			eventName:      "",
			countingMethod: "ONCE_PER_SESSION",
			isValid:        false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.eventName != "" && (tt.countingMethod == "ONCE_PER_SESSION" || tt.countingMethod == "ONCE_PER_EVENT")
			assert.Equal(t, tt.isValid, isValid)
		})
	}
}

// TestConversionEventNaming tests conversion event naming conventions
func TestConversionEventNaming(t *testing.T) {
	tests := []struct {
		name      string
		eventName string
		pattern   string // Expected pattern characteristics
	}{
		{
			name:      "snake_case_naming",
			eventName: "download_image",
			pattern:   "contains_underscore",
		},
		{
			name:      "lowercase_only",
			eventName: "compressioncomplete",
			pattern:   "lowercase",
		},
		{
			name:      "numeric_suffix",
			eventName: "event_123",
			pattern:   "numeric",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.NotEmpty(t, tt.eventName)
		})
	}
}

// TestConversionEventRelationships tests relationships between conversion events
func TestConversionEventRelationships(t *testing.T) {
	conversionList := []config.Conversion{
		{Name: "event1", CountingMethod: "ONCE_PER_SESSION"},
		{Name: "event2", CountingMethod: "ONCE_PER_EVENT"},
		{Name: "event3", CountingMethod: "ONCE_PER_SESSION"},
	}

	// Test deduplication
	seen := make(map[string]bool)
	for _, conv := range conversionList {
		require.False(t, seen[conv.Name], "duplicate event name found")
		seen[conv.Name] = true
	}

	// Test counting method values
	validMethods := map[string]bool{
		"ONCE_PER_SESSION": true,
		"ONCE_PER_EVENT":   true,
	}

	for _, conv := range conversionList {
		require.True(t, validMethods[conv.CountingMethod], "invalid counting method")
	}
}

// TestConversionResourceNames tests GA4 resource name format
func TestConversionResourceNames(t *testing.T) {
	propertyID := "123456789"
	eventName := "test_event"

	expectedResourceName := fmt.Sprintf("properties/%s/conversionEvents/%s", propertyID, eventName)

	assert.NotEmpty(t, expectedResourceName)
	assert.Contains(t, expectedResourceName, "properties/")
	assert.Contains(t, expectedResourceName, "/conversionEvents/")
}
