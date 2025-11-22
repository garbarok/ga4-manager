package config

// Project represents a GA4 property configuration
type Project struct {
	Name       string
	PropertyID string
	Conversions []Conversion
	Dimensions  []CustomDimension
	Audiences   []Audience
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

var (
	SnapCompress = Project{
		Name:       "SnapCompress",
		PropertyID: "513421535",
		Conversions: []Conversion{
			// Original conversions
			{Name: "download_image", CountingMethod: "ONCE_PER_SESSION"},
			{Name: "compression_complete", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "format_conversion", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "blog_engagement", CountingMethod: "ONCE_PER_EVENT"},

			// SEO Performance Events
			{Name: "search_impression", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "organic_visit", CountingMethod: "ONCE_PER_SESSION"},
			{Name: "featured_snippet_view", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "page_speed_issue", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "core_web_vitals_fail", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "image_optimization_success", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "social_share", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "return_visit_organic", CountingMethod: "ONCE_PER_SESSION"},

			// Technical SEO Events
			{Name: "404_error", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "redirect_followed", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "resource_load_error", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "javascript_error", CountingMethod: "ONCE_PER_EVENT"},

			// Enhanced Engagement Events
			{Name: "scroll_depth_25", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "scroll_depth_50", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "scroll_depth_75", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "scroll_depth_100", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "exit_intent", CountingMethod: "ONCE_PER_SESSION"},
			{Name: "rage_click", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "session_extended", CountingMethod: "ONCE_PER_SESSION"},
		},
		Dimensions: []CustomDimension{
			// Original dimensions
			{ParameterName: "user_type", DisplayName: "User Type", Description: "Classification of user behavior", Scope: "USER"},
			{ParameterName: "quality_setting", DisplayName: "Compression Quality", Description: "Quality setting used", Scope: "EVENT"},
			{ParameterName: "file_format", DisplayName: "File Format", Description: "Image file format", Scope: "EVENT"},
			{ParameterName: "compression_ratio", DisplayName: "Compression Ratio", Description: "Percentage of size reduction", Scope: "EVENT"},
			{ParameterName: "download_method", DisplayName: "Download Method", Description: "Download method (single/batch/zip)", Scope: "EVENT"},

			// Core Web Vitals
			{ParameterName: "lcp_score", DisplayName: "LCP Score", Description: "Largest Contentful Paint in milliseconds", Scope: "EVENT"},
			{ParameterName: "fid_score", DisplayName: "FID Score", Description: "First Input Delay in milliseconds", Scope: "EVENT"},
			{ParameterName: "cls_score", DisplayName: "CLS Score", Description: "Cumulative Layout Shift score", Scope: "EVENT"},
			{ParameterName: "inp_score", DisplayName: "INP Score", Description: "Interaction to Next Paint in milliseconds", Scope: "EVENT"},
			{ParameterName: "ttfb_score", DisplayName: "TTFB Score", Description: "Time to First Byte in milliseconds", Scope: "EVENT"},
			{ParameterName: "web_vitals_rating", DisplayName: "Web Vitals Rating", Description: "Overall rating: good/needs-improvement/poor", Scope: "EVENT"},

			// SEO Performance
			{ParameterName: "search_query", DisplayName: "Search Query", Description: "Search query from Search Console", Scope: "EVENT"},
			{ParameterName: "search_position", DisplayName: "Search Position", Description: "Position in search results", Scope: "EVENT"},
			{ParameterName: "organic_source", DisplayName: "Organic Source", Description: "Search engine: google/bing/duckduckgo", Scope: "EVENT"},
			{ParameterName: "landing_page_type", DisplayName: "Landing Page Type", Description: "Type of landing page", Scope: "EVENT"},
			{ParameterName: "entry_channel", DisplayName: "Entry Channel", Description: "Channel: organic/direct/referral/social", Scope: "EVENT"},
			{ParameterName: "utm_campaign", DisplayName: "UTM Campaign", Description: "Campaign parameter", Scope: "EVENT"},
			{ParameterName: "utm_source", DisplayName: "UTM Source", Description: "Source parameter", Scope: "EVENT"},
			{ParameterName: "utm_medium", DisplayName: "UTM Medium", Description: "Medium parameter", Scope: "EVENT"},
			{ParameterName: "utm_content", DisplayName: "UTM Content", Description: "Content parameter", Scope: "EVENT"},
			{ParameterName: "referrer_domain", DisplayName: "Referrer Domain", Description: "Referring domain", Scope: "EVENT"},

			// User Engagement
			{ParameterName: "session_quality_score", DisplayName: "Session Quality Score", Description: "Quality score from 1-100", Scope: "EVENT"},
			{ParameterName: "engagement_level", DisplayName: "Engagement Level", Description: "Level: low/medium/high", Scope: "EVENT"},
			{ParameterName: "scroll_depth_max", DisplayName: "Max Scroll Depth", Description: "Maximum scroll percentage", Scope: "EVENT"},
			{ParameterName: "pages_per_session", DisplayName: "Pages Per Session", Description: "Number of pages viewed", Scope: "EVENT"},
			{ParameterName: "avg_time_on_page", DisplayName: "Avg Time on Page", Description: "Average time in seconds", Scope: "EVENT"},
			{ParameterName: "bounce_indicator", DisplayName: "Bounce Indicator", Description: "Boolean: true/false", Scope: "EVENT"},
			{ParameterName: "exit_page_type", DisplayName: "Exit Page Type", Description: "Type of exit page", Scope: "EVENT"},
			{ParameterName: "device_category_detail", DisplayName: "Device Category Detail", Description: "Detailed device category", Scope: "EVENT"},
			{ParameterName: "browser_language", DisplayName: "Browser Language", Description: "Browser language setting", Scope: "EVENT"},
			{ParameterName: "viewport_size", DisplayName: "Viewport Size", Description: "Browser viewport dimensions", Scope: "EVENT"},

			// Technical SEO
			{ParameterName: "page_load_time", DisplayName: "Page Load Time", Description: "Total page load time in ms", Scope: "EVENT"},
			{ParameterName: "dom_load_time", DisplayName: "DOM Load Time", Description: "DOM load time in ms", Scope: "EVENT"},
			{ParameterName: "server_response_time", DisplayName: "Server Response Time", Description: "Server response time in ms", Scope: "EVENT"},
			{ParameterName: "resource_error_type", DisplayName: "Resource Error Type", Description: "Type of resource error", Scope: "EVENT"},
			{ParameterName: "javascript_enabled", DisplayName: "JavaScript Enabled", Description: "Boolean: JS enabled status", Scope: "EVENT"},
			{ParameterName: "cookie_consent_status", DisplayName: "Cookie Consent Status", Description: "Cookie consent status", Scope: "EVENT"},
		},
		Audiences: []Audience{
			{Name: "High-Intent Users", Description: "Completed 2+ compressions in 7 days", Duration: 7},
			{Name: "Feature Explorers", Description: "Used 2+ features in 30 days", Duration: 30},
			{Name: "Blog Readers", Description: "Viewed 2+ blog pages, 5+ min engagement", Duration: 30},
		},
	}

	PersonalWebsite = Project{
		Name:       "Personal Website",
		PropertyID: "513885304",
		Conversions: []Conversion{
			// Original conversions
			{Name: "newsletter_subscribe", CountingMethod: "ONCE_PER_SESSION"},
			{Name: "contact_form_submit", CountingMethod: "ONCE_PER_SESSION"},
			{Name: "demo_click", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "github_click", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "article_read", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "code_copy", CountingMethod: "ONCE_PER_EVENT"},

			// SEO Performance Events
			{Name: "search_impression", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "organic_article_visit", CountingMethod: "ONCE_PER_SESSION"},
			{Name: "featured_snippet_view", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "backlink_click", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "internal_search", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "related_article_click", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "toc_interaction", CountingMethod: "ONCE_PER_EVENT"},

			// Technical SEO Events
			{Name: "core_web_vitals_pass", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "core_web_vitals_fail", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "page_speed_good", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "404_error", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "resource_load_error", CountingMethod: "ONCE_PER_EVENT"},

			// Enhanced Content Events
			{Name: "article_share_linkedin", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "article_share_twitter", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "article_bookmark", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "read_time_exceeded", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "comment_submitted", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "related_content_engagement", CountingMethod: "ONCE_PER_EVENT"},
		},
		Dimensions: []CustomDimension{
			// Original dimensions
			{ParameterName: "article_category", DisplayName: "Article Category", Description: "Category of blog article", Scope: "EVENT"},
			{ParameterName: "content_language", DisplayName: "Content Language", Description: "Language (es/en)", Scope: "EVENT"},
			{ParameterName: "reader_type", DisplayName: "Reader Type", Description: "Reader engagement classification", Scope: "USER"},
			{ParameterName: "word_count", DisplayName: "Article Word Count", Description: "Number of words", Scope: "EVENT"},
			{ParameterName: "completion_rate", DisplayName: "Reading Completion", Description: "Percentage read", Scope: "EVENT"},

			// Core Web Vitals
			{ParameterName: "lcp_score", DisplayName: "LCP Score", Description: "Largest Contentful Paint in milliseconds", Scope: "EVENT"},
			{ParameterName: "fid_score", DisplayName: "FID Score", Description: "First Input Delay in milliseconds", Scope: "EVENT"},
			{ParameterName: "cls_score", DisplayName: "CLS Score", Description: "Cumulative Layout Shift score", Scope: "EVENT"},
			{ParameterName: "inp_score", DisplayName: "INP Score", Description: "Interaction to Next Paint in milliseconds", Scope: "EVENT"},
			{ParameterName: "ttfb_score", DisplayName: "TTFB Score", Description: "Time to First Byte in milliseconds", Scope: "EVENT"},
			{ParameterName: "web_vitals_rating", DisplayName: "Web Vitals Rating", Description: "Overall rating: good/needs-improvement/poor", Scope: "EVENT"},

			// SEO Performance
			{ParameterName: "search_query", DisplayName: "Search Query", Description: "Search query from Search Console", Scope: "EVENT"},
			{ParameterName: "search_position", DisplayName: "Search Position", Description: "Position in search results", Scope: "EVENT"},
			{ParameterName: "organic_source", DisplayName: "Organic Source", Description: "Search engine: google/bing/duckduckgo", Scope: "EVENT"},
			{ParameterName: "landing_page_type", DisplayName: "Landing Page Type", Description: "Type of landing page", Scope: "EVENT"},
			{ParameterName: "entry_channel", DisplayName: "Entry Channel", Description: "Channel: organic/direct/referral/social", Scope: "EVENT"},
			{ParameterName: "utm_campaign", DisplayName: "UTM Campaign", Description: "Campaign parameter", Scope: "EVENT"},
			{ParameterName: "utm_source", DisplayName: "UTM Source", Description: "Source parameter", Scope: "EVENT"},
			{ParameterName: "utm_medium", DisplayName: "UTM Medium", Description: "Medium parameter", Scope: "EVENT"},
			{ParameterName: "utm_content", DisplayName: "UTM Content", Description: "Content parameter", Scope: "EVENT"},
			{ParameterName: "referrer_domain", DisplayName: "Referrer Domain", Description: "Referring domain", Scope: "EVENT"},

			// User Engagement
			{ParameterName: "session_quality_score", DisplayName: "Session Quality Score", Description: "Quality score from 1-100", Scope: "EVENT"},
			{ParameterName: "engagement_level", DisplayName: "Engagement Level", Description: "Level: low/medium/high", Scope: "EVENT"},
			{ParameterName: "scroll_depth_max", DisplayName: "Max Scroll Depth", Description: "Maximum scroll percentage", Scope: "EVENT"},
			{ParameterName: "pages_per_session", DisplayName: "Pages Per Session", Description: "Number of pages viewed", Scope: "EVENT"},
			{ParameterName: "avg_time_on_page", DisplayName: "Avg Time on Page", Description: "Average time in seconds", Scope: "EVENT"},
			{ParameterName: "bounce_indicator", DisplayName: "Bounce Indicator", Description: "Boolean: true/false", Scope: "EVENT"},
			{ParameterName: "exit_page_type", DisplayName: "Exit Page Type", Description: "Type of exit page", Scope: "EVENT"},
			{ParameterName: "device_category_detail", DisplayName: "Device Category Detail", Description: "Detailed device category", Scope: "EVENT"},
			{ParameterName: "browser_language", DisplayName: "Browser Language", Description: "Browser language setting", Scope: "EVENT"},
			{ParameterName: "viewport_size", DisplayName: "Viewport Size", Description: "Browser viewport dimensions", Scope: "EVENT"},

			// Technical SEO
			{ParameterName: "page_load_time", DisplayName: "Page Load Time", Description: "Total page load time in ms", Scope: "EVENT"},
			{ParameterName: "dom_load_time", DisplayName: "DOM Load Time", Description: "DOM load time in ms", Scope: "EVENT"},
			{ParameterName: "server_response_time", DisplayName: "Server Response Time", Description: "Server response time in ms", Scope: "EVENT"},
			{ParameterName: "resource_error_type", DisplayName: "Resource Error Type", Description: "Type of resource error", Scope: "EVENT"},
			{ParameterName: "javascript_enabled", DisplayName: "JavaScript Enabled", Description: "Boolean: JS enabled status", Scope: "EVENT"},
			{ParameterName: "cookie_consent_status", DisplayName: "Cookie Consent Status", Description: "Cookie consent status", Scope: "EVENT"},
		},
		Audiences: []Audience{
			{Name: "Content Consumers", Description: "Read 3+ articles in 30 days", Duration: 30},
			{Name: "Technical Readers", Description: "Copied 2+ code snippets", Duration: 30},
			{Name: "Potential Subscribers", Description: "Read 2+ articles, viewed form, didn't subscribe", Duration: 14},
		},
	}

	AllProjects = []Project{SnapCompress, PersonalWebsite}
)
