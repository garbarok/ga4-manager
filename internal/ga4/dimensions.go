package ga4

import (
	"fmt"
	"log/slog"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/validation"
	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

func (c *Client) CreateDimension(propertyID string, dim config.DimensionConfig) error {
	if err := validation.ValidateDimensionParams(propertyID, dim.ParameterName, dim.DisplayName, dim.Scope); err != nil {
		c.logger.Error("validation failed",
			slog.String("property_id", propertyID),
			slog.String("parameter_name", dim.ParameterName),
			slog.String("display_name", dim.DisplayName),
			slog.String("scope", dim.Scope),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	c.logger.Debug("creating custom dimension",
		slog.String("property_id", propertyID),
		slog.String("parameter_name", dim.ParameterName),
		slog.String("display_name", dim.DisplayName),
		slog.String("scope", dim.Scope),
	)

	return c.createResource("dimension", propertyID, dim.DisplayName, func(parent string) error {
		return c.admin.createCustomDimension(c.ctx, parent, dimToSDK(dim))
	})
}

func dimToSDK(dim config.DimensionConfig) *admin.GoogleAnalyticsAdminV1alphaCustomDimension {
	return &admin.GoogleAnalyticsAdminV1alphaCustomDimension{
		ParameterName: dim.ParameterName,
		DisplayName:   dim.DisplayName,
		Description:   dim.Description,
		Scope:         dim.Scope,
	}
}

func (c *Client) SetupDimensions(propertyID string, dims []config.DimensionConfig) error {
	for _, dim := range dims {
		if err := c.CreateDimension(propertyID, dim); err != nil {
			return err
		}
	}
	return nil
}

func (c *Client) ListDimensions(propertyID string) ([]*admin.GoogleAnalyticsAdminV1alphaCustomDimension, error) {
	return listResource(c, "dimension", propertyID, func(parent string) ([]*admin.GoogleAnalyticsAdminV1alphaCustomDimension, error) {
		return c.admin.listCustomDimensions(c.ctx, parent)
	})
}

// findDimensionByParameterName searches for dimension by parameter name.
// Returns (dimension, nil) if found, (nil, nil) if not found, (nil, err) on API failure.
func (c *Client) findDimensionByParameterName(propertyID, parameterName string) (*admin.GoogleAnalyticsAdminV1alphaCustomDimension, error) {
	dimensions, err := c.ListDimensions(propertyID)
	if err != nil {
		return nil, fmt.Errorf("failed to list dimensions: %w", err)
	}

	dim, _ := firstMatch(dimensions, func(d *admin.GoogleAnalyticsAdminV1alphaCustomDimension) string {
		return d.ParameterName
	}, parameterName)
	return dim, nil
}

func (c *Client) DeleteDimension(propertyID, parameterName string) error {
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

	c.logger.Debug("deleting dimension",
		slog.String("property_id", propertyID),
		slog.String("parameter_name", parameterName),
	)

	dim, err := c.findDimensionByParameterName(propertyID, parameterName)
	if err != nil {
		return fmt.Errorf("failed to find dimension '%s': %w", parameterName, err)
	}
	if dim == nil {
		c.logger.Warn("dimension not found",
			slog.String("parameter_name", parameterName),
			slog.String("property_id", propertyID),
		)
		return fmt.Errorf("dimension '%s' not found in property %s", parameterName, propertyID)
	}

	if err := c.waitForRateLimit(c.ctx, "DeleteDimension"); err != nil {
		return err
	}

	if err := c.admin.archiveCustomDimension(c.ctx, dim.Name); err != nil {
		c.logger.Error("failed to archive dimension",
			slog.String("parameter_name", parameterName),
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("failed to archive dimension '%s' from property %s: %w", parameterName, propertyID, err)
	}

	c.logger.Info("dimension archived successfully",
		slog.String("parameter_name", parameterName),
		slog.String("property_id", propertyID),
	)

	return nil
}
