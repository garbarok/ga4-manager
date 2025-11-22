package ga4

import (
	"fmt"
	"strings"
)

// CalculatedMetric represents a calculated metric definition
// Note: Calculated metrics must be created manually in GA4 UI as they are not yet
// fully supported in the Admin API. This provides documentation and guidance.
type CalculatedMetric struct {
	DisplayName  string
	Description  string
	Formula      string
	MetricUnit   string // STANDARD, CURRENCY, FEET, METERS, etc.
}

// Predefined calculated metrics for SEO and analytics
var DefaultCalculatedMetrics = []CalculatedMetric{
	{
		DisplayName: "Revenue per User",
		Description: "Average revenue generated per active user",
		Formula:     "totalRevenue / activeUsers",
		MetricUnit:  "CURRENCY",
	},
	{
		DisplayName: "Engagement Rate",
		Description: "Percentage of sessions that were engaged",
		Formula:     "engagedSessions / sessions",
		MetricUnit:  "STANDARD",
	},
	{
		DisplayName: "Average Order Value",
		Description: "Average value per transaction",
		Formula:     "totalRevenue / transactions",
		MetricUnit:  "CURRENCY",
	},
	{
		DisplayName: "Bounce Rate",
		Description: "Percentage of non-engaged sessions",
		Formula:     "bounces / sessions",
		MetricUnit:  "STANDARD",
	},
	{
		DisplayName: "Pages per Session",
		Description: "Average number of page views per session",
		Formula:     "screenPageViews / sessions",
		MetricUnit:  "STANDARD",
	},
	{
		DisplayName: "Organic Performance Index",
		Description: "Combined metric for organic traffic performance",
		Formula:     "(organicUsers * 0.4) + (organicConversions * 0.6)",
		MetricUnit:  "STANDARD",
	},
	{
		DisplayName: "Session Quality Score",
		Description: "Quality score based on engagement and conversions",
		Formula:     "(engagedSessions * 0.5) + (conversions * 0.5)",
		MetricUnit:  "STANDARD",
	},
	{
		DisplayName: "User Acquisition Cost",
		Description: "Cost per acquired user",
		Formula:     "advertiserAdCost / newUsers",
		MetricUnit:  "CURRENCY",
	},
}

// ListCalculatedMetrics returns the recommended calculated metrics
// Note: These are recommendations that must be created manually in GA4 UI
func (c *Client) ListCalculatedMetrics(propertyID string) ([]CalculatedMetric, error) {
	// Return default recommended calculated metrics
	return DefaultCalculatedMetrics, nil
}

// ValidateFormula validates a calculated metric formula
func (c *Client) ValidateFormula(formula string) error {
	if formula == "" {
		return fmt.Errorf("formula cannot be empty")
	}

	// Basic checks
	if !strings.Contains(formula, "/") && !strings.Contains(formula, "+") &&
		!strings.Contains(formula, "-") && !strings.Contains(formula, "*") {
		return fmt.Errorf("formula must contain at least one operator (+, -, *, /)")
	}

	// Check for balanced parentheses
	openCount := strings.Count(formula, "(")
	closeCount := strings.Count(formula, ")")
	if openCount != closeCount {
		return fmt.Errorf("formula has unbalanced parentheses")
	}

	return nil
}

// SetupDefaultCalculatedMetrics provides information about calculated metrics
// Since calculated metrics must be created manually in GA4 UI, this returns nil
// The setup command will display these as recommendations
func (c *Client) SetupDefaultCalculatedMetrics(propertyID string) error {
	// Calculated metrics must be created manually in GA4 UI
	// This function returns nil to indicate the list should be displayed
	return nil
}
