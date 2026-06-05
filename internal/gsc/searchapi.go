package gsc

// SearchAPI is the narrow consumer interface over the Google Search Console
// SDK that the diagnostics commands depend on. Modelled on internal/ga4's
// adminAPI / realAdminAPI / fakeAdminAPI seam: the real implementation is a
// thin wrapper over the live *Client (and therefore over *searchconsole.Service),
// while tests substitute a fake that returns canned rows and reports a
// fixed quota.
//
// Methods stay in the package's own row type space (SearchAnalyticsRow) rather
// than leaking SDK request/response types, since the diagnostics layer never
// needs anything richer than rows + dimensions for now.
type SearchAPI interface {
	// QuerySearchAnalytics runs a search-analytics query against the configured
	// site. Returning the rows directly keeps the diagnostics layer one
	// indirection away from the SDK.
	QuerySearchAnalytics(query *SearchAnalyticsQuery) (*SearchAnalyticsReport, error)

	// QuotaUsed returns the number of GSC API calls this client has charged
	// against today's quota since it was created. Diagnostics commands surface
	// this value as quota_used in JSON output and as a text-mode footer.
	QuotaUsed() int
}

// QuotaUsed returns the GSC API calls this client has charged against today's
// quota. Implements SearchAPI so the live Client is a drop-in for the fake.
func (c *Client) QuotaUsed() int {
	used, _, _ := c.GetQuotaStatus()
	return used
}

// Compile-time guarantee that *Client satisfies SearchAPI.
var _ SearchAPI = (*Client)(nil)
