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
			{Name: "download_image", CountingMethod: "ONCE_PER_SESSION"},
			{Name: "compression_complete", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "format_conversion", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "blog_engagement", CountingMethod: "ONCE_PER_EVENT"},
		},
		Dimensions: []CustomDimension{
			{ParameterName: "user_type", DisplayName: "User Type", Description: "Classification of user behavior", Scope: "USER"},
			{ParameterName: "quality_setting", DisplayName: "Compression Quality", Description: "Quality setting used", Scope: "EVENT"},
			{ParameterName: "file_format", DisplayName: "File Format", Description: "Image file format", Scope: "EVENT"},
			{ParameterName: "compression_ratio", DisplayName: "Compression Ratio", Description: "Percentage of size reduction", Scope: "EVENT"},
			{ParameterName: "download_method", DisplayName: "Download Method", Description: "Download method (single/batch/zip)", Scope: "EVENT"},
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
			{Name: "newsletter_subscribe", CountingMethod: "ONCE_PER_SESSION"},
			{Name: "contact_form_submit", CountingMethod: "ONCE_PER_SESSION"},
			{Name: "demo_click", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "github_click", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "article_read", CountingMethod: "ONCE_PER_EVENT"},
			{Name: "code_copy", CountingMethod: "ONCE_PER_EVENT"},
		},
		Dimensions: []CustomDimension{
			{ParameterName: "article_category", DisplayName: "Article Category", Description: "Category of blog article", Scope: "EVENT"},
			{ParameterName: "content_language", DisplayName: "Content Language", Description: "Language (es/en)", Scope: "EVENT"},
			{ParameterName: "reader_type", DisplayName: "Reader Type", Description: "Reader engagement classification", Scope: "USER"},
			{ParameterName: "word_count", DisplayName: "Article Word Count", Description: "Number of words", Scope: "EVENT"},
			{ParameterName: "completion_rate", DisplayName: "Reading Completion", Description: "Percentage read", Scope: "EVENT"},
		},
		Audiences: []Audience{
			{Name: "Content Consumers", Description: "Read 3+ articles in 30 days", Duration: 30},
			{Name: "Technical Readers", Description: "Copied 2+ code snippets", Duration: 30},
			{Name: "Potential Subscribers", Description: "Read 2+ articles, viewed form, didn't subscribe", Duration: 14},
		},
	}

	AllProjects = []Project{SnapCompress, PersonalWebsite}
)
