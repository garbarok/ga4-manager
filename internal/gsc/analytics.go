package gsc

import (
	"fmt"
	"strings"
	"time"

	"google.golang.org/api/searchconsole/v1"
)

// SearchAnalyticsQuery represents a search analytics query configuration
type SearchAnalyticsQuery struct {
	SiteURL    string                              // Site URL (sc-domain: or https://)
	StartDate  string                              // Start date (YYYY-MM-DD)
	EndDate    string                              // End date (YYYY-MM-DD)
	Dimensions []string                            // Dimensions: query, page, country, device, searchAppearance
	RowLimit   int                                 // Maximum rows to return (max 25,000)
	Filters    []*searchconsole.ApiDimensionFilter // Filters to apply
	DataState  string                              // "all" or "final" (default: final)
}

// SearchAnalyticsReport represents the result of a search analytics query
type SearchAnalyticsReport struct {
	Period     string                   // Date range description (e.g., "2024-11-01 to 2024-11-30")
	SiteURL    string                   // Site URL that was queried
	Rows       []SearchAnalyticsRow     // Individual result rows
	TotalRows  int                      // Total number of rows returned
	Aggregates SearchAnalyticsAggregate // Aggregated totals
	Metadata   ReportMetadata           // Query metadata
}

// SearchAnalyticsRow represents a single row in the search analytics results
type SearchAnalyticsRow struct {
	Keys        []string // Values for each dimension (e.g., query text, page URL, country code)
	Clicks      int64    // Number of clicks
	Impressions int64    // Number of impressions
	CTR         float64  // Click-through rate (clicks/impressions)
	Position    float64  // Average position in search results
}

// SearchAnalyticsAggregate contains aggregated metrics across all rows
type SearchAnalyticsAggregate struct {
	TotalClicks      int64   // Total clicks across all rows
	TotalImpressions int64   // Total impressions across all rows
	AverageCTR       float64 // Average CTR across all rows
	AveragePosition  float64 // Average position across all rows
}

// ReportMetadata contains metadata about the query execution
type ReportMetadata struct {
	QueryDate   time.Time // When the query was executed
	StartDate   string    // Query start date
	EndDate     string    // Query end date
	Dimensions  []string  // Dimensions requested
	RowLimit    int       // Row limit applied
	FilterCount int       // Number of filters applied
}

// ValidDimensions lists all valid Search Console dimensions
var ValidDimensions = map[string]bool{
	"query":            true,
	"page":             true,
	"country":          true,
	"device":           true,
	"searchAppearance": true,
	"date":             true, // Can be used for trend analysis
}

// ValidFilterOperators lists all valid filter operators
var ValidFilterOperators = map[string]bool{
	"equals":         true,
	"notEquals":      true,
	"contains":       true,
	"notContains":    true,
	"includingRegex": true,
	"excludingRegex": true,
}

// QuerySearchAnalytics executes a search analytics query and returns the results
func (c *Client) QuerySearchAnalytics(query *SearchAnalyticsQuery) (*SearchAnalyticsReport, error) {
	c.logger.Debug("executing search analytics query",
		"site_url", query.SiteURL,
		"start_date", query.StartDate,
		"end_date", query.EndDate,
		"dimensions", strings.Join(query.Dimensions, ","),
		"row_limit", query.RowLimit,
	)

	// Validate query parameters
	if err := c.validateSearchQuery(query); err != nil {
		return nil, fmt.Errorf("invalid search query: %w", err)
	}

	// Check daily quota before making API call
	if err := c.checkDailyQuota(); err != nil {
		return nil, fmt.Errorf("quota check failed: %w", err)
	}

	// Wait for rate limiter
	if err := c.waitForRateLimit("QuerySearchAnalytics"); err != nil {
		return nil, fmt.Errorf("rate limit wait failed: %w", err)
	}

	// Build the Search Console API request
	request := &searchconsole.SearchAnalyticsQueryRequest{
		StartDate:  query.StartDate,
		EndDate:    query.EndDate,
		Dimensions: query.Dimensions,
		RowLimit:   int64(query.RowLimit),
		DataState:  query.DataState,
	}

	// Add filters if provided
	if len(query.Filters) > 0 {
		request.DimensionFilterGroups = []*searchconsole.ApiDimensionFilterGroup{
			{
				Filters: query.Filters,
			},
		}
	}

	// Execute the API call
	c.logger.Info("querying search analytics",
		"site_url", query.SiteURL,
		"date_range", fmt.Sprintf("%s to %s", query.StartDate, query.EndDate),
	)

	response, err := c.service.Searchanalytics.Query(query.SiteURL, request).Context(c.ctx).Do()
	if err != nil {
		c.logger.Error("search analytics query failed",
			"site_url", query.SiteURL,
			"error", err,
		)
		return nil, fmt.Errorf("search analytics query failed for %s: %w", query.SiteURL, err)
	}

	// Increment quota counter
	c.incrementQuota()

	c.logger.Info("search analytics query completed",
		"site_url", query.SiteURL,
		"rows_returned", len(response.Rows),
	)

	// Transform API response to our report format
	report := c.transformSearchAnalyticsResponse(query, response)

	return report, nil
}

