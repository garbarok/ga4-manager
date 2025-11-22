package config

// ProjectConfig represents a GA4 project configuration loaded from YAML
type ProjectConfig struct {
	// Basic project information
	Project ProjectInfo `yaml:"project"`

	// Google Analytics 4 configuration
	GA4 GA4Config `yaml:"ga4"`

	// Conversion events to track
	Conversions []ConversionConfig `yaml:"conversions,omitempty"`

	// Custom dimensions
	Dimensions []DimensionConfig `yaml:"dimensions,omitempty"`

	// Custom metrics
	Metrics []MetricConfig `yaml:"metrics,omitempty"`

	// Calculated metrics
	CalculatedMetrics []CalculatedMetricConfig `yaml:"calculated_metrics,omitempty"`

	// Audiences (manual setup - API cannot create these)
	Audiences []AudienceConfig `yaml:"audiences,omitempty"`

	// Cleanup configuration
	Cleanup CleanupYAMLConfig `yaml:"cleanup,omitempty"`

	// Data retention settings
	DataRetention *DataRetentionConfig `yaml:"data_retention,omitempty"`

	// Enhanced measurement settings
	EnhancedMeasurement *EnhancedMeasurementConfig `yaml:"enhanced_measurement,omitempty"`
}

// ProjectInfo contains basic project metadata
type ProjectInfo struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description,omitempty"`
	Version     string `yaml:"version,omitempty"`
}

// GA4Config contains GA4-specific identifiers
type GA4Config struct {
	PropertyID    string `yaml:"property_id"`
	MeasurementID string `yaml:"measurement_id,omitempty"`
	DataStreamID  string `yaml:"data_stream_id,omitempty"`
	Tier          string `yaml:"tier,omitempty"` // "standard" (free) or "360" (paid)
}

// ConversionConfig defines a conversion event
type ConversionConfig struct {
	Name           string `yaml:"name"`
	CountingMethod string `yaml:"counting_method"` // ONCE_PER_SESSION or ONCE_PER_EVENT
	Description    string `yaml:"description,omitempty"`
	Priority       string `yaml:"priority,omitempty"` // high, medium, low (for tier limits)
}

// DimensionConfig defines a custom dimension
type DimensionConfig struct {
	Parameter   string `yaml:"parameter"`
	DisplayName string `yaml:"display_name"`
	Description string `yaml:"description,omitempty"`
	Scope       string `yaml:"scope"`              // USER or EVENT
	Priority    string `yaml:"priority,omitempty"` // high, medium, low (for tier limits)
}

// MetricConfig defines a custom metric
type MetricConfig struct {
	Parameter   string `yaml:"parameter"`
	DisplayName string `yaml:"display_name"`
	Description string `yaml:"description,omitempty"`
	Unit        string `yaml:"unit"`               // STANDARD, CURRENCY, DISTANCE, etc.
	Scope       string `yaml:"scope"`              // EVENT
	Priority    string `yaml:"priority,omitempty"` // high, medium, low (for tier limits)
}

// CalculatedMetricConfig defines a calculated metric
type CalculatedMetricConfig struct {
	Name        string `yaml:"name"`
	Formula     string `yaml:"formula"`
	Description string `yaml:"description,omitempty"`
	MetricUnit  string `yaml:"metric_unit,omitempty"`
}

// AudienceConfig defines an audience (manual setup only)
type AudienceConfig struct {
	Name        string   `yaml:"name"`
	Description string   `yaml:"description"`
	Duration    int      `yaml:"duration"`
	Conditions  []string `yaml:"conditions,omitempty"`
}

// CleanupYAMLConfig defines items to remove from GA4 (YAML version)
// This is separate from CleanupConfig in projects.go to avoid redeclaration
type CleanupYAMLConfig struct {
	ConversionsToRemove []string `yaml:"conversions_to_remove,omitempty"`
	DimensionsToRemove  []string `yaml:"dimensions_to_remove,omitempty"`
	MetricsToRemove     []string `yaml:"metrics_to_remove,omitempty"`
	Reason              string   `yaml:"reason,omitempty"`
}

// DataRetentionConfig configures data retention
type DataRetentionConfig struct {
	EventDataRetention         string `yaml:"event_data_retention"` // TWO_MONTHS, FOURTEEN_MONTHS, etc.
	ResetUserDataOnNewActivity bool   `yaml:"reset_user_data_on_new_activity"`
}

// EnhancedMeasurementConfig configures automatic event tracking
type EnhancedMeasurementConfig struct {
	PageViews        bool `yaml:"page_views"`
	Scrolls          bool `yaml:"scrolls"`
	OutboundClicks   bool `yaml:"outbound_clicks"`
	SiteSearch       bool `yaml:"site_search"`
	VideoEngagement  bool `yaml:"video_engagement"`
	FileDownloads    bool `yaml:"file_downloads"`
	PageChanges      bool `yaml:"page_changes"` // For SPAs
	FormInteractions bool `yaml:"form_interactions"`
}

// ConvertToLegacyProject converts the new config format to the legacy Project struct
// This maintains backward compatibility with existing code
func (pc *ProjectConfig) ConvertToLegacyProject() Project {
	// Convert conversions
	conversions := make([]Conversion, len(pc.Conversions))
	for i, c := range pc.Conversions {
		conversions[i] = Conversion{
			Name:           c.Name,
			CountingMethod: c.CountingMethod,
		}
	}

	// Convert dimensions
	dimensions := make([]CustomDimension, len(pc.Dimensions))
	for i, d := range pc.Dimensions {
		dimensions[i] = CustomDimension{
			ParameterName: d.Parameter,
			DisplayName:   d.DisplayName,
			Description:   d.Description,
			Scope:         d.Scope,
		}
	}

	// Convert metrics
	metrics := make([]CustomMetric, len(pc.Metrics))
	for i, m := range pc.Metrics {
		metrics[i] = CustomMetric{
			EventParameter:  m.Parameter,
			DisplayName:     m.DisplayName,
			Description:     m.Description,
			MeasurementUnit: m.Unit,
			Scope:           m.Scope,
		}
	}

	// Convert audiences
	audiences := make([]Audience, len(pc.Audiences))
	for i, a := range pc.Audiences {
		audiences[i] = Audience(a)
	}

	return Project{
		Name:        pc.Project.Name,
		PropertyID:  pc.GA4.PropertyID,
		Conversions: conversions,
		Dimensions:  dimensions,
		Metrics:     metrics,
		Audiences:   audiences,
		Cleanup: CleanupConfig{
			ConversionsToRemove: pc.Cleanup.ConversionsToRemove,
			DimensionsToRemove:  pc.Cleanup.DimensionsToRemove,
			MetricsToRemove:     pc.Cleanup.MetricsToRemove,
			Reason:              pc.Cleanup.Reason,
		},
	}
}
