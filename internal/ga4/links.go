package ga4

import (
	"fmt"

	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

// ListCustomChannelGroups returns the property's channel groups excluding the
// system-defined ones, which cannot be modified or deleted.
func (c *Client) ListCustomChannelGroups(propertyID string) ([]*admin.GoogleAnalyticsAdminV1alphaChannelGroup, error) {
	groups, err := c.ListChannelGroups(propertyID)
	if err != nil {
		return nil, err
	}

	var custom []*admin.GoogleAnalyticsAdminV1alphaChannelGroup
	for _, g := range groups {
		if !g.SystemDefined {
			custom = append(custom, g)
		}
	}
	return custom, nil
}

// UnlinkService removes the property's links for the given external service and
// returns the resource names that were deleted, in deletion order. Supported
// services are "bigquery" (alias "bq") and "channels"; system-defined channel
// groups are never touched. On the first deletion failure it returns the names
// deleted so far together with the error.
func (c *Client) UnlinkService(propertyID, service string) ([]string, error) {
	var deleted []string

	switch service {
	case "bigquery", "bq":
		links, err := c.ListBigQueryLinks(propertyID)
		if err != nil {
			return nil, fmt.Errorf("could not list BigQuery links to unlink: %w", err)
		}
		for _, link := range links {
			if err := c.DeleteBigQueryLink(link.Name); err != nil {
				return deleted, fmt.Errorf("failed to delete BigQuery link %s: %w", link.Name, err)
			}
			deleted = append(deleted, link.Name)
		}

	case "channels":
		groups, err := c.ListCustomChannelGroups(propertyID)
		if err != nil {
			return nil, fmt.Errorf("could not list channel groups to unlink: %w", err)
		}
		for _, group := range groups {
			if err := c.DeleteChannelGroup(group.Name); err != nil {
				return deleted, fmt.Errorf("failed to delete channel group %s: %w", group.Name, err)
			}
			deleted = append(deleted, group.Name)
		}

	default:
		return nil, fmt.Errorf("unlinking not supported for service: %s", service)
	}

	return deleted, nil
}
