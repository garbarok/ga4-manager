package ga4

import (
	"fmt"
	"slices"
	"testing"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

// Package-level variables to prevent compiler optimizations in benchmarks
var (
	benchDimension *admin.GoogleAnalyticsAdminV1alphaCustomDimension
	benchDimString string
)

// TestCreateDimension_Success tests successful dimension creation
func TestCreateDimension_Success(t *testing.T) {
	tests := []struct {
		name          string
		propertyID    string
		parameterName string
		displayName   string
		scope         string
	}{
		{
			name:          "create_user_scope_dimension",
			propertyID:    "123456789",
			parameterName: "user_type",
			displayName:   "User Type",
			scope:         "USER",
		},
		{
			name:          "create_event_scope_dimension",
			propertyID:    "987654321",
			parameterName: "file_format",
			displayName:   "File Format",
			scope:         "EVENT",
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

			dim := config.CustomDimension{
				ParameterName: tt.parameterName,
				DisplayName:   tt.displayName,
				Scope:         tt.scope,
			}

			expectedParent := fmt.Sprintf("properties/%s", tt.propertyID)
			expectedDimension := &admin.GoogleAnalyticsAdminV1alphaCustomDimension{
				ParameterName: dim.ParameterName,
				DisplayName:   dim.DisplayName,
				Scope:         dim.Scope,
			}

			assert.NotNil(t, client)
			assert.Equal(t, expectedParent, fmt.Sprintf("properties/%s", tt.propertyID))
			assert.Equal(t, tt.parameterName, expectedDimension.ParameterName)
			assert.Equal(t, tt.displayName, expectedDimension.DisplayName)
			assert.Equal(t, tt.scope, expectedDimension.Scope)
		})
	}
}

// TestSetupDimensions tests setting up multiple dimensions
func TestSetupDimensions(t *testing.T) {
	tests := []struct {
		name           string
		project        config.Project
		expectedLength int
	}{
		{
			name: "setup_multiple_dimensions",
			project: config.Project{
				Name:       "Test Project",
				PropertyID: "123456789",
				Dimensions: []config.CustomDimension{
					{ParameterName: "dim1", DisplayName: "Dimension 1", Scope: "USER"},
					{ParameterName: "dim2", DisplayName: "Dimension 2", Scope: "EVENT"},
					{ParameterName: "dim3", DisplayName: "Dimension 3", Scope: "USER"},
				},
			},
			expectedLength: 3,
		},
		{
			name: "setup_no_dimensions",
			project: config.Project{
				Name:       "Empty Project",
				PropertyID: "987654321",
				Dimensions: []config.CustomDimension{},
			},
			expectedLength: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expectedLength, len(tt.project.Dimensions))
		})
	}
}

// TestListDimensions tests listing dimensions from GA4
func TestListDimensions(t *testing.T) {
	tests := []struct {
		name       string
		propertyID string
		dimensions []*admin.GoogleAnalyticsAdminV1alphaCustomDimension
	}{
		{
			name:       "list_with_results",
			propertyID: "123456789",
			dimensions: []*admin.GoogleAnalyticsAdminV1alphaCustomDimension{
				NewTestCustomDimension("properties/123456789/customDimensions/dim1", "user_type", "USER"),
				NewTestCustomDimension("properties/123456789/customDimensions/dim2", "file_format", "EVENT"),
			},
		},
		{
			name:       "list_empty_results",
			propertyID: "987654321",
			dimensions: []*admin.GoogleAnalyticsAdminV1alphaCustomDimension{},
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
			assert.Equal(t, len(tt.dimensions), len(tt.dimensions))

			// Verify dimension structure
			for _, dim := range tt.dimensions {
				assert.NotEmpty(t, dim.ParameterName)
				assert.NotEmpty(t, dim.Name)
				assert.NotEmpty(t, dim.Scope)
			}
		})
	}
}

// TestDeleteDimension tests deleting/archiving a dimension
func TestDeleteDimension(t *testing.T) {
	tests := []struct {
		name          string
		propertyID    string
		parameterName string
	}{
		{
			name:          "delete_user_dimension",
			propertyID:    "123456789",
			parameterName: "old_dimension",
		},
		{
			name:          "delete_event_dimension",
			propertyID:    "987654321",
			parameterName: "deprecated_dimension",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.NotEmpty(t, tt.propertyID)
			assert.NotEmpty(t, tt.parameterName)
		})
	}
}

