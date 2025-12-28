package gsc

import (
	"fmt"
	"sort"
)

// IndexCoverageReport contains aggregated indexing statistics for a site
// Note: This is an estimate based on Search Analytics data, not real-time coverage data
type IndexCoverageReport struct {
	SiteURL        string         // Site URL that was queried
	Period         string         // Date range for the report
	TotalPages     int            // Total unique pages found in Search Analytics
	IndexedPages   int            // Pages with impressions (assumed indexed)
	IssueBreakdown map[string]int // Breakdown by issue type (estimated)
	TopIssues      []IssueCount   // Top issues sorted by frequency
	PagesSample    []PageCoverage // Sample of pages with their coverage status
}

// IssueCount represents a coverage issue type with its count
type IssueCount struct {
	Issue string // Issue type/description
	Count int    // Number of pages with this issue
}

// PageCoverage represents coverage status for a single page
type PageCoverage struct {
	URL         string  // Page URL
	Impressions int64   // Number of impressions
	Clicks      int64   // Number of clicks
	CTR         float64 // Click-through rate
	Position    float64 // Average position
	Status      string  // Estimated status: "indexed", "low_impressions"
}

// GetIndexCoverageReport generates an index coverage report by querying Search Analytics
// This provides an estimate of indexed pages based on search performance data
func (c *Client) GetIndexCoverageReport(siteURL string, days int) (*IndexCoverageReport, error) {
	c.logger.Info("generating index coverage report",
		"site_url", siteURL,
		"days", days)

	// Build date range
	startDate, endDate := BuildDateRange(days)

	// Query Search Analytics with page dimension to get all pages with search data
	query := &SearchAnalyticsQuery{
		SiteURL:    siteURL,
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"page"},
		RowLimit:   25000, // Maximum allowed by GSC API
		DataState:  "final",
	}

	report, err := c.QuerySearchAnalytics(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query search analytics for coverage: %w", err)
	}

	// Transform search analytics data into coverage report
	coverage := c.transformToCoverageReport(report, siteURL)

	c.logger.Info("index coverage report generated",
		"site_url", siteURL,
		"total_pages", coverage.TotalPages,
		"indexed_pages", coverage.IndexedPages)

	return coverage, nil
}

// GetIndexCoverageReportFiltered generates a coverage report filtered by status
// status can be: "indexed", "low_impressions", or "all"
func (c *Client) GetIndexCoverageReportFiltered(siteURL string, days int, status string, topIssuesLimit int) (*IndexCoverageReport, error) {
	// Get full coverage report
	coverage, err := c.GetIndexCoverageReport(siteURL, days)
	if err != nil {
		return nil, err
	}

	// Filter pages by status if not "all"
	if status != "all" && status != "" {
		filteredPages := make([]PageCoverage, 0)
		for _, page := range coverage.PagesSample {
			if page.Status == status {
				filteredPages = append(filteredPages, page)
			}
		}
		coverage.PagesSample = filteredPages
	}

	// Limit top issues if specified
	if topIssuesLimit > 0 && len(coverage.TopIssues) > topIssuesLimit {
		coverage.TopIssues = coverage.TopIssues[:topIssuesLimit]
	}

	return coverage, nil
}

// transformToCoverageReport converts a Search Analytics report into a coverage report
func (c *Client) transformToCoverageReport(analyticsReport *SearchAnalyticsReport, siteURL string) *IndexCoverageReport {
	coverage := &IndexCoverageReport{
		SiteURL:        siteURL,
		Period:         analyticsReport.Period,
		TotalPages:     len(analyticsReport.Rows),
		IssueBreakdown: make(map[string]int),
		TopIssues:      make([]IssueCount, 0),
		PagesSample:    make([]PageCoverage, 0),
	}

	// Categorize pages based on their search performance
	for _, row := range analyticsReport.Rows {
		pageURL := row.Keys[0] // First dimension is "page"

		// Determine page status based on impressions
		status := "indexed"
		if row.Impressions == 0 {
			status = "no_impressions"
			coverage.IssueBreakdown["No impressions"]++
		} else if row.Impressions < 10 {
			status = "low_impressions"
			coverage.IssueBreakdown["Low impressions (< 10)"]++
			coverage.IndexedPages++ // Still counts as indexed
		} else {
			coverage.IssueBreakdown["Indexed"]++
			coverage.IndexedPages++
		}

		// Add to pages sample (limit to first 1000 for performance)
		if len(coverage.PagesSample) < 1000 {
			coverage.PagesSample = append(coverage.PagesSample, PageCoverage{
				URL:         pageURL,
				Impressions: row.Impressions,
				Clicks:      row.Clicks,
				CTR:         row.CTR,
				Position:    row.Position,
				Status:      status,
			})
		}
	}

	// Convert issue breakdown to sorted top issues list
	for issue, count := range coverage.IssueBreakdown {
		coverage.TopIssues = append(coverage.TopIssues, IssueCount{
			Issue: issue,
			Count: count,
		})
	}

	// Sort top issues by count (descending)
	sort.Slice(coverage.TopIssues, func(i, j int) bool {
		return coverage.TopIssues[i].Count > coverage.TopIssues[j].Count
	})

	return coverage
}
