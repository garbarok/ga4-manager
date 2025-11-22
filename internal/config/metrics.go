package config

// CustomMetric represents a custom metric definition for GA4
type CustomMetric struct {
	DisplayName      string
	Description      string
	MeasurementUnit  string // STANDARD, CURRENCY, FEET, METERS, KILOMETERS, MILES, MILLISECONDS, SECONDS, MINUTES, HOURS
	Scope            string // EVENT
	EventParameter   string
	RestrictedMetric bool
}
