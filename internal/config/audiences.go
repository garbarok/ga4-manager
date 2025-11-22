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
	EventName      string
	MinimumCount   int
	WindowDuration int // days
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
