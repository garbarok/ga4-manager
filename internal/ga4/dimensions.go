package ga4

import (
	"fmt"
	"strings"

	admin "google.golang.org/api/analyticsadmin/v1alpha"
	"github.com/oscargallego/ga4-manager/internal/config"
)

func (c *Client) CreateDimension(propertyID string, dim config.CustomDimension) error {
	parent := fmt.Sprintf("properties/%s", propertyID)
	
	dimension := &admin.GoogleAnalyticsAdminV1alphaCustomDimension{
		ParameterName: dim.ParameterName,
		DisplayName:   dim.DisplayName,
		Description:   dim.Description,
		Scope:         dim.Scope,
	}

	_, err := c.admin.Properties.CustomDimensions.Create(parent, dimension).Context(c.ctx).Do()
	if err != nil {
		if strings.Contains(err.Error(), "already exists") {
			return nil
		}
		return fmt.Errorf("failed to create dimension %s: %w", dim.DisplayName, err)
	}

	return nil
}

func (c *Client) SetupDimensions(project config.Project) error {
	for _, dim := range project.Dimensions {
		if err := c.CreateDimension(project.PropertyID, dim); err != nil {
			return err
		}
	}
	return nil
}

func (c *Client) ListDimensions(propertyID string) ([]*admin.GoogleAnalyticsAdminV1alphaCustomDimension, error) {
	parent := fmt.Sprintf("properties/%s", propertyID)
	
	resp, err := c.admin.Properties.CustomDimensions.List(parent).Context(c.ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to list dimensions: %w", err)
	}

	return resp.CustomDimensions, nil
}
