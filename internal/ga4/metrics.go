package ga4

import (
	"fmt"
	"log/slog"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/validation"
	analyticsadmin "google.golang.org/api/analyticsadmin/v1alpha"
)

// CreateCustomMetric creates a custom metric in GA4
func (c *Client) CreateCustomMetric(propertyID string, metric config.MetricConfig) error {
	// Validate inputs
	if err := validation.ValidateMetricParams(propertyID, metric.ParameterName, metric.DisplayName, metric.MeasurementUnit, metric.Scope); err != nil {
		c.logger.Error("validation failed",
			slog.String("property_id", propertyID),
			slog.String("parameter_name", metric.ParameterName),
			slog.String("display_name", metric.DisplayName),
			slog.String("measurement_unit", metric.MeasurementUnit),
			slog.String("scope", metric.Scope),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	// Wait for rate limit
	if err := c.waitForRateLimit(c.ctx, "CreateCustomMetric"); err != nil {
		return err
	}

	c.logger.Debug("creating custom metric",
		slog.String("property_id", propertyID),
		slog.String("parameter_name", metric.ParameterName),
		slog.String("display_name", metric.DisplayName),
		slog.String("scope", metric.Scope),
	)

	property := fmt.Sprintf("properties/%s", propertyID)
	_, err := c.admin.Properties.CustomMetrics.Create(property, metricToSDK(metric)).Context(c.ctx).Do()
	if err != nil {
		if isAlreadyExistsError(err) {
			c.logger.Debug("custom metric already exists",
				slog.String("display_name", metric.DisplayName),
				slog.String("parameter_name", metric.ParameterName),
			)
			return nil // Already exists, not an error
		}
		c.logger.Error("failed to create custom metric",
			slog.String("display_name", metric.DisplayName),
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("failed to create custom metric '%s' for property %s: %w", metric.DisplayName, propertyID, err)
	}

	c.logger.Info("custom metric created successfully",
		slog.String("parameter_name", metric.ParameterName),
		slog.String("display_name", metric.DisplayName),
		slog.String("property_id", propertyID),
	)

	return nil
}

func metricToSDK(metric config.MetricConfig) *analyticsadmin.GoogleAnalyticsAdminV1alphaCustomMetric {
	// GA4 API rules (analyticsadmin v1alpha CustomMetric.restricted_metric_type):
	//   - REQUIRED for CURRENCY metrics (must be COST_DATA or REVENUE_DATA).
	//   - MUST BE EMPTY for non-CURRENCY metrics.
	// Default CURRENCY → REVENUE_DATA. Override via YAML `restricted_metric_type` if needed.
	m := &analyticsadmin.GoogleAnalyticsAdminV1alphaCustomMetric{
		DisplayName:     metric.DisplayName,
		Description:     metric.Description,
		MeasurementUnit: metric.MeasurementUnit,
		Scope:           metric.Scope,
		ParameterName:   metric.ParameterName,
	}
	if metric.MeasurementUnit == "CURRENCY" {
		rt := metric.RestrictedMetricType
		if rt == "" {
			rt = "REVENUE_DATA"
		}
		m.RestrictedMetricType = []string{rt}
	}
	return m
}

// ListCustomMetrics returns all custom metrics for a property
func (c *Client) ListCustomMetrics(propertyID string) ([]*analyticsadmin.GoogleAnalyticsAdminV1alphaCustomMetric, error) {
	// Validate inputs
	if err := validation.ValidatePropertyID(propertyID); err != nil {
		c.logger.Error("invalid property ID",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Wait for rate limit
	if err := c.waitForRateLimit(c.ctx, "ListCustomMetrics"); err != nil {
		return nil, err
	}

	c.logger.Debug("listing custom metrics",
		slog.String("property_id", propertyID),
	)

	property := fmt.Sprintf("properties/%s", propertyID)
	resp, err := c.admin.Properties.CustomMetrics.List(property).Context(c.ctx).Do()
	if err != nil {
		c.logger.Error("failed to list custom metrics",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("failed to list custom metrics for property %s: %w", propertyID, err)
	}

	c.logger.Debug("custom metrics listed successfully",
		slog.String("property_id", propertyID),
		slog.Int("count", len(resp.CustomMetrics)),
	)

	return resp.CustomMetrics, nil
}

// SetupCustomMetrics creates all custom metrics for a project
func (c *Client) SetupCustomMetrics(propertyID string, metrics []config.MetricConfig) error {
	for _, metric := range metrics {
		if err := c.CreateCustomMetric(propertyID, metric); err != nil {
			return fmt.Errorf("failed to setup metric %s: %w", metric.DisplayName, err)
		}
	}
	return nil
}

// UpdateCustomMetric updates an existing custom metric
func (c *Client) UpdateCustomMetric(metricName string, metric config.MetricConfig) error {
	// Wait for rate limit
	if err := c.waitForRateLimit(c.ctx, "UpdateCustomMetric"); err != nil {
		return err
	}

	c.logger.Debug("updating custom metric",
		slog.String("metric_name", metricName),
		slog.String("display_name", metric.DisplayName),
	)

	customMetric := &analyticsadmin.GoogleAnalyticsAdminV1alphaCustomMetric{
		DisplayName: metric.DisplayName,
		Description: metric.Description,
	}

	_, err := c.admin.Properties.CustomMetrics.Patch(metricName, customMetric).Context(c.ctx).Do()
	if err != nil {
		c.logger.Error("failed to update custom metric",
			slog.String("metric_name", metricName),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("failed to update custom metric '%s': %w", metricName, err)
	}

	c.logger.Info("custom metric updated successfully",
		slog.String("metric_name", metricName),
	)

	return nil
}

// ArchiveCustomMetric archives a custom metric (soft delete)
func (c *Client) ArchiveCustomMetric(metricName string) error {
	// Wait for rate limit
	if err := c.waitForRateLimit(c.ctx, "ArchiveCustomMetric"); err != nil {
		return err
	}

	c.logger.Debug("archiving custom metric",
		slog.String("metric_name", metricName),
	)

	_, err := c.admin.Properties.CustomMetrics.Archive(metricName, &analyticsadmin.GoogleAnalyticsAdminV1alphaArchiveCustomMetricRequest{}).Context(c.ctx).Do()
	if err != nil {
		c.logger.Error("failed to archive custom metric",
			slog.String("metric_name", metricName),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("failed to archive custom metric '%s': %w", metricName, err)
	}

	c.logger.Info("custom metric archived successfully",
		slog.String("metric_name", metricName),
	)

	return nil
}

// DeleteMetric deletes a custom metric by parameter name (finds and archives it)
func (c *Client) DeleteMetric(propertyID, parameterName string) error {
	// Validate inputs
	if err := validation.ValidatePropertyID(propertyID); err != nil {
		c.logger.Error("invalid property ID",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	if err := validation.ValidateParameterName(parameterName); err != nil {
		c.logger.Error("invalid parameter name",
			slog.String("parameter_name", parameterName),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	c.logger.Debug("deleting custom metric",
		slog.String("property_id", propertyID),
		slog.String("parameter_name", parameterName),
	)

	// List all metrics to find the one with matching parameter name
	property := fmt.Sprintf("properties/%s", propertyID)

	// Wait for rate limit
	if err := c.waitForRateLimit(c.ctx, "DeleteMetric-List"); err != nil {
		return err
	}

	resp, err := c.admin.Properties.CustomMetrics.List(property).Context(c.ctx).Do()
	if err != nil {
		c.logger.Error("failed to list custom metrics",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("failed to list custom metrics for property %s: %w", propertyID, err)
	}

	// Find metric with matching parameter name
	for _, metric := range resp.CustomMetrics {
		if metric.ParameterName == parameterName {
			// Archive the metric
			return c.ArchiveCustomMetric(metric.Name)
		}
	}

	c.logger.Warn("custom metric not found",
		slog.String("parameter_name", parameterName),
		slog.String("property_id", propertyID),
	)

	return fmt.Errorf("custom metric with parameter '%s' not found in property %s", parameterName, propertyID)
}