// transformSearchAnalyticsResponse converts the API response to our report format
func (c *Client) transformSearchAnalyticsResponse(query *SearchAnalyticsQuery, response *searchconsole.SearchAnalyticsQueryResponse) *SearchAnalyticsReport {
	report := &SearchAnalyticsReport{
		Period:  fmt.Sprintf("%s to %s", query.StartDate, query.EndDate),
		SiteURL: query.SiteURL,
		Rows:    make([]SearchAnalyticsRow, 0, len(response.Rows)),
		Metadata: ReportMetadata{
			QueryDate:   time.Now(),
			StartDate:   query.StartDate,
			EndDate:     query.EndDate,
			Dimensions:  query.Dimensions,
			RowLimit:    query.RowLimit,
			FilterCount: len(query.Filters),
		},
	}

	// Transform each row
	var totalClicks, totalImpressions int64
	var totalCTR, totalPosition float64

	for _, apiRow := range response.Rows {
		row := SearchAnalyticsRow{
			Keys:        apiRow.Keys,
			Clicks:      int64(apiRow.Clicks),
			Impressions: int64(apiRow.Impressions),
			CTR:         apiRow.Ctr,
			Position:    apiRow.Position,
		}

		report.Rows = append(report.Rows, row)

		// Accumulate for aggregates
		totalClicks += row.Clicks
		totalImpressions += row.Impressions
		totalCTR += row.CTR
		totalPosition += row.Position
	}

	report.TotalRows = len(report.Rows)

	// Calculate aggregates
	if report.TotalRows > 0 {
		report.Aggregates = SearchAnalyticsAggregate{
			TotalClicks:      totalClicks,
			TotalImpressions: totalImpressions,
			AverageCTR:       totalCTR / float64(report.TotalRows),
			AveragePosition:  totalPosition / float64(report.TotalRows),
		}
	}

	return report
}

// BuildDateRange creates start and end dates for the last N days
// Returns dates in YYYY-MM-DD format required by Search Console API
func BuildDateRange(days int) (startDate, endDate string) {
	now := time.Now()

	// End date is yesterday (Search Console data is usually 2-3 days behind)
	end := now.AddDate(0, 0, -1)

	// Start date is N days before end date
	start := end.AddDate(0, 0, -(days - 1))

	startDate = start.Format("2006-01-02")
	endDate = end.Format("2006-01-02")

	return startDate, endDate
}

// BuildDateRangeExact creates start and end dates for specific dates
// Useful for custom date ranges
func BuildDateRangeExact(startDate, endDate time.Time) (string, string) {
	return startDate.Format("2006-01-02"), endDate.Format("2006-01-02")
}

// ValidateDimensions checks if all provided dimensions are valid
func ValidateDimensions(dimensions []string) error {
	if len(dimensions) == 0 {
		return fmt.Errorf("at least one dimension is required")
	}

	if len(dimensions) > 3 {
		return fmt.Errorf("maximum 3 dimensions allowed (GSC API limit), got %d", len(dimensions))
	}

	for _, dim := range dimensions {
		if !ValidDimensions[dim] {
			validDims := make([]string, 0, len(ValidDimensions))
			for d := range ValidDimensions {
				validDims = append(validDims, d)
			}
			return fmt.Errorf("invalid dimension '%s': must be one of %v", dim, validDims)
		}
	}

	return nil
}

// ValidateFilterOperator checks if a filter operator is valid
func ValidateFilterOperator(operator string) error {
	if !ValidFilterOperators[operator] {
		validOps := make([]string, 0, len(ValidFilterOperators))
		for op := range ValidFilterOperators {
			validOps = append(validOps, op)
		}
		return fmt.Errorf("invalid filter operator '%s': must be one of %v", operator, validOps)
	}
	return nil
}

