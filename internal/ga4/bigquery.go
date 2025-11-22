package ga4

import (
	"fmt"

	"google.golang.org/api/analyticsadmin/v1alpha"
)

// BigQueryConfig represents BigQuery export configuration
type BigQueryConfig struct {
	PropertyID           string
	ProjectID            string
	DatasetID            string
	DailyExport          bool
	StreamingExport      bool
	FreshDailyTables     bool
	IncludeAdvertisingID bool
	ExportStreamsFilter  []string
}

// CreateBigQueryLink enables BigQuery export for a property
// Note: The GA4 Admin API does not support creating BigQuery links programmatically.
// This function returns an error directing users to create links manually via the GA4 UI.
func (c *Client) CreateBigQueryLink(config BigQueryConfig) (*analyticsadmin.GoogleAnalyticsAdminV1alphaBigQueryLink, error) {
	return nil, fmt.Errorf("BigQuery links cannot be created via the API. Please create them manually in the GA4 UI at https://analytics.google.com/analytics/web/#/a{account-id}/p%s/admin/bigquery-links", config.PropertyID)
}

// ListBigQueryLinks lists all BigQuery links for a property
func (c *Client) ListBigQueryLinks(propertyID string) ([]*analyticsadmin.GoogleAnalyticsAdminV1alphaBigQueryLink, error) {
	propertyPath := fmt.Sprintf("properties/%s", propertyID)

	resp, err := c.admin.Properties.BigQueryLinks.List(propertyPath).Context(c.ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to list BigQuery links: %w", err)
	}

	return resp.BigqueryLinks, nil
}

// GetBigQueryLink retrieves a specific BigQuery link
func (c *Client) GetBigQueryLink(linkName string) (*analyticsadmin.GoogleAnalyticsAdminV1alphaBigQueryLink, error) {
	link, err := c.admin.Properties.BigQueryLinks.Get(linkName).Context(c.ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to get BigQuery link: %w", err)
	}

	return link, nil
}

// GetBigQueryExportStatus returns the status of BigQuery export for a property
func (c *Client) GetBigQueryExportStatus(propertyID string) (map[string]interface{}, error) {
	links, err := c.ListBigQueryLinks(propertyID)
	if err != nil {
		return nil, err
	}

	status := map[string]interface{}{
		"enabled":    len(links) > 0,
		"link_count": len(links),
		"links":      make([]map[string]interface{}, 0),
	}

	for _, link := range links {
		linkInfo := map[string]interface{}{
			"name":                   link.Name,
			"project":                link.Project,
			"daily_export":           link.DailyExportEnabled,
			"streaming_export":       link.StreamingExportEnabled,
			"fresh_daily_tables":     link.FreshDailyExportEnabled,
			"include_advertising_id": link.IncludeAdvertisingId,
		}
		status["links"] = append(status["links"].([]map[string]interface{}), linkInfo)
	}

	return status, nil
}

// BigQueryLinkExists checks if a BigQuery link exists for the property
func (c *Client) BigQueryLinkExists(propertyID string) (bool, error) {
	links, err := c.ListBigQueryLinks(propertyID)
	if err != nil {
		return false, err
	}

	return len(links) > 0, nil
}

// GetDefaultBigQueryConfig returns a default BigQuery configuration
// This is useful for documentation and manual setup guidance
func GetDefaultBigQueryConfig(propertyID, projectID, datasetID string) BigQueryConfig {
	return BigQueryConfig{
		PropertyID:           propertyID,
		ProjectID:            projectID,
		DatasetID:            datasetID,
		DailyExport:          true,
		StreamingExport:      false,
		FreshDailyTables:     true,
		IncludeAdvertisingID: false,
		ExportStreamsFilter:  []string{},
	}
}

// DeleteBigQueryLink deletes a BigQuery link.
// Note: The GA4 Admin API does not support deleting BigQuery links programmatically.
// This function returns an error directing users to delete links manually via the GA4 UI.
func (c *Client) DeleteBigQueryLink(linkName string) error {
	return fmt.Errorf("BigQuery links cannot be deleted via the API. Please delete them manually in the GA4 UI")
}

// GenerateBigQuerySetupGuide generates instructions for manual BigQuery setup
func (c *Client) GenerateBigQuerySetupGuide(config BigQueryConfig) string {

	guide := fmt.Sprintf(`
BigQuery Export Setup Guide
============================

Property ID: %s
GCP Project: %s
Dataset ID: %s

Manual Setup Steps:
-------------------

1. Go to GA4 Admin Panel
   https://analytics.google.com/analytics/web/#/a{account-id}/p%s/admin/bigquery-links

2. Click "Link" button

3. Configure BigQuery Link:
   • Select GCP Project: %s
   • Choose/Create Dataset: %s
   • Enable Daily Export: %v
   • Enable Streaming Export: %v
   • Fresh Daily Tables: %v
   • Include Advertising ID: %v

4. Click "Next" and review settings

5. Click "Submit" to create the link

Benefits:
---------
• Access to raw, unsampled GA4 data
• Custom SQL queries for advanced analysis
• Integration with BigQuery ML for predictive analytics
• Long-term data retention beyond GA4 limits
• Data warehouse integration capabilities

Next Steps:
-----------
After linking, you can query your data with SQL in BigQuery:
https://console.cloud.google.com/bigquery?project=%s

`, config.PropertyID, config.ProjectID, config.DatasetID, config.PropertyID,
		config.ProjectID, config.DatasetID, config.DailyExport, config.StreamingExport,
		config.FreshDailyTables, config.IncludeAdvertisingID, config.ProjectID)

	return guide
}
