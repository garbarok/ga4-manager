package ga4

import (
	"fmt"

	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

// DataRetentionSettings represents GA4 data retention configuration
type DataRetentionSettings struct {
	EventDataRetention     string // "FOURTEEN_MONTHS" or "FIFTY_MONTHS"
	ResetUserDataOnNewActivity bool
}

// SetDataRetention configures data retention settings for a property
func (c *Client) SetDataRetention(propertyID string, months int, resetOnNewActivity bool) error {
	settingsPath := fmt.Sprintf("properties/%s/dataRetentionSettings", propertyID)

	// Determine retention duration string
	var retentionDuration string
	switch months {
	case 2:
		retentionDuration = "TWO_MONTHS"
	case 14:
		retentionDuration = "FOURTEEN_MONTHS"
	case 26:
		retentionDuration = "TWENTY_SIX_MONTHS"
	case 38:
		retentionDuration = "THIRTY_EIGHT_MONTHS"
	case 50:
		retentionDuration = "FIFTY_MONTHS"
	default:
		return fmt.Errorf("invalid retention duration: must be 2, 14, 26, 38, or 50 months")
	}

	// Update data retention settings
	settings := &admin.GoogleAnalyticsAdminV1alphaDataRetentionSettings{
		EventDataRetention:         retentionDuration,
		ResetUserDataOnNewActivity: resetOnNewActivity,
	}

	updateMask := "eventDataRetention,resetUserDataOnNewActivity"

	_, err := c.admin.Properties.UpdateDataRetentionSettings(settingsPath, settings).UpdateMask(updateMask).Context(c.ctx).Do()
	if err != nil {
		return fmt.Errorf("failed to update data retention: %w", err)
	}

	return nil
}

// GetDataRetention retrieves current data retention settings
func (c *Client) GetDataRetention(propertyID string) (*DataRetentionSettings, error) {
	settingsPath := fmt.Sprintf("properties/%s/dataRetentionSettings", propertyID)

	settings, err := c.admin.Properties.GetDataRetentionSettings(settingsPath).Context(c.ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to get data retention settings: %w", err)
	}

	return &DataRetentionSettings{
		EventDataRetention:         settings.EventDataRetention,
		ResetUserDataOnNewActivity: settings.ResetUserDataOnNewActivity,
	}, nil
}

// EnableUserDataRetention enables the "reset user data on new activity" feature
func (c *Client) EnableUserDataRetention(propertyID string) error {
	return c.SetDataRetention(propertyID, 14, true)
}

// DisableUserDataRetention disables the "reset user data on new activity" feature
func (c *Client) DisableUserDataRetention(propertyID string) error {
	settingsPath := fmt.Sprintf("properties/%s/dataRetentionSettings", propertyID)

	settings := &admin.GoogleAnalyticsAdminV1alphaDataRetentionSettings{
		ResetUserDataOnNewActivity: false,
	}

	updateMask := "resetUserDataOnNewActivity"

	_, err := c.admin.Properties.UpdateDataRetentionSettings(settingsPath, settings).UpdateMask(updateMask).Context(c.ctx).Do()
	if err != nil {
		return fmt.Errorf("failed to disable user data retention: %w", err)
	}

	return nil
}

// GetDataRetentionMonths converts retention string to months
func GetDataRetentionMonths(retentionStr string) int {
	switch retentionStr {
	case "TWO_MONTHS":
		return 2
	case "FOURTEEN_MONTHS":
		return 14
	case "TWENTY_SIX_MONTHS":
		return 26
	case "THIRTY_EIGHT_MONTHS":
		return 38
	case "FIFTY_MONTHS":
		return 50
	default:
		return 0
	}
}

// GetDataRetentionRecommendation provides recommendations for data retention settings
func GetDataRetentionRecommendation(propertyType string) (months int, resetOnNewActivity bool, reasoning string) {
	switch propertyType {
	case "ecommerce":
		return 50, true, "E-commerce sites benefit from long-term data for customer lifetime value analysis and seasonal trend comparison"
	case "saas":
		return 50, true, "SaaS products need extended retention for user behavior analysis, churn prediction, and feature adoption tracking"
	case "content":
		return 26, true, "Content sites should retain data for content performance analysis and reader behavior patterns"
	case "portfolio":
		return 14, true, "Portfolio sites typically need less historical data; 14 months is sufficient for year-over-year comparison"
	case "lead-gen":
		return 38, true, "Lead generation sites benefit from longer retention to track conversion funnels and attribution"
	default:
		return 14, true, "Default recommendation: 14 months with reset on new activity enabled"
	}
}

// ValidateDataRetentionSettings checks if retention settings are appropriate
func ValidateDataRetentionSettings(settings *DataRetentionSettings, expectedMonths int) []string {
	var warnings []string

	actualMonths := GetDataRetentionMonths(settings.EventDataRetention)

	if actualMonths < expectedMonths {
		warnings = append(warnings, fmt.Sprintf(
			"Data retention is set to %d months, but %d months is recommended for this property type",
			actualMonths, expectedMonths))
	}

	if !settings.ResetUserDataOnNewActivity {
		warnings = append(warnings,
			"Reset user data on new activity is disabled. Consider enabling to maintain more accurate user metrics")
	}

	return warnings
}

// DataRetentionReport generates a summary report of retention settings
func (c *Client) DataRetentionReport(propertyID string, propertyType string) (string, error) {
	settings, err := c.GetDataRetention(propertyID)
	if err != nil {
		return "", err
	}

	actualMonths := GetDataRetentionMonths(settings.EventDataRetention)
	recommendedMonths, recommendedReset, reasoning := GetDataRetentionRecommendation(propertyType)

	report := fmt.Sprintf(`Data Retention Report
===================

Property ID: %s
Property Type: %s

Current Settings:
- Event Data Retention: %d months (%s)
- Reset on New Activity: %t

Recommended Settings:
- Event Data Retention: %d months
- Reset on New Activity: %t
- Reasoning: %s

`, propertyID, propertyType, actualMonths, settings.EventDataRetention,
		settings.ResetUserDataOnNewActivity, recommendedMonths, recommendedReset, reasoning)

	warnings := ValidateDataRetentionSettings(settings, recommendedMonths)
	if len(warnings) > 0 {
		report += "Warnings:\n"
		for _, warning := range warnings {
			report += fmt.Sprintf("- %s\n", warning)
		}
	} else {
		report += "✓ Retention settings are optimal\n"
	}

	return report, nil
}
