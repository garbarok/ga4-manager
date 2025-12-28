package ga4

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/validation"
	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

func (c *Client) CreateConversion(propertyID, eventName, countingMethod string) error {
	// Validate inputs
	if err := validation.ValidatePropertyID(propertyID); err != nil {
		c.logger.Error("invalid property ID",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	if err := validation.ValidateEventName(eventName); err != nil {
		c.logger.Error("invalid event name",
			slog.String("event_name", eventName),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	if err := validation.ValidateCountingMethod(countingMethod); err != nil {
		c.logger.Error("invalid counting method",
			slog.String("counting_method", countingMethod),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	// Wait for rate limit
	if err := c.waitForRateLimit(c.ctx, "CreateConversion"); err != nil {
		return err
	}

	parent := fmt.Sprintf("properties/%s", propertyID)

	c.logger.Debug("creating conversion event",
		slog.String("property_id", propertyID),
		slog.String("event_name", eventName),
		slog.String("counting_method", countingMethod),
	)

	conversion := &admin.GoogleAnalyticsAdminV1alphaConversionEvent{
		EventName:      eventName,
		CountingMethod: countingMethod,
	}

	_, err := c.admin.Properties.ConversionEvents.Create(parent, conversion).Context(c.ctx).Do()
	if err != nil {
		if strings.Contains(err.Error(), "already exists") {
			c.logger.Debug("conversion already exists",
				slog.String("event_name", eventName),
			)
			return nil // Already exists, not an error
		}
		c.logger.Error("failed to create conversion",
			slog.String("event_name", eventName),
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("failed to create conversion '%s' for property %s: %w", eventName, propertyID, err)
	}

	c.logger.Info("conversion created successfully",
		slog.String("event_name", eventName),
		slog.String("property_id", propertyID),
	)

	return nil
}

func (c *Client) SetupConversions(project config.Project) error {
	for _, conv := range project.Conversions {
		if err := c.CreateConversion(project.PropertyID, conv.Name, conv.CountingMethod); err != nil {
			return err
		}
	}
	return nil
}

func (c *Client) ListConversions(propertyID string) ([]*admin.GoogleAnalyticsAdminV1alphaConversionEvent, error) {
	// Validate inputs
	if err := validation.ValidatePropertyID(propertyID); err != nil {
		c.logger.Error("invalid property ID",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Wait for rate limit
	if err := c.waitForRateLimit(c.ctx, "ListConversions"); err != nil {
		return nil, err
	}

	parent := fmt.Sprintf("properties/%s", propertyID)

	c.logger.Debug("listing conversions",
		slog.String("property_id", propertyID),
	)

	resp, err := c.admin.Properties.ConversionEvents.List(parent).Context(c.ctx).Do()
	if err != nil {
		c.logger.Error("failed to list conversions",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("failed to list conversions for property %s: %w", propertyID, err)
	}

	c.logger.Debug("conversions listed successfully",
		slog.String("property_id", propertyID),
		slog.Int("count", len(resp.ConversionEvents)),
	)

	return resp.ConversionEvents, nil
}

// findConversionByEventName searches for conversion by event name.
// Returns (event, nil) if found, (nil, nil) if not found, (nil, err) on API failure.
func (c *Client) findConversionByEventName(propertyID, eventName string) (*admin.GoogleAnalyticsAdminV1alphaConversionEvent, error) {
	conversions, err := c.ListConversions(propertyID)
	if err != nil {
		c.logger.Error("list failed",
			slog.String("property_id", propertyID),
			slog.String("event_name", eventName),
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("failed to list conversions: %w", err)
	}

	for _, conv := range conversions {
		if conv.EventName == eventName {
			return conv, nil
		}
	}

	return nil, nil
}

func (c *Client) DeleteConversion(propertyID, eventName string) error {
	// Validate inputs
	if err := validation.ValidatePropertyID(propertyID); err != nil {
		c.logger.Error("invalid property ID",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	if err := validation.ValidateEventName(eventName); err != nil {
		c.logger.Error("invalid event name",
			slog.String("event_name", eventName),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	c.logger.Debug("deleting conversion",
		slog.String("property_id", propertyID),
		slog.String("event_name", eventName),
	)

	conv, err := c.findConversionByEventName(propertyID, eventName)
	if err != nil {
		return fmt.Errorf("failed to find conversion '%s': %w", eventName, err)
	}
	if conv == nil {
		c.logger.Warn("conversion not found",
			slog.String("event_name", eventName),
			slog.String("property_id", propertyID),
		)
		return fmt.Errorf("conversion event '%s' not found in property %s", eventName, propertyID)
	}

	if err := c.waitForRateLimit(c.ctx, "DeleteConversion"); err != nil {
		return err
	}

	_, err = c.admin.Properties.ConversionEvents.Delete(conv.Name).Context(c.ctx).Do()
	if err != nil {
		c.logger.Error("failed to delete conversion",
			slog.String("event_name", eventName),
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("failed to delete conversion '%s' from property %s: %w", eventName, propertyID, err)
	}

	c.logger.Info("conversion deleted successfully",
		slog.String("event_name", eventName),
		slog.String("property_id", propertyID),
	)

	return nil
}
