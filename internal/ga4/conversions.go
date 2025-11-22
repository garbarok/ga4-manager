package ga4

import (
	"fmt"
	"strings"

	admin "google.golang.org/api/analyticsadmin/v1alpha"
	"github.com/oscargallego/ga4-manager/internal/config"
)

func (c *Client) CreateConversion(propertyID, eventName, countingMethod string) error {
	parent := fmt.Sprintf("properties/%s", propertyID)
	
	conversion := &admin.GoogleAnalyticsAdminV1alphaConversionEvent{
		EventName:      eventName,
		CountingMethod: countingMethod,
	}

	_, err := c.admin.Properties.ConversionEvents.Create(parent, conversion).Context(c.ctx).Do()
	if err != nil {
		if strings.Contains(err.Error(), "already exists") {
			return nil // Already exists, not an error
		}
		return fmt.Errorf("failed to create conversion %s: %w", eventName, err)
	}

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
	parent := fmt.Sprintf("properties/%s", propertyID)
	
	resp, err := c.admin.Properties.ConversionEvents.List(parent).Context(c.ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to list conversions: %w", err)
	}

	return resp.ConversionEvents, nil
}
