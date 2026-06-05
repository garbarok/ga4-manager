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

// Compile-time guarantee that *Client satisfies SearchAPI.
var _ SearchAPI = (*Client)(nil)
