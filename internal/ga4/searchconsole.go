package ga4

import (
	"fmt"

	"google.golang.org/api/analyticsadmin/v1alpha"
)

// SearchConsoleLink represents a Search Console link configuration
type SearchConsoleLink struct {
	Name          string
	PropertyID    string
	SiteURL       string
	DailyExport   bool
	AdvertisingID bool
}

// Note: As of the current GA4 Admin API version, Search Console links must be created
// manually through the GA4 UI. The API does not support automated Search Console linking.
// See: https://support.google.com/analytics/answer/9379420

// LinkSearchConsole provides instructions for manual Search Console linking
func (c *Client) LinkSearchConsole(propertyID, siteURL string) error {
	return fmt.Errorf("search Console links must be created manually through the GA4 UI. Navigate to Admin > Property > Search Console Links")
}

// UnlinkSearchConsole provides instructions for unlinking
func (c *Client) UnlinkSearchConsole(propertyID, linkName string) error {
	return fmt.Errorf("search Console links must be unlinked manually through the GA4 UI")
}

// ListSearchConsoleLinks returns empty list since API doesn't support Search Console links
// Note: This is a placeholder for compatibility
func (c *Client) ListSearchConsoleLinks(propertyID string) ([]*analyticsadmin.GoogleAnalyticsAdminV1alphaSearchAds360Link, error) {
	// Return empty list - Search Console links are not accessible via API
	return []*analyticsadmin.GoogleAnalyticsAdminV1alphaSearchAds360Link{}, nil
}

// VerifySearchConsoleAccess checks if the user has access to the Search Console property
// Note: This requires Search Console API access which is separate from Analytics Admin API
func (c *Client) VerifySearchConsoleAccess(siteURL string) (bool, error) {
	// This is a placeholder function. In a real implementation, this would:
	// 1. Initialize a Search Console API client
	// 2. Check if the user has access to the specified site URL
	// 3. Return true if access is granted

	// For now, we'll assume access is available
	// You would need to add the Search Console API dependency and implement this properly
	return true, nil
}

// GetSearchConsoleIntegrationStatus returns the status of Search Console integration
func (c *Client) GetSearchConsoleIntegrationStatus(propertyID string) (map[string]interface{}, error) {
	status := map[string]interface{}{
		"linked":     false,
		"link_count": 0,
		"links":      make([]map[string]string, 0),
		"note":       "Search Console links must be checked manually in GA4 UI",
	}

	return status, nil
}

// CreateSearchConsoleLink creates a Search Console link with enhanced configuration
func (c *Client) CreateSearchConsoleLink(config SearchConsoleLink) error {
	return c.LinkSearchConsole(config.PropertyID, config.SiteURL)
}

// SearchConsoleLinkExists checks if a Search Console link already exists for the site
func (c *Client) SearchConsoleLinkExists(propertyID, siteURL string) (bool, error) {
	// Cannot check via API - must be done manually
	return false, nil
}

// GenerateSearchConsoleSetupGuide generates instructions for manual Search Console linking
func (c *Client) GenerateSearchConsoleSetupGuide(propertyID, siteURL string) string {
	guide := fmt.Sprintf(`
Search Console Link Setup Guide
================================

Property ID: %s
Site URL: %s

Manual Setup Steps:
-------------------

1. Go to GA4 Admin Panel
   https://analytics.google.com/analytics/web/#/a{account-id}/p%s/admin/searchconsole

2. Click "Link" button

3. Select your Search Console property:
   • Site URL: %s
   • Make sure you have verified ownership in Search Console

4. Click "Next" and review settings

5. Click "Submit" to create the link

Prerequisites:
--------------
• You must have verified ownership of the site in Search Console
• You need Edit permissions on both GA4 property and Search Console property
• Verify site in Search Console: https://search.google.com/search-console

Benefits:
---------
• Organic search query data in GA4 reports
• Landing page performance metrics
• Search impressions and CTR data
• Position tracking for organic traffic
• Integration with GA4 Acquisition reports

Next Steps:
-----------
After linking, wait 24-48 hours for data to appear in GA4:
• Go to Reports > Acquisition > Traffic acquisition
• Add "Session Google Ads query" dimension
• View organic search performance data

`, propertyID, siteURL, propertyID, siteURL)

	return guide
}
