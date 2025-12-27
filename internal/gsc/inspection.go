package gsc

import (
	"fmt"
	"net/url"

	"google.golang.org/api/searchconsole/v1"
)

// URLInspectionResult contains information about a URL's indexing status
type URLInspectionResult struct {
	URL               string
	InspectionURL     string
	IndexStatus       string // INDEXED, EXCLUDED, ERROR
	CoverageState     string // SUBMITTED_AND_INDEXED, NOT_FOUND, BLOCKED, etc.
	LastCrawlTime     string
	GoogleCanonical   string
	UserCanonical     string
	RobotsBlocked     bool
	IndexingAllowed   bool
	MobileUsable      bool
	MobileIssues      []string
	RichResultsStatus string
	RichResultsIssues []string
	IndexingIssues    []IndexingIssue
}

// IndexingIssue represents a specific indexing problem
type IndexingIssue struct {
	Severity  string // ERROR, WARNING
	Message   string
	IssueType string // ROBOTS_TXT, NOT_FOUND, SERVER_ERROR, REDIRECT, etc.
}

// InspectURL checks the index status for a single URL
// siteURL must be a verified property in Search Console (e.g., "https://example.com/")
// inspectURL is the specific URL to inspect (must belong to the property)
func (c *Client) InspectURL(siteURL, inspectURL string) (*URLInspectionResult, error) {
	if err := validateSiteURL(siteURL); err != nil {
		return nil, err
	}

	if err := validateInspectionURL(inspectURL); err != nil {
		return nil, err
	}

	// Check daily quota before making API call
	if err := c.checkDailyQuota(); err != nil {
		return nil, err
	}

	if err := c.waitForRateLimit("InspectURL"); err != nil {
		return nil, err
	}

	c.logger.Info("inspecting URL",
		"site_url", siteURL,
		"inspect_url", inspectURL)

	// Create the inspection request
	request := &searchconsole.InspectUrlIndexRequest{
		InspectionUrl: inspectURL,
		SiteUrl:       siteURL,
	}

	// Call the API
	response, err := c.service.UrlInspection.Index.Inspect(request).Do()
	if err != nil {
		c.logger.Error("failed to inspect URL",
			"site_url", siteURL,
			"inspect_url", inspectURL,
			"error", err)
		return nil, fmt.Errorf("failed to inspect URL %s: %w", inspectURL, err)
	}

	// Increment quota counter after successful API call
	c.incrementQuota()

	// Transform API response to our domain type
	result := transformInspectionResponse(response, inspectURL)

	c.logger.Info("URL inspected successfully",
		"site_url", siteURL,
		"inspect_url", inspectURL,
		"index_status", result.IndexStatus,
		"coverage_state", result.CoverageState)

	return result, nil
}

// InspectMultipleURLs inspects multiple URLs with progress reporting
// Respects rate limits automatically via the client's rate limiter
func (c *Client) InspectMultipleURLs(siteURL string, inspectURLs []string) ([]URLInspectionResult, error) {
	if err := validateSiteURL(siteURL); err != nil {
		return nil, err
	}

	c.logger.Info("inspecting multiple URLs",
		"site_url", siteURL,
		"count", len(inspectURLs))

	results := make([]URLInspectionResult, 0, len(inspectURLs))

	for i, inspectURL := range inspectURLs {
		c.logger.Debug("inspecting URL",
			"progress", fmt.Sprintf("%d/%d", i+1, len(inspectURLs)),
			"inspect_url", inspectURL)

		result, err := c.InspectURL(siteURL, inspectURL)
		if err != nil {
			c.logger.Error("batch inspection failed",
				"inspect_url", inspectURL,
				"progress", fmt.Sprintf("%d/%d", i+1, len(inspectURLs)),
				"error", err)
			return nil, fmt.Errorf("failed to inspect URL %s (at %d/%d): %w", inspectURL, i+1, len(inspectURLs), err)
		}

		results = append(results, *result)
	}

	c.logger.Info("all URLs inspected successfully",
		"site_url", siteURL,
		"count", len(results))

	return results, nil
}

