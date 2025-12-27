package config

// ProjectConfig represents a project configuration loaded from YAML
// Supports GA4-only, GSC-only, or combined configurations
type ProjectConfig struct {
	// Basic project information
	Project ProjectInfo `yaml:"project"`

	// Google Analytics 4 configuration (optional - for GA4-only or combined configs)
	Analytics *AnalyticsConfig `yaml:"analytics,omitempty"`

	// Google Search Console configuration (optional - for GSC-only or combined configs)
	SearchConsole *SearchConsoleConfig `yaml:"search_console,omitempty"`

	// Legacy GA4 configuration (deprecated, use Analytics instead)
	// Kept for backward compatibility with existing configs
	GA4 GA4Config `yaml:"ga4,omitempty"`

	// Conversion events to track (GA4)
	Conversions []ConversionConfig `yaml:"conversions,omitempty"`

	// Custom dimensions (GA4)
	Dimensions []DimensionConfig `yaml:"dimensions,omitempty"`

	// Custom metrics (GA4)
	Metrics []MetricConfig `yaml:"metrics,omitempty"`

	// Calculated metrics (GA4)
	CalculatedMetrics []CalculatedMetricConfig `yaml:"calculated_metrics,omitempty"`

	// Audiences (GA4 - manual setup - API cannot create these)
	Audiences []AudienceConfig `yaml:"audiences,omitempty"`

	// Cleanup configuration (GA4)
	Cleanup CleanupYAMLConfig `yaml:"cleanup,omitempty"`

	// Data retention settings (GA4)
	DataRetention *DataRetentionConfig `yaml:"data_retention,omitempty"`

	// Enhanced measurement settings (GA4)
	EnhancedMeasurement *EnhancedMeasurementConfig `yaml:"enhanced_measurement,omitempty"`
}

// HasAnalytics returns true if this config includes GA4 analytics setup
func (pc *ProjectConfig) HasAnalytics() bool {
	return pc.Analytics != nil || pc.GA4.PropertyID != ""
}

// HasSearchConsole returns true if this config includes GSC setup
func (pc *ProjectConfig) HasSearchConsole() bool {
	return pc.SearchConsole != nil
}

// GetPropertyID returns the GA4 property ID from either Analytics or legacy GA4 config
func (pc *ProjectConfig) GetPropertyID() string {
	if pc.Analytics != nil {
		return pc.Analytics.PropertyID
	}
	return pc.GA4.PropertyID
}

// ProjectInfo contains basic project metadata
type ProjectInfo struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description,omitempty"`
	Version     string `yaml:"version,omitempty"`
	URL         string `yaml:"url,omitempty"` // Project URL for reference
}

// AnalyticsConfig contains Google Analytics 4 configuration
type AnalyticsConfig struct {
	PropertyID    string `yaml:"property_id"`
	MeasurementID string `yaml:"measurement_id,omitempty"`
	DataStreamID  string `yaml:"data_stream_id,omitempty"`
	Tier          string `yaml:"tier,omitempty"` // "standard" (free) or "360" (paid)
}

// GA4Config contains GA4-specific identifiers (legacy, use AnalyticsConfig)
type GA4Config struct {
	PropertyID    string `yaml:"property_id"`
	MeasurementID string `yaml:"measurement_id,omitempty"`
	DataStreamID  string `yaml:"data_stream_id,omitempty"`
	Tier          string `yaml:"tier,omitempty"` // "standard" (free) or "360" (paid)
}

// SearchConsoleConfig contains Google Search Console configuration
type SearchConsoleConfig struct {
	// Site URL (must match verified property in GSC)
	SiteURL string `yaml:"site_url"`

	// Sitemaps to manage
	Sitemaps []SitemapConfig `yaml:"sitemaps,omitempty"`

	// URL inspection configuration
	URLInspection *URLInspectionConfig `yaml:"url_inspection,omitempty"`

	// Search analytics configuration
	SearchAnalytics *SearchAnalyticsConfig `yaml:"search_analytics,omitempty"`
}

// SitemapConfig defines a sitemap to submit to GSC
type SitemapConfig struct {
	URL         string `yaml:"url"`
	AutoSubmit  bool   `yaml:"auto_submit,omitempty"`
	Description string `yaml:"description,omitempty"`
}

// URLInspectionConfig defines URLs to monitor for indexing issues
type URLInspectionConfig struct {
	// Priority URLs to check regularly
	PriorityURLs []string `yaml:"priority_urls,omitempty"`

	// URL patterns to monitor (e.g., "/blog/*")
	Patterns []URLPatternConfig `yaml:"patterns,omitempty"`

	// Issues to alert on
	Alerts []string `yaml:"alerts,omitempty"`
}

// URLPatternConfig defines a URL pattern to monitor
type URLPatternConfig struct {
	Pattern     string `yaml:"pattern"`
	Description string `yaml:"description,omitempty"`
}

// SearchAnalyticsConfig defines search analytics reporting settings
type SearchAnalyticsConfig struct {
	// Date range for reports
	DateRange *DateRangeConfig `yaml:"date_range,omitempty"`

	// Dimensions to include in reports
	Dimensions []string `yaml:"dimensions,omitempty"`

	// Metrics to track
	Metrics []string `yaml:"metrics,omitempty"`

	// Filters for focused reporting
	Filters []SearchFilterConfig `yaml:"filters,omitempty"`

	// Alert thresholds
	Alerts []SearchAlertConfig `yaml:"alerts,omitempty"`
}

// DateRangeConfig defines a date range for reports
type DateRangeConfig struct {
	Days int `yaml:"days"` // Last N days
}

// SearchFilterConfig defines a filter for search analytics
type SearchFilterConfig struct {
	Dimension   string   `yaml:"dimension"`
	Operator    string   `yaml:"operator"`
	Expression  string   `yaml:"expression,omitempty"`
	Expressions []string `yaml:"expressions,omitempty"` // For "in" operator
}

// SearchAlertConfig defines an alert threshold for search metrics
type SearchAlertConfig struct {
	Metric    string  `yaml:"metric"`
	Condition string  `yaml:"condition"`
	Value     float64 `yaml:"value"`
	Message   string  `yaml:"message"`
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
		PropertyID:  pc.GetPropertyID(), // Use helper to get from Analytics or GA4
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
