package ga4

import (
	"fmt"
	"strings"

	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

// DataStream represents a GA4 data stream
type DataStream struct {
	Name          string
	Type          string // WEB_DATA_STREAM, ANDROID_APP_DATA_STREAM, IOS_APP_DATA_STREAM
	DisplayName   string
	MeasurementID string
	CreateTime    string
}

// EnhancedMeasurement represents enhanced measurement settings
type EnhancedMeasurement struct {
	StreamName                 string
	PageViews                  bool
	Scrolls                    bool
	OutboundClicks             bool
	SiteSearch                 bool
	VideoEngagement            bool
	FileDownloads              bool
	PageChanges                bool // For single-page applications
	FormInteractions           bool
	SearchQueryParameter       string
	UriQueryParameter          string
	FileDownloadsQualification string
}

// ListDataStreams retrieves all data streams for a property
func (c *Client) ListDataStreams(propertyID string) ([]*admin.GoogleAnalyticsAdminV1alphaDataStream, error) {
	parent := fmt.Sprintf("properties/%s", propertyID)

	streams, err := c.admin.listDataStreams(c.ctx, parent)
	if err != nil {
		return nil, fmt.Errorf("failed to list data streams: %w", err)
	}

	return streams, nil
}

// GetDataStream retrieves a specific data stream
func (c *Client) GetDataStream(streamName string) (*admin.GoogleAnalyticsAdminV1alphaDataStream, error) {
	stream, err := c.admin.getDataStream(c.ctx, streamName)
	if err != nil {
		return nil, fmt.Errorf("failed to get data stream: %w", err)
	}

	return stream, nil
}

// GetWebDataStreamByProperty gets the first web data stream for a property
func (c *Client) GetWebDataStreamByProperty(propertyID string) (*admin.GoogleAnalyticsAdminV1alphaDataStream, error) {
	streams, err := c.ListDataStreams(propertyID)
	if err != nil {
		return nil, err
	}

	for _, stream := range streams {
		if stream.Type == "WEB_DATA_STREAM" {
			return stream, nil
		}
	}

	return nil, fmt.Errorf("no web data stream found for property %s", propertyID)
}

// GetEnhancedMeasurementSettings retrieves enhanced measurement settings for a data stream
func (c *Client) GetEnhancedMeasurementSettings(streamName string) (*admin.GoogleAnalyticsAdminV1alphaEnhancedMeasurementSettings, error) {
	settings, err := c.admin.getEnhancedMeasurementSettings(c.ctx, fmt.Sprintf("%s/enhancedMeasurementSettings", streamName))
	if err != nil {
		return nil, fmt.Errorf("failed to get enhanced measurement settings: %w", err)
	}

	return settings, nil
}

// UpdateEnhancedMeasurement updates enhanced measurement settings for a data stream
func (c *Client) UpdateEnhancedMeasurement(streamName string, settings *admin.GoogleAnalyticsAdminV1alphaEnhancedMeasurementSettings) error {
	settingsPath := fmt.Sprintf("%s/enhancedMeasurementSettings", streamName)

	updateMask := "scrollsEnabled,outboundClicksEnabled,siteSearchEnabled,videoEngagementEnabled,fileDownloadsEnabled,pageChangesEnabled,formInteractionsEnabled,searchQueryParameter,uriQueryParameter"

	if err := c.admin.updateEnhancedMeasurementSettings(c.ctx, settingsPath, settings, updateMask); err != nil {
		return fmt.Errorf("failed to update enhanced measurement: %w", err)
	}

	return nil
}

// EnableAllEnhancedMeasurement enables all enhanced measurement features
func (c *Client) EnableAllEnhancedMeasurement(propertyID string) error {
	stream, err := c.GetWebDataStreamByProperty(propertyID)
	if err != nil {
		return err
	}

	settings := &admin.GoogleAnalyticsAdminV1alphaEnhancedMeasurementSettings{
		ScrollsEnabled:          true,
		OutboundClicksEnabled:   true,
		SiteSearchEnabled:       true,
		VideoEngagementEnabled:  true,
		FileDownloadsEnabled:    true,
		PageChangesEnabled:      true,
		FormInteractionsEnabled: true,
		SearchQueryParameter:    "q,s,search,query,keyword",
		UriQueryParameter:       "",
	}

	return c.UpdateEnhancedMeasurement(stream.Name, settings)
}

// ConfigureEnhancedMeasurementForSEO configures enhanced measurement optimized for SEO tracking
func (c *Client) ConfigureEnhancedMeasurementForSEO(propertyID string) error {
	stream, err := c.GetWebDataStreamByProperty(propertyID)
	if err != nil {
		return err
	}

	settings := &admin.GoogleAnalyticsAdminV1alphaEnhancedMeasurementSettings{
		ScrollsEnabled:          true,  // Track scroll depth for engagement
		OutboundClicksEnabled:   true,  // Track external links (important for SEO)
		SiteSearchEnabled:       true,  // Track internal searches
		VideoEngagementEnabled:  false, // Disable if not using videos
		FileDownloadsEnabled:    true,  // Track downloads
		PageChangesEnabled:      true,  // For SPAs
		FormInteractionsEnabled: true,  // Track form engagement
		SearchQueryParameter:    "q,s,search,query,keyword",
		UriQueryParameter:       "",
	}

	return c.UpdateEnhancedMeasurement(stream.Name, settings)
}

// GetDataStreamSummary provides a summary of all data streams for a property
func (c *Client) GetDataStreamSummary(propertyID string) (string, error) {
	streams, err := c.ListDataStreams(propertyID)
	if err != nil {
		return "", err
	}

	var summary strings.Builder
	fmt.Fprintf(&summary, "Data Streams for Property %s\n", propertyID)
	summary.WriteString(strings.Repeat("=", 50) + "\n\n")

	if len(streams) == 0 {
		summary.WriteString("No data streams found.\n")
		return summary.String(), nil
	}

	for i, stream := range streams {
		fmt.Fprintf(&summary, "Stream %d:\n", i+1)
		fmt.Fprintf(&summary, "  Name: %s\n", stream.DisplayName)
		fmt.Fprintf(&summary, "  Type: %s\n", stream.Type)

		if stream.WebStreamData != nil {
			fmt.Fprintf(&summary, "  Measurement ID: %s\n", stream.WebStreamData.MeasurementId)
			fmt.Fprintf(&summary, "  Default URI: %s\n", stream.WebStreamData.DefaultUri)
		}

		if stream.AndroidAppStreamData != nil {
			fmt.Fprintf(&summary, "  Package Name: %s\n", stream.AndroidAppStreamData.PackageName)
		}

		if stream.IosAppStreamData != nil {
			fmt.Fprintf(&summary, "  Bundle ID: %s\n", stream.IosAppStreamData.BundleId)
		}

		fmt.Fprintf(&summary, "  Created: %s\n", stream.CreateTime)
		summary.WriteString("\n")
	}

	return summary.String(), nil
}

// GetEnhancedMeasurementSummary provides a summary of enhanced measurement settings
func (c *Client) GetEnhancedMeasurementSummary(propertyID string) (string, error) {
	stream, err := c.GetWebDataStreamByProperty(propertyID)
	if err != nil {
		return "", err
	}

	settings, err := c.GetEnhancedMeasurementSettings(stream.Name)
	if err != nil {
		return "", err
	}

	var summary strings.Builder
	summary.WriteString("Enhanced Measurement Settings\n")
	summary.WriteString(strings.Repeat("=", 50) + "\n\n")

	fmt.Fprintf(&summary, "Stream: %s\n", stream.DisplayName)
	fmt.Fprintf(&summary, "Measurement ID: %s\n\n", stream.WebStreamData.MeasurementId)

	summary.WriteString("Features:\n")
	summary.WriteString("  ✓ Page Views: Always enabled\n")
	fmt.Fprintf(&summary, "  %s Scrolls: %t\n", boolToCheckmark(settings.ScrollsEnabled), settings.ScrollsEnabled)
	fmt.Fprintf(&summary, "  %s Outbound Clicks: %t\n", boolToCheckmark(settings.OutboundClicksEnabled), settings.OutboundClicksEnabled)
	fmt.Fprintf(&summary, "  %s Site Search: %t\n", boolToCheckmark(settings.SiteSearchEnabled), settings.SiteSearchEnabled)
	fmt.Fprintf(&summary, "  %s Video Engagement: %t\n", boolToCheckmark(settings.VideoEngagementEnabled), settings.VideoEngagementEnabled)
	fmt.Fprintf(&summary, "  %s File Downloads: %t\n", boolToCheckmark(settings.FileDownloadsEnabled), settings.FileDownloadsEnabled)
	fmt.Fprintf(&summary, "  %s Page Changes (SPA): %t\n", boolToCheckmark(settings.PageChangesEnabled), settings.PageChangesEnabled)
	fmt.Fprintf(&summary, "  %s Form Interactions: %t\n", boolToCheckmark(settings.FormInteractionsEnabled), settings.FormInteractionsEnabled)

	if settings.SearchQueryParameter != "" {
		fmt.Fprintf(&summary, "\nSearch Parameters: %s\n", settings.SearchQueryParameter)
	}

	return summary.String(), nil
}

func boolToCheckmark(b bool) string {
	if b {
		return "✓"
	}
	return "✗"
}

// ValidateEnhancedMeasurement checks if enhanced measurement is properly configured
func (c *Client) ValidateEnhancedMeasurement(propertyID string, propertyType string) ([]string, error) {
	stream, err := c.GetWebDataStreamByProperty(propertyID)
	if err != nil {
		return nil, err
	}

	settings, err := c.GetEnhancedMeasurementSettings(stream.Name)
	if err != nil {
		return nil, err
	}

	var warnings []string

	// Common recommendations
	if !settings.ScrollsEnabled {
		warnings = append(warnings, "Consider enabling Scroll tracking for engagement metrics")
	}

	if !settings.OutboundClicksEnabled {
		warnings = append(warnings, "Consider enabling Outbound Clicks tracking for referral analysis")
	}

	// Property-type specific recommendations
	switch propertyType {
	case "content", "blog", "portfolio":
		if !settings.SiteSearchEnabled {
			warnings = append(warnings, "Enable Site Search tracking for content discovery insights")
		}
		if !settings.VideoEngagementEnabled {
			warnings = append(warnings, "Consider enabling Video Engagement if you have video content")
		}

	case "ecommerce", "saas":
		if !settings.FileDownloadsEnabled {
			warnings = append(warnings, "Enable File Downloads tracking for resource engagement")
		}
		if !settings.FormInteractionsEnabled {
			warnings = append(warnings, "Enable Form Interactions for conversion funnel analysis")
		}

	case "spa":
		if !settings.PageChangesEnabled {
			warnings = append(warnings, "IMPORTANT: Enable Page Changes for single-page application tracking")
		}
	}

	if settings.SiteSearchEnabled && settings.SearchQueryParameter == "" {
		warnings = append(warnings, "Site Search is enabled but no query parameters are configured")
	}

	return warnings, nil
}

// GetDataStreamRecommendations provides setup recommendations
func GetDataStreamRecommendations(propertyType string) []string {
	recommendations := []string{
		"Enable Enhanced Measurement for automatic event tracking",
		"Configure search query parameters if you have site search",
	}

	switch propertyType {
	case "ecommerce":
		recommendations = append(recommendations,
			"Enable File Downloads to track product catalogs and spec sheets",
			"Enable Form Interactions to track checkout and contact forms",
			"Configure outbound clicks to track affiliate links")

	case "saas":
		recommendations = append(recommendations,
			"Enable all enhanced measurement features for comprehensive tracking",
			"Enable Page Changes if using a single-page application",
			"Track video engagement for tutorial and demo content")

	case "content", "blog":
		recommendations = append(recommendations,
			"Enable Scroll tracking to measure content engagement",
			"Enable Site Search for content discovery insights",
			"Enable Video Engagement if you have embedded videos",
			"Track outbound clicks for external resource links")

	case "portfolio":
		recommendations = append(recommendations,
			"Enable File Downloads for resume/portfolio downloads",
			"Enable Form Interactions for contact forms",
			"Enable outbound clicks for GitHub/social links")
	}

	return recommendations
}
