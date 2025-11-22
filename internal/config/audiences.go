package config

// AudienceFilter represents a single filter condition
type AudienceFilter struct {
	FieldName string      // e.g., "event_name", "user_property.name", "dimension.name"
	Operator  string      // EQUALS, CONTAINS, GREATER_THAN, LESS_THAN, etc.
	Value     interface{} // The value to compare against
}

// FilterClause represents a group of filters with AND/OR logic
type FilterClause struct {
	Filters    []AudienceFilter
	ClauseType string // "AND" or "OR"
}

// EventTrigger represents an event that triggers audience membership
type EventTrigger struct {
	EventName       string
	MinimumCount    int
	WindowDuration  int // days
}

// EnhancedAudience represents a detailed audience configuration
type EnhancedAudience struct {
	Name               string
	Description        string
	MembershipDuration int // days
	FilterClauses      []FilterClause
	EventTriggers      []EventTrigger
	ExclusionDuration  int    // days to exclude after leaving
	Category           string // SEO, Conversion, Behavioral, etc.
}

// SnapCompressAudiences defines all audiences for SnapCompress
var SnapCompressAudiences = []EnhancedAudience{
	// Original audiences (simplified versions)
	{
		Name:               "High-Intent Users",
		Description:        "Users who completed 2+ compressions in 7 days",
		MembershipDuration: 7,
		Category:           "Conversion",
		EventTriggers: []EventTrigger{
			{EventName: "compression_complete", MinimumCount: 2, WindowDuration: 7},
		},
	},
	{
		Name:               "Feature Explorers",
		Description:        "Users who used 2+ different features in 30 days",
		MembershipDuration: 30,
		Category:           "Behavioral",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "event_count", Operator: "GREATER_THAN", Value: 5},
				},
			},
		},
	},
	{
		Name:               "Blog Readers",
		Description:        "Viewed 2+ blog pages with 5+ min engagement",
		MembershipDuration: 30,
		Category:           "Content",
		EventTriggers: []EventTrigger{
			{EventName: "blog_engagement", MinimumCount: 2, WindowDuration: 30},
		},
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "engagement_time_msec", Operator: "GREATER_THAN", Value: 300000},
				},
			},
		},
	},

	// SEO-Focused Audiences
	{
		Name:               "Organic Converters",
		Description:        "Users who converted via organic search in last 30 days",
		MembershipDuration: 30,
		Category:           "SEO",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "first_user_source", Operator: "CONTAINS", Value: "google"},
					{FieldName: "first_user_medium", Operator: "EQUALS", Value: "organic"},
				},
			},
		},
		EventTriggers: []EventTrigger{
			{EventName: "compression_complete", MinimumCount: 1, WindowDuration: 30},
		},
	},
	{
		Name:               "Organic Returners",
		Description:        "Users with 3+ organic sessions in 7 days",
		MembershipDuration: 7,
		Category:           "SEO",
		EventTriggers: []EventTrigger{
			{EventName: "organic_visit", MinimumCount: 3, WindowDuration: 7},
		},
	},
	{
		Name:               "Featured Snippet Viewers",
		Description:        "Users who viewed featured snippet results",
		MembershipDuration: 14,
		Category:           "SEO",
		EventTriggers: []EventTrigger{
			{EventName: "featured_snippet_view", MinimumCount: 1, WindowDuration: 14},
		},
	},
	{
		Name:               "Long-Tail Searchers",
		Description:        "Users arriving via long-tail queries (4+ words)",
		MembershipDuration: 30,
		Category:           "SEO",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "dimension.search_query", Operator: "LENGTH_GREATER_THAN", Value: 20},
				},
			},
		},
	},
	{
		Name:               "Core Web Vitals Champions",
		Description:        "Users with excellent Core Web Vitals scores",
		MembershipDuration: 14,
		Category:           "SEO",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "dimension.web_vitals_rating", Operator: "EQUALS", Value: "good"},
				},
			},
		},
	},

	// Conversion Optimization Audiences
	{
		Name:               "Compression Abandoners",
		Description:        "Started compression but didn't download in last session",
		MembershipDuration: 7,
		Category:           "Conversion",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "event_name", Operator: "EQUALS", Value: "compression_complete"},
				},
			},
			{
				ClauseType: "NOT",
				Filters: []AudienceFilter{
					{FieldName: "event_name", Operator: "EQUALS", Value: "download_image"},
				},
			},
		},
	},
	{
		Name:               "Format Explorers",
		Description:        "Users who used 3+ different image formats",
		MembershipDuration: 30,
		Category:           "Conversion",
		EventTriggers: []EventTrigger{
			{EventName: "format_conversion", MinimumCount: 3, WindowDuration: 30},
		},
	},
	{
		Name:               "Batch Users",
		Description:        "Users who used batch compression feature",
		MembershipDuration: 30,
		Category:           "Conversion",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "dimension.download_method", Operator: "IN", Value: []string{"batch", "zip"}},
				},
			},
		},
	},
	{
		Name:               "Quality Optimizers",
		Description:        "Users who changed quality settings 2+ times",
		MembershipDuration: 14,
		Category:           "Conversion",
		EventTriggers: []EventTrigger{
			{EventName: "compression_complete", MinimumCount: 2, WindowDuration: 14},
		},
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "dimension.quality_setting", Operator: "NOT_NULL", Value: nil},
				},
			},
		},
	},

	// Behavioral Audiences
	{
		Name:               "High-Intent Browsers",
		Description:        "Users who viewed 5+ pages in a session",
		MembershipDuration: 7,
		Category:           "Behavioral",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "dimension.pages_per_session", Operator: "GREATER_THAN", Value: 5},
				},
			},
		},
	},
	{
		Name:               "Quick Bouncers",
		Description:        "Users who spent less than 10 seconds on site",
		MembershipDuration: 7,
		Category:           "Behavioral",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "engagement_time_msec", Operator: "LESS_THAN", Value: 10000},
					{FieldName: "dimension.bounce_indicator", Operator: "EQUALS", Value: "true"},
				},
			},
		},
		ExclusionDuration: 30,
	},
	{
		Name:               "Weekend Warriors",
		Description:        "Users who primarily visit on weekends",
		MembershipDuration: 30,
		Category:           "Behavioral",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "day_of_week", Operator: "IN", Value: []string{"Saturday", "Sunday"}},
				},
			},
		},
	},
	{
		Name:               "Mobile-First Users",
		Description:        "Users with 90%+ mobile sessions",
		MembershipDuration: 30,
		Category:           "Behavioral",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "device_category", Operator: "EQUALS", Value: "mobile"},
				},
			},
		},
	},
	{
		Name:               "Power Users",
		Description:        "Users with extended sessions (5+ minutes) who completed 3+ compressions",
		MembershipDuration: 30,
		Category:           "Behavioral",
		EventTriggers: []EventTrigger{
			{EventName: "session_extended", MinimumCount: 1, WindowDuration: 30},
			{EventName: "compression_complete", MinimumCount: 3, WindowDuration: 30},
		},
	},
}

