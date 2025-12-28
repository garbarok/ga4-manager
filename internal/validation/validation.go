package validation

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// normalizeInput trims and uppercases for consistent validation.
func normalizeInput(input string) string {
	return strings.ToUpper(strings.TrimSpace(input))
}

// PropertyIDRegex matches valid GA4 property ID format (numeric only)
var PropertyIDRegex = regexp.MustCompile(`^[0-9]+$`)

// EventNameRegex matches valid GA4 event name format
// Must start with letter, contain only alphanumeric and underscore, max 40 chars
var EventNameRegex = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]{0,39}$`)

// ParameterNameRegex matches valid GA4 parameter name format
var ParameterNameRegex = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]{0,39}$`)

// ValidatePropertyID validates a GA4 property ID
func ValidatePropertyID(propertyID string) error {
	if propertyID == "" {
		return fmt.Errorf("property ID cannot be empty")
	}

	// Remove "properties/" prefix if present
	propertyID = strings.TrimPrefix(propertyID, "properties/")

	if !PropertyIDRegex.MatchString(propertyID) {
		return fmt.Errorf("invalid property ID format: %s (must be numeric)", propertyID)
	}

	// Ensure it's a valid integer
	id, err := strconv.ParseInt(propertyID, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid property ID: %s (must be a valid integer)", propertyID)
	}

	if id <= 0 {
		return fmt.Errorf("invalid property ID: %s (must be positive)", propertyID)
	}

	return nil
}

// ValidateEventName validates a GA4 event name
func ValidateEventName(eventName string) error {
	if eventName == "" {
		return fmt.Errorf("event name cannot be empty")
	}

	if len(eventName) > 40 {
		return fmt.Errorf("event name too long: %s (max 40 characters)", eventName)
	}

	if !EventNameRegex.MatchString(eventName) {
		return fmt.Errorf("invalid event name format: %s (must start with letter, contain only alphanumeric and underscore)", eventName)
	}

	// Check for reserved GA4 event prefixes
	reservedPrefixes := []string{"google_", "ga_", "firebase_"}
	for _, prefix := range reservedPrefixes {
		if strings.HasPrefix(strings.ToLower(eventName), prefix) {
			return fmt.Errorf("event name cannot start with reserved prefix '%s': %s", prefix, eventName)
		}
	}

	return nil
}

// ValidateParameterName validates a GA4 parameter name (for dimensions/metrics)
func ValidateParameterName(paramName string) error {
	if paramName == "" {
		return fmt.Errorf("parameter name cannot be empty")
	}

	if len(paramName) > 40 {
		return fmt.Errorf("parameter name too long: %s (max 40 characters)", paramName)
	}

	if !ParameterNameRegex.MatchString(paramName) {
		return fmt.Errorf("invalid parameter name format: %s (must start with letter, contain only alphanumeric and underscore)", paramName)
	}

	// Check for reserved GA4 parameter prefixes
	reservedPrefixes := []string{"google_", "ga_", "firebase_"}
	for _, prefix := range reservedPrefixes {
		if strings.HasPrefix(strings.ToLower(paramName), prefix) {
			return fmt.Errorf("parameter name cannot start with reserved prefix '%s': %s", prefix, paramName)
		}
	}

	return nil
}

// ValidateDisplayName validates a display name for dimensions/metrics
func ValidateDisplayName(displayName string) error {
	if displayName == "" {
		return fmt.Errorf("display name cannot be empty")
	}

	if len(displayName) > 82 {
		return fmt.Errorf("display name too long: %s (max 82 characters)", displayName)
	}

	return nil
}

// ValidateCountingMethod validates a GA4 conversion counting method
func ValidateCountingMethod(method string) error {
	method = normalizeInput(method)

	validMethods := map[string]bool{
		"ONCE_PER_EVENT":   true,
		"ONCE_PER_SESSION": true,
	}

	if !validMethods[method] {
		return fmt.Errorf("invalid counting method: %s (must be ONCE_PER_EVENT or ONCE_PER_SESSION)", method)
	}

	return nil
}

// ValidateScope validates a GA4 dimension scope
func ValidateScope(scope string) error {
	scope = normalizeInput(scope)

	validScopes := map[string]bool{
		"EVENT": true,
		"USER":  true,
		"ITEM":  true,
	}

	if !validScopes[scope] {
		return fmt.Errorf("invalid scope: %s (must be EVENT, USER, or ITEM)", scope)
	}

	return nil
}

// ValidateMeasurementUnit validates a GA4 metric measurement unit
func ValidateMeasurementUnit(unit string) error {
	if unit == "" {
		return nil
	}

	unit = normalizeInput(unit)

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

	if !validUnits[unit] {
		return fmt.Errorf("invalid measurement unit: %s", unit)
	}

	return nil
}

// ValidateMetricType validates a GA4 metric type
func ValidateMetricType(metricType string) error {
	metricType = normalizeInput(metricType)

	validTypes := map[string]bool{
		"METRIC_TYPE_UNSPECIFIED": true,
		"TYPE_INTEGER":            true,
		"TYPE_FLOAT":              true,
		"TYPE_CURRENCY":           true,
		"TYPE_FEET":               true,
		"TYPE_METERS":             true,
		"TYPE_KILOMETERS":         true,
		"TYPE_MILES":              true,
		"TYPE_MILLISECONDS":       true,
		"TYPE_SECONDS":            true,
		"TYPE_MINUTES":            true,
		"TYPE_HOURS":              true,
	}

	if !validTypes[metricType] {
		return fmt.Errorf("invalid metric type: %s", metricType)
	}

	return nil
}

// ValidateNotEmpty validates that a string is not empty or whitespace
func ValidateNotEmpty(value, fieldName string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s cannot be empty", fieldName)
	}
	return nil
}

// ValidateStringLength validates string length within min/max bounds
func ValidateStringLength(value, fieldName string, min, max int) error {
	length := len(value)
	if length < min {
		return fmt.Errorf("%s too short: %d characters (minimum %d)", fieldName, length, min)
	}
	if length > max {
		return fmt.Errorf("%s too long: %d characters (maximum %d)", fieldName, length, max)
	}
	return nil
}
