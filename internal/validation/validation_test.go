package validation

import (
	"testing"
)

func TestValidatePropertyID(t *testing.T) {
	tests := []struct {
		name       string
		propertyID string
		wantError  bool
	}{
		{"Valid property ID", "123456789", false},
		{"Valid with prefix", "properties/123456789", false},
		{"Empty", "", true},
		{"Invalid format - letters", "abc123", true},
		{"Invalid format - negative", "-123", true},
		{"Invalid format - zero", "0", true},
		{"Invalid format - special chars", "123-456", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePropertyID(tt.propertyID)
			if (err != nil) != tt.wantError {
				t.Errorf("ValidatePropertyID() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestValidateEventName(t *testing.T) {
	tests := []struct {
		name      string
		eventName string
		wantError bool
	}{
		{"Valid event name", "download_image", false},
		{"Valid with numbers", "conversion_v2", false},
		{"Empty", "", true},
		{"Too long", "this_is_a_very_long_event_name_that_exceeds_forty_characters", true},
		{"Starts with number", "2download", true},
		{"Special characters", "download-image", true},
		{"Reserved prefix google_", "google_conversion", true},
		{"Reserved prefix ga_", "ga_event", true},
		{"Reserved prefix firebase_", "firebase_event", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateEventName(tt.eventName)
			if (err != nil) != tt.wantError {
				t.Errorf("ValidateEventName() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestValidateParameterName(t *testing.T) {
	tests := []struct {
		name      string
		paramName string
		wantError bool
	}{
		{"Valid parameter name", "user_type", false},
		{"Valid with numbers", "dimension_v2", false},
		{"Empty", "", true},
		{"Too long", "this_is_a_very_long_parameter_name_that_exceeds_forty_chars", true},
		{"Starts with number", "2dimension", true},
		{"Special characters", "user-type", true},
		{"Reserved prefix google_", "google_dimension", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateParameterName(tt.paramName)
			if (err != nil) != tt.wantError {
				t.Errorf("ValidateParameterName() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestValidateDisplayName(t *testing.T) {
	tests := []struct {
		name        string
		displayName string
		wantError   bool
	}{
		{"Valid display name", "User Type", false},
		{"Valid long name", "This is a valid display name with spaces and special chars!", false},
		{"Empty", "", true},
		{"Too long", "This is an extremely long display name that definitely exceeds the maximum allowed eighty-two character limit for GA4 dimension display names", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateDisplayName(tt.displayName)
			if (err != nil) != tt.wantError {
				t.Errorf("ValidateDisplayName() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestValidateCountingMethod(t *testing.T) {
	tests := []struct {
		name      string
		method    string
		wantError bool
	}{
		{"Valid ONCE_PER_EVENT", "ONCE_PER_EVENT", false},
		{"Valid ONCE_PER_SESSION", "ONCE_PER_SESSION", false},
		{"Invalid method", "MULTIPLE", true},
		{"Empty", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateCountingMethod(tt.method)
			if (err != nil) != tt.wantError {
				t.Errorf("ValidateCountingMethod() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestValidateScope(t *testing.T) {
	tests := []struct {
		name      string
		scope     string
		wantError bool
	}{
		{"Valid EVENT", "EVENT", false},
		{"Valid USER", "USER", false},
		{"Valid ITEM", "ITEM", false},
		{"Invalid scope", "SESSION", true},
		{"Empty", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateScope(tt.scope)
			if (err != nil) != tt.wantError {
				t.Errorf("ValidateScope() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestValidateMeasurementUnit(t *testing.T) {
	tests := []struct {
		name      string
		unit      string
		wantError bool
	}{
		{"Valid STANDARD", "STANDARD", false},
		{"Valid CURRENCY", "CURRENCY", false},
		{"Valid SECONDS", "SECONDS", false},
		{"Empty (optional)", "", false},
		{"Invalid unit", "INVALID", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateMeasurementUnit(tt.unit)
			if (err != nil) != tt.wantError {
				t.Errorf("ValidateMeasurementUnit() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestValidateNotEmpty(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		fieldName string
		wantError bool
	}{
		{"Valid non-empty", "value", "field", false},
		{"Empty string", "", "field", true},
		{"Whitespace only", "   ", "field", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateNotEmpty(tt.value, tt.fieldName)
			if (err != nil) != tt.wantError {
				t.Errorf("ValidateNotEmpty() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestValidateStringLength(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		fieldName string
		min       int
		max       int
		wantError bool
	}{
		{"Valid length", "test", "field", 1, 10, false},
		{"Too short", "ab", "field", 3, 10, true},
		{"Too long", "this is too long", "field", 1, 10, true},
		{"Exact min", "abc", "field", 3, 10, false},
		{"Exact max", "1234567890", "field", 1, 10, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateStringLength(tt.value, tt.fieldName, tt.min, tt.max)
			if (err != nil) != tt.wantError {
				t.Errorf("ValidateStringLength() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}
