package ga4

import (
	"context"
	"fmt"

	"google.golang.org/api/analyticsadmin/v1alpha"
	"github.com/oscargallego/ga4-manager/internal/config"
)

// CreateCustomMetric creates a custom metric in GA4
func (c *Client) CreateCustomMetric(propertyID string, metric config.CustomMetric) error {
	ctx := context.Background()

	// Create the custom metric request
	customMetric := &analyticsadmin.GoogleAnalyticsAdminV1alphaCustomMetric{
		DisplayName:      metric.DisplayName,
		Description:      metric.Description,
		MeasurementUnit:  metric.MeasurementUnit,
		Scope:            metric.Scope,
		ParameterName:    metric.EventParameter,
		RestrictedMetricType: []string{}, // Empty for non-restricted metrics
	}

	property := fmt.Sprintf("properties/%s", propertyID)
	_, err := c.admin.Properties.CustomMetrics.Create(property, customMetric).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("failed to create custom metric: %w", err)
	}

	return nil
}

// ListCustomMetrics returns all custom metrics for a property
func (c *Client) ListCustomMetrics(propertyID string) ([]*analyticsadmin.GoogleAnalyticsAdminV1alphaCustomMetric, error) {
	ctx := context.Background()

	property := fmt.Sprintf("properties/%s", propertyID)
	resp, err := c.admin.Properties.CustomMetrics.List(property).Context(ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to list custom metrics: %w", err)
	}

	return resp.CustomMetrics, nil
}

// SetupCustomMetrics creates all custom metrics for a project
func (c *Client) SetupCustomMetrics(project config.Project) error {
	for _, metric := range project.Metrics {
		if err := c.CreateCustomMetric(project.PropertyID, metric); err != nil {
			return fmt.Errorf("failed to setup metric %s: %w", metric.DisplayName, err)
		}
	}
	return nil
}

// UpdateCustomMetric updates an existing custom metric
func (c *Client) UpdateCustomMetric(metricName string, metric config.CustomMetric) error {
	ctx := context.Background()

	customMetric := &analyticsadmin.GoogleAnalyticsAdminV1alphaCustomMetric{
		DisplayName: metric.DisplayName,
		Description: metric.Description,
	}

	_, err := c.admin.Properties.CustomMetrics.Patch(metricName, customMetric).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("failed to update custom metric: %w", err)
	}

	return nil
}

// ArchiveCustomMetric archives a custom metric (soft delete)
func (c *Client) ArchiveCustomMetric(metricName string) error {
	ctx := context.Background()

	_, err := c.admin.Properties.CustomMetrics.Archive(metricName, &analyticsadmin.GoogleAnalyticsAdminV1alphaArchiveCustomMetricRequest{}).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("failed to archive custom metric: %w", err)
	}

	return nil
}