// transformInspectionResponse converts the API response to our domain type
func transformInspectionResponse(response *searchconsole.InspectUrlIndexResponse, inspectURL string) *URLInspectionResult {
	result := &URLInspectionResult{
		URL:               inspectURL,
		InspectionURL:     inspectURL,
		IndexingIssues:    make([]IndexingIssue, 0),
		MobileIssues:      make([]string, 0),
		RichResultsIssues: make([]string, 0),
	}

	// Extract inspection result
	if response.InspectionResult == nil {
		return result
	}

	inspectionResult := response.InspectionResult

	// Index status from IndexStatusResult
	if inspectionResult.IndexStatusResult != nil {
		indexStatus := inspectionResult.IndexStatusResult

		// Verdict (PASS, PARTIAL, FAIL, NEUTRAL)
		result.IndexStatus = indexStatus.Verdict
		result.CoverageState = indexStatus.CoverageState
		result.IndexingAllowed = indexStatus.IndexingState != "INDEXING_DISALLOWED"

		// Crawl info
		if indexStatus.CrawledAs != "" {
			result.LastCrawlTime = indexStatus.LastCrawlTime
		}

		// Canonical URLs
		if indexStatus.GoogleCanonical != "" {
			result.GoogleCanonical = indexStatus.GoogleCanonical
		}
		if indexStatus.UserCanonical != "" {
			result.UserCanonical = indexStatus.UserCanonical
		}

		// Robots.txt blocking
		if indexStatus.RobotsTxtState == "BLOCKED" {
			result.RobotsBlocked = true
			result.IndexingIssues = append(result.IndexingIssues, IndexingIssue{
				Severity:  "ERROR",
				Message:   "URL is blocked by robots.txt",
				IssueType: "ROBOTS_TXT",
			})
		}

		// Coverage state detection (detect specific indexing issues)
		detectCoverageIssues(indexStatus.CoverageState, &result.IndexingIssues)

		// Page fetch status (detect HTTP errors and fetch failures)
		detectPageFetchIssues(indexStatus.PageFetchState, &result.IndexingIssues)
	}

	// Mobile usability
	if inspectionResult.MobileUsabilityResult != nil {
		mobileResult := inspectionResult.MobileUsabilityResult
		result.MobileUsable = mobileResult.Verdict == "PASS"

		// Extract mobile issues
		if mobileResult.Issues != nil {
			for _, issue := range mobileResult.Issues {
				result.MobileIssues = append(result.MobileIssues, issue.IssueType)
				result.IndexingIssues = append(result.IndexingIssues, IndexingIssue{
					Severity:  "WARNING",
					Message:   fmt.Sprintf("Mobile usability issue: %s", issue.IssueType),
					IssueType: "MOBILE_" + issue.IssueType,
				})
			}
		}
	}

	// Rich results
	if inspectionResult.RichResultsResult != nil {
		richResults := inspectionResult.RichResultsResult
		result.RichResultsStatus = richResults.Verdict

		// Extract rich results issues
		if richResults.DetectedItems != nil {
			for _, item := range richResults.DetectedItems {
				if item.Items != nil {
					for _, richItem := range item.Items {
						if richItem.Issues != nil {
							for _, issue := range richItem.Issues {
								result.RichResultsIssues = append(result.RichResultsIssues, issue.IssueMessage)
								result.IndexingIssues = append(result.IndexingIssues, IndexingIssue{
									Severity:  severityFromString(issue.Severity),
									Message:   issue.IssueMessage,
									IssueType: "RICH_RESULTS",
								})
							}
						}
					}
				}
			}
		}
	}

	return result
}

// severityFromString converts API severity to our severity type
func severityFromString(severity string) string {
	switch severity {
	case "ERROR":
		return "ERROR"
	case "WARNING":
		return "WARNING"
	default:
		return "WARNING"
	}
}

// validateInspectionURL validates that an inspection URL is properly formatted
func validateInspectionURL(inspectURL string) error {
	if inspectURL == "" {
		return fmt.Errorf("inspection URL cannot be empty")
	}

	// Parse URL to validate format
	u, err := url.Parse(inspectURL)
	if err != nil {
		return fmt.Errorf("invalid inspection URL format: %w", err)
	}

	// Must be http or https
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("inspection URL must use http or https scheme: %s", inspectURL)
	}

	return nil
}

