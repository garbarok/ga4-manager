package ga4

import (
	"errors"
	"fmt"
	"log/slog"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/validation"
	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

func (c *Client) CreateConversion(propertyID, eventName, countingMethod string) error {
	if err := validation.ValidateConversionParams(propertyID, eventName, countingMethod); err != nil {
		c.logger.Error("validation failed",
			slog.String("property_id", propertyID),
			slog.String("event_name", eventName),
			slog.String("counting_method", countingMethod),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	c.logger.Debug("creating conversion event",
		slog.String("property_id", propertyID),
		slog.String("event_name", eventName),
		slog.String("counting_method", countingMethod),
	)

	return c.createResource("conversion", propertyID, eventName, func(parent string) error {
		conversion := &admin.GoogleAnalyticsAdminV1alphaConversionEvent{
			EventName:      eventName,
			CountingMethod: countingMethod,
		}
		return c.admin.createConversionEvent(c.ctx, parent, conversion)
	})
}

func conversionToSDK(conv config.ConversionConfig) *admin.GoogleAnalyticsAdminV1alphaConversionEvent {
	return &admin.GoogleAnalyticsAdminV1alphaConversionEvent{
		EventName:      conv.Name,
		CountingMethod: conv.CountingMethod,
	}
}

func (c *Client) SetupConversions(propertyID string, conversions []config.ConversionConfig) error {
	for _, conv := range conversions {
		if err := c.CreateConversion(propertyID, conv.Name, conv.CountingMethod); err != nil && !errors.Is(err, ErrAlreadyExists) {
			return err
		}
	}
	return nil
}

func (c *Client) ListConversions(propertyID string) ([]*admin.GoogleAnalyticsAdminV1alphaConversionEvent, error) {
	return listResource(c, "conversion", propertyID, func(parent string) ([]*admin.GoogleAnalyticsAdminV1alphaConversionEvent, error) {
		return c.admin.listConversionEvents(c.ctx, parent)
	})
}

// findConversionByEventName searches for conversion by event name.
// Returns (event, nil) if found, (nil, nil) if not found, (nil, err) on API failure.
func (c *Client) findConversionByEventName(propertyID, eventName string) (*admin.GoogleAnalyticsAdminV1alphaConversionEvent, error) {
	conversions, err := c.ListConversions(propertyID)
	if err != nil {
		return nil, fmt.Errorf("failed to list conversions: %w", err)
	}

	conv, _ := firstMatch(conversions, func(e *admin.GoogleAnalyticsAdminV1alphaConversionEvent) string {
		return e.EventName
	}, eventName)
	return conv, nil
}

func (c *Client) DeleteConversion(propertyID, eventName string) error {
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

	if err := c.admin.deleteConversionEvent(c.ctx, conv.Name); err != nil {
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
