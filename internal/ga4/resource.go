package ga4

import (
	"fmt"
	"log/slog"

	"github.com/garbarok/ga4-manager/internal/validation"
)

// This file centralises the cross-cutting skeleton that every GA4 resource
// Create/List method previously duplicated: property-path construction, rate
// limiting, uniform structured logging, and error wrapping. Each caller supplies
// only the part that genuinely differs — the SDK endpoint to hit — as a closure.
//
// kind is the singular human noun for the resource ("conversion", "dimension",
// "custom metric"); list messages pluralise it by appending "s".

// createResource performs the rate-limited creation of a single GA4 resource.
// An "already exists" API error is treated as success (idempotent setup). The
// caller is responsible for input validation and any descriptive pre-call
// logging; do performs the actual Properties.<X>.Create call against parent.
func (c *Client) createResource(kind, propertyID, name string, do func(parent string) error) error {
	if err := c.waitForRateLimit(c.ctx, "Create "+kind); err != nil {
		return err
	}

	parent := fmt.Sprintf("properties/%s", propertyID)
	err := do(parent)
	switch {
	case err == nil:
		c.logger.Info(kind+" created successfully",
			slog.String("name", name),
			slog.String("property_id", propertyID),
		)
		return nil
	case isAlreadyExistsError(err):
		c.logger.Debug(kind+" already exists", slog.String("name", name))
		return nil
	default:
		c.logger.Error("failed to create "+kind,
			slog.String("name", name),
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("failed to create %s '%s' for property %s: %w", kind, name, propertyID, err)
	}
}

// listResource performs a rate-limited list of a GA4 resource collection after
// validating the property ID. do performs the actual Properties.<X>.List call
// and extracts the typed slice from the response.
func listResource[T any](c *Client, kind, propertyID string, do func(parent string) ([]T, error)) ([]T, error) {
	if err := validation.ValidatePropertyID(propertyID); err != nil {
		c.logger.Error("invalid property ID",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	if err := c.waitForRateLimit(c.ctx, "List "+kind); err != nil {
		return nil, err
	}

	parent := fmt.Sprintf("properties/%s", propertyID)
	c.logger.Debug("listing "+kind+"s", slog.String("property_id", propertyID))

	items, err := do(parent)
	if err != nil {
		c.logger.Error("failed to list "+kind+"s",
			slog.String("property_id", propertyID),
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("failed to list %ss for property %s: %w", kind, propertyID, err)
	}

	c.logger.Debug(kind+"s listed successfully",
		slog.String("property_id", propertyID),
		slog.Int("count", len(items)),
	)
	return items, nil
}

// firstMatch returns the first item whose key equals want, or the zero value and
// false when no item matches.
func firstMatch[T any](items []T, key func(T) string, want string) (T, bool) {
	for _, it := range items {
		if key(it) == want {
			return it, true
		}
	}
	var zero T
	return zero, false
}
