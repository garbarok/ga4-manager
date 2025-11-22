package config

import "fmt"

// GA4Tier represents a GA4 account tier
type GA4Tier string

const (
	TierStandard GA4Tier = "standard" // Free tier
	Tier360      GA4Tier = "360"      // Paid tier
)

// TierLimits defines the limits for each GA4 tier
type TierLimits struct {
	CustomDimensions int
	CustomMetrics    int
	Conversions      int
}

// GetTierLimits returns the limits for a given tier
func GetTierLimits(tier string) TierLimits {
	switch GA4Tier(tier) {
	case Tier360:
		return TierLimits{
			CustomDimensions: 125,
			CustomMetrics:    125,
			Conversions:      50,
		}
	case TierStandard, "":
		// Default to standard (free) tier
		return TierLimits{
			CustomDimensions: 50,
			CustomMetrics:    50,
			Conversions:      30,
		}
	default:
		// Unknown tier, default to standard
		return TierLimits{
			CustomDimensions: 50,
			CustomMetrics:    50,
			Conversions:      30,
		}
	}
}

// ValidateTierLimits checks if a config exceeds tier limits
func ValidateTierLimits(cfg *ProjectConfig) []string {
	var warnings []string

	tier := cfg.GA4.Tier
	if tier == "" {
		tier = "standard"
	}

	limits := GetTierLimits(tier)

	// Check conversions
	if len(cfg.Conversions) > limits.Conversions {
		warnings = append(warnings, fmt.Sprintf(
			"Config has %d conversions but %s tier limit is %d. Excess conversions will fail to create.",
			len(cfg.Conversions), tier, limits.Conversions,
		))
	}

	// Check dimensions
	if len(cfg.Dimensions) > limits.CustomDimensions {
		warnings = append(warnings, fmt.Sprintf(
			"Config has %d custom dimensions but %s tier limit is %d. Excess dimensions will fail to create.",
			len(cfg.Dimensions), tier, limits.CustomDimensions,
		))
	}

	// Check metrics
	if len(cfg.Metrics) > limits.CustomMetrics {
		warnings = append(warnings, fmt.Sprintf(
			"Config has %d custom metrics but %s tier limit is %d. Excess metrics will fail to create.",
			len(cfg.Metrics), tier, limits.CustomMetrics,
		))
	}

	return warnings
}

// FilterByPriority filters items by priority for tier limits
// Returns items in order: high priority first, then medium, then low
func FilterDimensionsByPriority(dimensions []DimensionConfig, maxCount int) []DimensionConfig {
	if len(dimensions) <= maxCount {
		return dimensions
	}

	// Separate by priority
	var high, medium, low []DimensionConfig
	for _, dim := range dimensions {
		switch dim.Priority {
		case "high":
			high = append(high, dim)
		case "medium":
			medium = append(medium, dim)
		default:
			low = append(low, dim)
		}
	}

	// Combine in priority order
	result := append([]DimensionConfig{}, high...)
	result = append(result, medium...)
	result = append(result, low...)

	// Truncate to max
	if len(result) > maxCount {
		result = result[:maxCount]
	}

	return result
}

// FilterMetricsByPriority filters metrics by priority for tier limits
func FilterMetricsByPriority(metrics []MetricConfig, maxCount int) []MetricConfig {
	if len(metrics) <= maxCount {
		return metrics
	}

	// Separate by priority
	var high, medium, low []MetricConfig
	for _, metric := range metrics {
		switch metric.Priority {
		case "high":
			high = append(high, metric)
		case "medium":
			medium = append(medium, metric)
		default:
			low = append(low, metric)
		}
	}

	// Combine in priority order
	result := append([]MetricConfig{}, high...)
	result = append(result, medium...)
	result = append(result, low...)

	// Truncate to max
	if len(result) > maxCount {
		result = result[:maxCount]
	}

	return result
}

// FilterConversionsByPriority filters conversions by priority for tier limits
func FilterConversionsByPriority(conversions []ConversionConfig, maxCount int) []ConversionConfig {
	if len(conversions) <= maxCount {
		return conversions
	}

	// Separate by priority
	var high, medium, low []ConversionConfig
	for _, conv := range conversions {
		switch conv.Priority {
		case "high":
			high = append(high, conv)
		case "medium":
			medium = append(medium, conv)
		default:
			low = append(low, conv)
		}
	}

	// Combine in priority order
	result := append([]ConversionConfig{}, high...)
	result = append(result, medium...)
	result = append(result, low...)

	// Truncate to max
	if len(result) > maxCount {
		result = result[:maxCount]
	}

	return result
}

// GetTierName returns a human-readable tier name
func GetTierName(tier string) string {
	switch GA4Tier(tier) {
	case Tier360:
		return "GA4 360 (Paid)"
	case TierStandard, "":
		return "GA4 Standard (Free)"
	default:
		return "GA4 Standard (Free)"
	}
}

// ReservedParameters lists GA4 reserved parameter names that cannot be used
var ReservedParameters = map[string]bool{
	"session_id":            true,
	"user_id":               true,
	"firebase_screen":       true,
	"firebase_screen_class": true,
	"ga_session_id":         true,
	"ga_session_number":     true,
	"engagement_time_msec":  true,
}

// IsReservedParameter checks if a parameter name is reserved by GA4
func IsReservedParameter(param string) bool {
	return ReservedParameters[param]
}
