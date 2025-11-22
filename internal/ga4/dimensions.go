package ga4

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/validation"
	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

func (c *Client) CreateDimension(propertyID string, dim config.CustomDimension) error {
	// Validate inputs
	if err := validation.ValidatePropertyID(propertyID); err != nil {
		c.logger.Error("invalid property ID",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	if err := validation.ValidateParameterName(dim.ParameterName); err != nil {
		c.logger.Error("invalid parameter name",
			slog.String("parameter_name", dim.ParameterName),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	if err := validation.ValidateDisplayName(dim.DisplayName); err != nil {
		c.logger.Error("invalid display name",
			slog.String("display_name", dim.DisplayName),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	if err := validation.ValidateScope(dim.Scope); err != nil {
		c.logger.Error("invalid scope",
			slog.String("scope", dim.Scope),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("validation failed: %w", err)
	}

	// Wait for rate limit
	if err := c.waitForRateLimit(c.ctx, "CreateDimension"); err != nil {
		return err
	}

	parent := fmt.Sprintf("properties/%s", propertyID)

	c.logger.Debug("creating custom dimension",
		slog.String("property_id", propertyID),
		slog.String("parameter_name", dim.ParameterName),
		slog.String("display_name", dim.DisplayName),
		slog.String("scope", dim.Scope),
	)

	dimension := &admin.GoogleAnalyticsAdminV1alphaCustomDimension{
		ParameterName: dim.ParameterName,
		DisplayName:   dim.DisplayName,
		Description:   dim.Description,
		Scope:         dim.Scope,
	}

	_, err := c.admin.Properties.CustomDimensions.Create(parent, dimension).Context(c.ctx).Do()
	if err != nil {
		if strings.Contains(err.Error(), "already exists") {
			c.logger.Debug("dimension already exists",
				slog.String("parameter_name", dim.ParameterName),
			)
			return nil
		}
		c.logger.Error("failed to create dimension",
			slog.String("display_name", dim.DisplayName),
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("failed to create dimension '%s' for property %s: %w", dim.DisplayName, propertyID, err)
	}

	c.logger.Info("dimension created successfully",
		slog.String("parameter_name", dim.ParameterName),
		slog.String("display_name", dim.DisplayName),
		slog.String("property_id", propertyID),
	)

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
	// Validate inputs
	if err := validation.ValidatePropertyID(propertyID); err != nil {
		c.logger.Error("invalid property ID",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Wait for rate limit
	if err := c.waitForRateLimit(c.ctx, "ListDimensions"); err != nil {
		return nil, err
	}

	parent := fmt.Sprintf("properties/%s", propertyID)

	c.logger.Debug("listing dimensions",
		slog.String("property_id", propertyID),
	)

	resp, err := c.admin.Properties.CustomDimensions.List(parent).PageSize(200).Context(c.ctx).Do()
	if err != nil {
		c.logger.Error("failed to list dimensions",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("failed to list dimensions for property %s: %w", propertyID, err)
	}

	c.logger.Debug("dimensions listed successfully",
		slog.String("property_id", propertyID),
		slog.Int("count", len(resp.CustomDimensions)),
	)

	return resp.CustomDimensions, nil
}

func (c *Client) DeleteDimension(propertyID, parameterName string) error {
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

	c.logger.Debug("deleting dimension",
		slog.String("property_id", propertyID),
		slog.String("parameter_name", parameterName),
	)

	// First, list all dimensions to find the resource name
	dimensions, err := c.ListDimensions(propertyID)
	if err != nil {
		return fmt.Errorf("failed to list dimensions for property %s: %w", propertyID, err)
	}

	// Find the dimension with matching parameter name
	var dimensionName string
	for _, dim := range dimensions {
		if dim.ParameterName == parameterName {
			dimensionName = dim.Name
			break
		}
	}

	if dimensionName == "" {
		c.logger.Warn("dimension not found",
			slog.String("parameter_name", parameterName),
			slog.String("property_id", propertyID),
		)
		return fmt.Errorf("dimension '%s' not found in property %s", parameterName, propertyID)
	}

	// Wait for rate limit
	if err := c.waitForRateLimit(c.ctx, "DeleteDimension"); err != nil {
		return err
	}

	// Archive the dimension (GA4 doesn't allow permanent deletion, only archiving)
	_, err = c.admin.Properties.CustomDimensions.Archive(dimensionName, &admin.GoogleAnalyticsAdminV1alphaArchiveCustomDimensionRequest{}).Context(c.ctx).Do()
	if err != nil {
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