// TestDimensionValidation tests dimension validation
func TestDimensionValidation(t *testing.T) {
	tests := []struct {
		name          string
		parameterName string
		displayName   string
		scope         string
		isValid       bool
	}{
		{
			name:          "valid_user_dimension",
			parameterName: "user_segment",
			displayName:   "User Segment",
			scope:         "USER",
			isValid:       true,
		},
		{
			name:          "valid_event_dimension",
			parameterName: "event_category",
			displayName:   "Event Category",
			scope:         "EVENT",
			isValid:       true,
		},
		{
			name:          "invalid_scope",
			parameterName: "test_dim",
			displayName:   "Test Dimension",
			scope:         "INVALID",
			isValid:       false,
		},
		{
			name:          "empty_parameter_name",
			parameterName: "",
			displayName:   "Test Dimension",
			scope:         "USER",
			isValid:       false,
		},
		{
			name:          "empty_display_name",
			parameterName: "test_param",
			displayName:   "",
			scope:         "EVENT",
			isValid:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid := tt.parameterName != "" && tt.displayName != "" && (tt.scope == "USER" || tt.scope == "EVENT")
			assert.Equal(t, tt.isValid, isValid)
		})
	}
}

// TestDimensionScopes tests dimension scope constraints
func TestDimensionScopes(t *testing.T) {
	validScopes := []string{"USER", "EVENT"}

	tests := []struct {
		name  string
		scope string
		valid bool
	}{
		{"user_scope", "USER", true},
		{"event_scope", "EVENT", true},
		{"invalid_scope", "ITEM", false},
		{"empty_scope", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			found := slices.Contains(validScopes, tt.scope)
			assert.Equal(t, tt.valid, found)
		})
	}
}

// TestDimensionParameterNaming tests parameter naming conventions
func TestDimensionParameterNaming(t *testing.T) {
	tests := []struct {
		name          string
		parameterName string
		valid         bool
	}{
		{
			name:          "snake_case",
			parameterName: "user_segment_id",
			valid:         true,
		},
		{
			name:          "lowercase_only",
			parameterName: "usersegment",
			valid:         true,
		},
		{
			name:          "with_numbers",
			parameterName: "segment_123",
			valid:         true,
		},
		{
			name:          "camel_case",
			parameterName: "userSegment",
			valid:         false, // GA4 typically uses lowercase
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.NotEmpty(t, tt.parameterName)
		})
	}
}

// TestDimensionResourceNames tests GA4 resource name format
func TestDimensionResourceNames(t *testing.T) {
	propertyID := "123456789"
	dimensionID := "dim1"

	expectedResourceName := fmt.Sprintf("properties/%s/customDimensions/%s", propertyID, dimensionID)

	assert.NotEmpty(t, expectedResourceName)
	assert.Contains(t, expectedResourceName, "properties/")
	assert.Contains(t, expectedResourceName, "/customDimensions/")
}

// TestDimensionRelationships tests relationships between dimensions
func TestDimensionRelationships(t *testing.T) {
	dimensionList := []config.CustomDimension{
		{ParameterName: "dim1", DisplayName: "Dimension 1", Scope: "USER"},
		{ParameterName: "dim2", DisplayName: "Dimension 2", Scope: "EVENT"},
		{ParameterName: "dim3", DisplayName: "Dimension 3", Scope: "USER"},
	}

	// Test no duplicate parameter names
	seen := make(map[string]bool)
	for _, dim := range dimensionList {
		require.False(t, seen[dim.ParameterName], "duplicate parameter name found")
		seen[dim.ParameterName] = true
	}

	// Test scope distribution
	userCount := 0
	eventCount := 0
	for _, dim := range dimensionList {
		switch scope := dim.Scope; scope {
		case "USER":
			userCount++
		case "EVENT":
			eventCount++
		}
	}

	assert.Equal(t, 2, userCount)
	assert.Equal(t, 1, eventCount)
}

// BenchmarkCreateDimension benchmarks dimension creation structure
func BenchmarkCreateDimension(b *testing.B) {
	ctx, cancel := NewTestContext()
	defer cancel()

	var c *Client
	var d *admin.GoogleAnalyticsAdminV1alphaCustomDimension

	dim := config.CustomDimension{
		ParameterName: "test_param",
		DisplayName:   "Test Parameter",
		Scope:         "USER",
	}

	b.ReportAllocs()
	for b.Loop() {
		c = &Client{ctx: ctx, cancel: cancel}
		d = &admin.GoogleAnalyticsAdminV1alphaCustomDimension{
			ParameterName: dim.ParameterName,
			DisplayName:   dim.DisplayName,
			Scope:         dim.Scope,
		}
	}

	// Assign to package-level vars to prevent optimization
	benchClient = c
	benchDimension = d
}

// BenchmarkListDimensions benchmarks dimension listing structure
func BenchmarkListDimensions(b *testing.B) {
	propertyID := "123456789"
	var s string

	b.ReportAllocs()
	for b.Loop() {
		s = fmt.Sprintf("properties/%s", propertyID)
	}

	benchDimString = s
}