// PersonalWebsiteAudiences defines all audiences for Personal Website
var PersonalWebsiteAudiences = []EnhancedAudience{
	// Original audiences (simplified versions)
	{
		Name:               "Content Consumers",
		Description:        "Read 3+ articles in 30 days",
		MembershipDuration: 30,
		Category:           "Content",
		EventTriggers: []EventTrigger{
			{EventName: "article_read", MinimumCount: 3, WindowDuration: 30},
		},
	},
	{
		Name:               "Technical Readers",
		Description:        "Copied 2+ code snippets",
		MembershipDuration: 30,
		Category:           "Content",
		EventTriggers: []EventTrigger{
			{EventName: "code_copy", MinimumCount: 2, WindowDuration: 30},
		},
	},
	{
		Name:               "Potential Subscribers",
		Description:        "Read 2+ articles, viewed form, didn't subscribe",
		MembershipDuration: 14,
		Category:           "Conversion",
		EventTriggers: []EventTrigger{
			{EventName: "article_read", MinimumCount: 2, WindowDuration: 14},
		},
		FilterClauses: []FilterClause{
			{
				ClauseType: "NOT",
				Filters: []AudienceFilter{
					{FieldName: "event_name", Operator: "EQUALS", Value: "newsletter_subscribe"},
				},
			},
		},
	},

	// SEO-Focused Audiences
	{
		Name:               "Organic Article Readers",
		Description:        "Users who visited articles via organic search",
		MembershipDuration: 30,
		Category:           "SEO",
		EventTriggers: []EventTrigger{
			{EventName: "organic_article_visit", MinimumCount: 1, WindowDuration: 30},
		},
	},
	{
		Name:               "Search Console Stars",
		Description:        "Users arriving from top 3 search positions",
		MembershipDuration: 30,
		Category:           "SEO",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "dimension.search_position", Operator: "LESS_THAN", Value: 4},
					{FieldName: "dimension.organic_source", Operator: "NOT_NULL", Value: nil},
				},
			},
		},
	},
	{
		Name:               "Featured Snippet Fans",
		Description:        "Users who viewed featured snippet results",
		MembershipDuration: 14,
		Category:           "SEO",
		EventTriggers: []EventTrigger{
			{EventName: "featured_snippet_view", MinimumCount: 1, WindowDuration: 14},
		},
	},
	{
		Name:               "Backlink Visitors",
		Description:        "Users arriving via backlinks",
		MembershipDuration: 30,
		Category:           "SEO",
		EventTriggers: []EventTrigger{
			{EventName: "backlink_click", MinimumCount: 1, WindowDuration: 30},
		},
	},

	// Content Engagement Audiences
	{
		Name:               "Deep Readers",
		Description:        "Users with 90%+ completion on 2+ articles",
		MembershipDuration: 30,
		Category:           "Content",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "dimension.completion_rate", Operator: "GREATER_THAN", Value: 90},
				},
			},
		},
		EventTriggers: []EventTrigger{
			{EventName: "article_read", MinimumCount: 2, WindowDuration: 30},
		},
	},
	{
		Name:               "Serial Visitors",
		Description:        "Users with 5+ sessions in 30 days",
		MembershipDuration: 30,
		Category:           "Content",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "session_count", Operator: "GREATER_THAN", Value: 5},
				},
			},
		},
	},
	{
		Name:               "Share Champions",
		Description:        "Users who shared content 2+ times",
		MembershipDuration: 30,
		Category:           "Content",
		EventTriggers: []EventTrigger{
			{EventName: "article_share_linkedin", MinimumCount: 1, WindowDuration: 30},
			{EventName: "article_share_twitter", MinimumCount: 1, WindowDuration: 30},
		},
	},
	{
		Name:               "Comment Engagers",
		Description:        "Users who submitted comments",
		MembershipDuration: 30,
		Category:           "Content",
		EventTriggers: []EventTrigger{
			{EventName: "comment_submitted", MinimumCount: 1, WindowDuration: 30},
		},
	},

	// Conversion Optimization Audiences
	{
		Name:               "Newsletter Prospects",
		Description:        "Read 2+ articles but not subscribed",
		MembershipDuration: 14,
		Category:           "Conversion",
		EventTriggers: []EventTrigger{
			{EventName: "article_read", MinimumCount: 2, WindowDuration: 14},
		},
		FilterClauses: []FilterClause{
			{
				ClauseType: "NOT",
				Filters: []AudienceFilter{
					{FieldName: "event_name", Operator: "EQUALS", Value: "newsletter_subscribe"},
				},
			},
		},
	},
	{
		Name:               "Career Interested",
		Description:        "Viewed about/resume pages",
		MembershipDuration: 30,
		Category:           "Conversion",
		FilterClauses: []FilterClause{
			{
				ClauseType: "OR",
				Filters: []AudienceFilter{
					{FieldName: "page_location", Operator: "CONTAINS", Value: "/about"},
					{FieldName: "page_location", Operator: "CONTAINS", Value: "/resume"},
				},
			},
		},
	},
	{
		Name:               "Contact Intent",
		Description:        "Viewed contact page but didn't submit",
		MembershipDuration: 7,
		Category:           "Conversion",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "page_location", Operator: "CONTAINS", Value: "/contact"},
				},
			},
			{
				ClauseType: "NOT",
				Filters: []AudienceFilter{
					{FieldName: "event_name", Operator: "EQUALS", Value: "contact_form_submit"},
				},
			},
		},
	},
	{
		Name:               "Demo Clickers",
		Description:        "Users who clicked on demo links",
		MembershipDuration: 30,
		Category:           "Conversion",
		EventTriggers: []EventTrigger{
			{EventName: "demo_click", MinimumCount: 1, WindowDuration: 30},
		},
	},

	// Behavioral Audiences
	{
		Name:               "High-Intent Readers",
		Description:        "Users who viewed 5+ pages in a session",
		MembershipDuration: 7,
		Category:           "Behavioral",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "dimension.pages_per_session", Operator: "GREATER_THAN", Value: 5},
				},
			},
		},
	},
	{
		Name:               "Quick Bouncers",
		Description:        "Users who spent less than 10 seconds on site",
		MembershipDuration: 7,
		Category:           "Behavioral",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "engagement_time_msec", Operator: "LESS_THAN", Value: 10000},
					{FieldName: "dimension.bounce_indicator", Operator: "EQUALS", Value: "true"},
				},
			},
		},
		ExclusionDuration: 30,
	},
	{
		Name:               "Weekend Readers",
		Description:        "Users who primarily read on weekends",
		MembershipDuration: 30,
		Category:           "Behavioral",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "day_of_week", Operator: "IN", Value: []string{"Saturday", "Sunday"}},
				},
			},
		},
	},
	{
		Name:               "Mobile Readers",
		Description:        "Users with 90%+ mobile sessions",
		MembershipDuration: 30,
		Category:           "Behavioral",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "device_category", Operator: "EQUALS", Value: "mobile"},
				},
			},
		},
	},
	{
		Name:               "Long-Form Enthusiasts",
		Description:        "Users who read articles with 2000+ words",
		MembershipDuration: 30,
		Category:           "Behavioral",
		FilterClauses: []FilterClause{
			{
				ClauseType: "AND",
				Filters: []AudienceFilter{
					{FieldName: "dimension.word_count", Operator: "GREATER_THAN", Value: 2000},
				},
			},
		},
		EventTriggers: []EventTrigger{
			{EventName: "article_read", MinimumCount: 2, WindowDuration: 30},
		},
	},
}