// ValidateDateRange checks if a date range is valid
func ValidateDateRange(startDate, endDate string) error {
	// Parse dates
	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return fmt.Errorf("invalid start date format '%s': must be YYYY-MM-DD", startDate)
	}

	end, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		return fmt.Errorf("invalid end date format '%s': must be YYYY-MM-DD", endDate)
	}

	// End date must be after start date
	if end.Before(start) {
		return fmt.Errorf("end date %s must be after start date %s", endDate, startDate)
	}

	// Check if dates are in the future
	now := time.Now()
	if start.After(now) {
		return fmt.Errorf("start date %s cannot be in the future", startDate)
	}
	if end.After(now) {
		return fmt.Errorf("end date %s cannot be in the future", endDate)
	}

	// Check 16-month limit (Search Console limitation)
	maxHistory := now.AddDate(0, -16, 0)
	if start.Before(maxHistory) {
		return fmt.Errorf("start date %s exceeds 16-month history limit (earliest: %s)",
			startDate, maxHistory.Format("2006-01-02"))
	}

	return nil
}

// validateSearchQuery performs comprehensive validation on a search analytics query
func (c *Client) validateSearchQuery(query *SearchAnalyticsQuery) error {
	// Validate site URL
	if query.SiteURL == "" {
		return fmt.Errorf("site URL is required")
	}

	// Validate date range
	if err := ValidateDateRange(query.StartDate, query.EndDate); err != nil {
		return err
	}

	// Validate dimensions
	if err := ValidateDimensions(query.Dimensions); err != nil {
		return err
	}

	// Validate row limit
	if query.RowLimit <= 0 {
		return fmt.Errorf("row limit must be greater than 0")
	}
	if query.RowLimit > 25000 {
		return fmt.Errorf("row limit cannot exceed 25,000 (GSC API limit), got %d", query.RowLimit)
	}

	// Validate filters (if any)
	for i, filter := range query.Filters {
		if filter.Dimension == "" {
			return fmt.Errorf("filter %d: dimension is required", i)
		}
		if !ValidDimensions[filter.Dimension] {
			return fmt.Errorf("filter %d: invalid dimension '%s'", i, filter.Dimension)
		}
		if filter.Operator == "" {
			return fmt.Errorf("filter %d: operator is required", i)
		}
		if err := ValidateFilterOperator(filter.Operator); err != nil {
			return fmt.Errorf("filter %d: %w", i, err)
		}
		if filter.Expression == "" {
			return fmt.Errorf("filter %d: expression is required", i)
		}
	}

	// Set default data state if not provided
	if query.DataState == "" {
		query.DataState = "final" // Use final data by default (fully processed)
	}

	return nil
}

// CreateFilter is a helper to create a dimension filter
func CreateFilter(dimension, operator, expression string) *searchconsole.ApiDimensionFilter {
	return &searchconsole.ApiDimensionFilter{
		Dimension:  dimension,
		Operator:   operator,
		Expression: expression,
	}
}

// GetTopQueries is a convenience method to get top search queries
func (c *Client) GetTopQueries(siteURL string, days, limit int) (*SearchAnalyticsReport, error) {
	startDate, endDate := BuildDateRange(days)

	query := &SearchAnalyticsQuery{
		SiteURL:    siteURL,
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"query"},
		RowLimit:   limit,
		DataState:  "final",
	}

	return c.QuerySearchAnalytics(query)
}

// GetTopPages is a convenience method to get top landing pages
func (c *Client) GetTopPages(siteURL string, days, limit int) (*SearchAnalyticsReport, error) {
	startDate, endDate := BuildDateRange(days)

	query := &SearchAnalyticsQuery{
		SiteURL:    siteURL,
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"page"},
		RowLimit:   limit,
		DataState:  "final",
	}

	return c.QuerySearchAnalytics(query)
}

// GetDeviceBreakdown is a convenience method to get device-specific metrics
func (c *Client) GetDeviceBreakdown(siteURL string, days int) (*SearchAnalyticsReport, error) {
	startDate, endDate := BuildDateRange(days)

	query := &SearchAnalyticsQuery{
		SiteURL:    siteURL,
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"device"},
		RowLimit:   10, // Desktop, Mobile, Tablet
		DataState:  "final",
	}

	return c.QuerySearchAnalytics(query)
}

// GetCountryBreakdown is a convenience method to get country-specific metrics
func (c *Client) GetCountryBreakdown(siteURL string, days, limit int) (*SearchAnalyticsReport, error) {
	startDate, endDate := BuildDateRange(days)

	query := &SearchAnalyticsQuery{
		SiteURL:    siteURL,
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"country"},
		RowLimit:   limit,
		DataState:  "final",
	}

	return c.QuerySearchAnalytics(query)
}