// detectCoverageIssues detects specific indexing issues based on coverage state
func detectCoverageIssues(coverageState string, issues *[]IndexingIssue) {
	if coverageState == "" {
		return
	}

	switch coverageState {
	case "EXCLUDED_BY_NOINDEX_TAG":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Page is excluded by noindex tag",
			IssueType: "NOINDEX_TAG",
		})

	case "BLOCKED_BY_ROBOTS_TXT":
		// Already handled in RobotsTxtState check, but add for completeness
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Page is blocked by robots.txt",
			IssueType: "ROBOTS_TXT",
		})

	case "NOT_FOUND", "SOFT_404_DETECTED":
		severity := "ERROR"
		message := "Page not found (404 error)"
		issueType := "NOT_FOUND"

		if coverageState == "SOFT_404_DETECTED" {
			message = "Soft 404 detected - page returns 200 but looks like a 404"
			issueType = "SOFT_404"
			severity = "WARNING"
		}

		*issues = append(*issues, IndexingIssue{
			Severity:  severity,
			Message:   message,
			IssueType: issueType,
		})

	case "PAGE_WITH_REDIRECT":
		*issues = append(*issues, IndexingIssue{
			Severity:  "WARNING",
			Message:   "Page has a redirect - Google follows redirects but canonical should be the final URL",
			IssueType: "REDIRECT",
		})

	case "CRAWLED_NOT_INDEXED":
		*issues = append(*issues, IndexingIssue{
			Severity:  "WARNING",
			Message:   "Page was crawled but not indexed - check content quality or duplicate content",
			IssueType: "CRAWLED_NOT_INDEXED",
		})

	case "DISCOVERED_NOT_INDEXED":
		*issues = append(*issues, IndexingIssue{
			Severity:  "WARNING",
			Message:   "Page was discovered but not indexed - may need more time or better content quality",
			IssueType: "DISCOVERED_NOT_INDEXED",
		})

	case "DUPLICATE_WITHOUT_CANONICAL":
		*issues = append(*issues, IndexingIssue{
			Severity:  "WARNING",
			Message:   "Duplicate content detected without canonical tag - add rel=canonical",
			IssueType: "DUPLICATE_NO_CANONICAL",
		})

	case "DUPLICATE_GOOGLE_CHOSE_CANONICAL":
		*issues = append(*issues, IndexingIssue{
			Severity:  "WARNING",
			Message:   "Google chose a different canonical URL than specified",
			IssueType: "CANONICAL_MISMATCH",
		})

	case "ALTERNATE_PAGE_WITH_PROPER_CANONICAL_TAG":
		*issues = append(*issues, IndexingIssue{
			Severity:  "WARNING",
			Message:   "Page is alternate version with proper canonical tag - this is expected for translated/mobile pages",
			IssueType: "ALTERNATE_CANONICAL",
		})

	case "BLOCKED_DUE_TO_UNAUTHORIZED_REQUEST":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Page blocked due to unauthorized request (401/403 error)",
			IssueType: "UNAUTHORIZED",
		})

	case "BLOCKED_DUE_TO_ACCESS_FORBIDDEN":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Page access forbidden (403 error)",
			IssueType: "FORBIDDEN",
		})

	case "BLOCKED_DUE_TO_OTHER_4XX_ISSUE":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Page blocked due to 4xx client error (check server logs)",
			IssueType: "CLIENT_ERROR_4XX",
		})

	case "SUBMITTED_AND_INDEXED":
		// Success case - no issue to report
		return

	default:
		// Unknown coverage state - log but don't add as issue
		// This handles future API changes gracefully
		return
	}
}

// detectPageFetchIssues detects HTTP errors and fetch failures
func detectPageFetchIssues(pageFetchState string, issues *[]IndexingIssue) {
	if pageFetchState == "" {
		return
	}

	switch pageFetchState {
	case "SUCCESSFUL":
		// Success - no issue
		return

	case "SOFT_404":
		*issues = append(*issues, IndexingIssue{
			Severity:  "WARNING",
			Message:   "Soft 404 detected during page fetch",
			IssueType: "SOFT_404",
		})

	case "BLOCKED_ROBOTS_TXT":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Page fetch blocked by robots.txt",
			IssueType: "ROBOTS_TXT",
		})

	case "NOT_FOUND":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Page not found (404 error) during fetch",
			IssueType: "NOT_FOUND",
		})

	case "ACCESS_DENIED":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Access denied (403 error) during page fetch",
			IssueType: "FORBIDDEN",
		})

	case "SERVER_ERROR":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Server error (5xx) during page fetch - check server health",
			IssueType: "SERVER_ERROR_5XX",
		})

	case "REDIRECT_ERROR":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Redirect error - too many redirects or redirect loop detected",
			IssueType: "REDIRECT_ERROR",
		})

	case "ACCESS_FORBIDDEN":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Access forbidden during page fetch",
			IssueType: "FORBIDDEN",
		})

	case "BLOCKED_4XX":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Page blocked by 4xx client error during fetch",
			IssueType: "CLIENT_ERROR_4XX",
		})

	case "INTERNAL_CRAWL_ERROR":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Internal Google crawl error - this is usually temporary",
			IssueType: "CRAWL_ERROR",
		})

	case "INVALID_URL":
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Invalid URL format detected by crawler",
			IssueType: "INVALID_URL",
		})

	case "UNSUCCESSFUL":
		// Generic failure - already handled in old code, but add specific message
		*issues = append(*issues, IndexingIssue{
			Severity:  "ERROR",
			Message:   "Page fetch unsuccessful - check server connectivity and response",
			IssueType: "FETCH_ERROR",
		})

	default:
		// Unknown state - handle gracefully
		return
	}
}
