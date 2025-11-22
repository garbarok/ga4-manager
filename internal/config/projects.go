package config

// Project represents a GA4 property configuration
type Project struct {
	Name        string
	PropertyID  string
	Conversions []Conversion
	Dimensions  []CustomDimension
	Metrics     []CustomMetric
	Audiences   []Audience
	Cleanup     CleanupConfig
}

// CleanupConfig defines items to remove from GA4
type CleanupConfig struct {
	ConversionsToRemove []string // Event names to remove
	DimensionsToRemove  []string // Parameter names to remove
	MetricsToRemove     []string // Metric parameter names to remove
	Reason              string   // Why these items should be removed
}

type Conversion struct {
	Name           string
	CountingMethod string // "ONCE_PER_SESSION" or "ONCE_PER_EVENT"
}

type CustomDimension struct {
	ParameterName string
	DisplayName   string
	Description   string
	Scope         string // "USER" or "EVENT"
}

type Audience struct {
	Name        string
	Description string
	Duration    int
	Conditions  []string
}
