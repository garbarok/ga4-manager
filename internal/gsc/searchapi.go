package gsc

// SearchAPI is the narrow consumer interface over the Google Search Console
// SDK that the diagnostics commands depend on. Modelled on internal/ga4's
// adminAPI / fakeAdminAPI seam: the real implementation is the live *Client
// (and therefore the *searchconsole.Service it wraps), while tests substitute
// a fake that returns canned rows.
//
// Quota usage travels alongside the data it cost: callers read
// report.QuotaUsed off the returned *SearchAnalyticsReport rather than
// querying a separate state surface.
type SearchAPI interface {
	QuerySearchAnalytics(query *SearchAnalyticsQuery) (*SearchAnalyticsReport, error)
}

// InspectAPI is the consumer interface for URL Inspection. Diagnostic
// commands that need per-URL coverage data (e.g. cannibalisation severity
// tiering, hreflang validation, schema audits) depend on this seam in
// addition to SearchAPI. Each call charges one inspection against the daily
// quota; callers are expected to deduplicate URLs they care about before
// invoking InspectURL.
type InspectAPI interface {
	InspectURL(siteURL, inspectURL string) (*URLInspectionResult, error)
}

// Compile-time guarantee that *Client satisfies both diagnostic-side
// interfaces.
var (
	_ SearchAPI  = (*Client)(nil)
	_ InspectAPI = (*Client)(nil)
)
