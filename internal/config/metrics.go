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

// SnapCompressMetrics defines custom metrics for SnapCompress project
var SnapCompressMetrics = []CustomMetric{
	// Engagement Metrics
	{
		DisplayName:     "Engagement Rate",
		Description:     "Percentage of engaged sessions",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "engagement_rate",
	},
	{
		DisplayName:     "Average Session Duration",
		Description:     "Average time spent in session",
		MeasurementUnit: "SECONDS",
		Scope:           "EVENT",
		EventParameter:  "session_duration",
	},
	{
		DisplayName:     "Pages Per Session",
		Description:     "Number of pages viewed per session",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "pages_count",
	},
	{
		DisplayName:     "Average Scroll Depth",
		Description:     "Average scroll depth percentage",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "scroll_depth_avg",
	},

	// SEO Performance Metrics
	{
		DisplayName:     "Organic Conversion Rate",
		Description:     "Conversion rate from organic traffic",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "organic_conversion_rate",
	},
	{
		DisplayName:     "Organic Session Value",
		Description:     "Average value per organic session",
		MeasurementUnit: "CURRENCY",
		Scope:           "EVENT",
		EventParameter:  "organic_session_value",
	},
	{
		DisplayName:     "Search Position Improvement",
		Description:     "Average improvement in search position",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "position_improvement",
	},
	{
		DisplayName:     "Core Web Vitals Pass Rate",
		Description:     "Percentage of sessions passing Core Web Vitals",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "cwv_pass_rate",
	},

	// Conversion Metrics (SnapCompress specific)
	{
		DisplayName:     "Compression Success Rate",
		Description:     "Percentage of successful compressions",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "compression_success_rate",
	},
	{
		DisplayName:     "Download Conversion Rate",
		Description:     "Percentage of compressions that led to downloads",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "download_conversion_rate",
	},
	{
		DisplayName:     "Feature Adoption Rate",
		Description:     "Rate of feature adoption by users",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "feature_adoption_rate",
	},
	{
		DisplayName:     "User Retention Rate",
		Description:     "Percentage of users returning within 30 days",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "retention_rate",
	},
}

// PersonalWebsiteMetrics defines custom metrics for Personal Website project
var PersonalWebsiteMetrics = []CustomMetric{
	// Engagement Metrics
	{
		DisplayName:     "Engagement Rate",
		Description:     "Percentage of engaged sessions",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "engagement_rate",
	},
	{
		DisplayName:     "Average Session Duration",
		Description:     "Average time spent in session",
		MeasurementUnit: "SECONDS",
		Scope:           "EVENT",
		EventParameter:  "session_duration",
	},
	{
		DisplayName:     "Pages Per Session",
		Description:     "Number of pages viewed per session",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "pages_count",
	},
	{
		DisplayName:     "Average Scroll Depth",
		Description:     "Average scroll depth percentage",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "scroll_depth_avg",
	},

	// SEO Performance Metrics
	{
		DisplayName:     "Organic Conversion Rate",
		Description:     "Conversion rate from organic traffic",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "organic_conversion_rate",
	},
	{
		DisplayName:     "Average Search Position",
		Description:     "Average position in search results",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "avg_search_position",
	},
	{
		DisplayName:     "Core Web Vitals Pass Rate",
		Description:     "Percentage of sessions passing Core Web Vitals",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "cwv_pass_rate",
	},

	// Content Performance Metrics (Personal Website specific)
	{
		DisplayName:     "Article Completion Rate",
		Description:     "Percentage of articles read to completion",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "article_completion_rate",
	},
	{
		DisplayName:     "Average Reading Time",
		Description:     "Average time spent reading articles",
		MeasurementUnit: "MINUTES",
		Scope:           "EVENT",
		EventParameter:  "avg_reading_time",
	},
	{
		DisplayName:     "Share Rate",
		Description:     "Percentage of articles shared",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "share_rate",
	},
	{
		DisplayName:     "Return Reader Rate",
		Description:     "Percentage of readers who return",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "return_reader_rate",
	},
	{
		DisplayName:     "Code Copy Rate",
		Description:     "Percentage of technical articles with code copied",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
		EventParameter:  "code_copy_rate",
	},
}
