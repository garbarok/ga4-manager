package ga4

import (
	"fmt"
	"regexp"
	"strings"

	"google.golang.org/api/analyticsadmin/v1alpha"
)

// ChannelRule represents a rule for channel grouping
type ChannelRule struct {
	DisplayName string
	Expression  string
}

// ChannelGroup represents a custom channel group configuration
type ChannelGroup struct {
	DisplayName string
	Description string
	Rules       []ChannelRule
}

// DefaultChannelGroups returns the default channel grouping configuration
func DefaultChannelGroups() []ChannelGroup {
	return []ChannelGroup{
		{
			DisplayName: "Organic Search",
			Description: "Traffic from organic search engines",
			Rules: []ChannelRule{
				{
					DisplayName: "Google Organic",
					Expression:  "source == 'google' AND medium == 'organic'",
				},
				{
					DisplayName: "Bing Organic",
					Expression:  "source == 'bing' AND medium == 'organic'",
				},
				{
					DisplayName: "DuckDuckGo Organic",
					Expression:  "source == 'duckduckgo' AND medium == 'organic'",
				},
			},
		},
		{
			DisplayName: "Paid Search",
			Description: "Traffic from paid search campaigns",
			Rules: []ChannelRule{
				{
					DisplayName: "Google Ads",
					Expression:  "source == 'google' AND medium IN ('cpc', 'ppc', 'paidsearch')",
				},
				{
					DisplayName: "Bing Ads",
					Expression:  "source == 'bing' AND medium IN ('cpc', 'ppc', 'paidsearch')",
				},
			},
		},
		{
			DisplayName: "Organic Social",
			Description: "Traffic from organic social media",
			Rules: []ChannelRule{
				{
					DisplayName: "Facebook Organic",
					Expression:  "source == 'facebook' AND medium == 'social'",
				},
				{
					DisplayName: "Twitter Organic",
					Expression:  "source == 'twitter' AND medium == 'social'",
				},
				{
					DisplayName: "LinkedIn Organic",
					Expression:  "source == 'linkedin' AND medium == 'social'",
				},
				{
					DisplayName: "Reddit Organic",
					Expression:  "source == 'reddit' AND medium == 'social'",
				},
			},
		},
		{
			DisplayName: "Paid Social",
			Description: "Traffic from paid social media campaigns",
			Rules: []ChannelRule{
				{
					DisplayName: "Facebook Ads",
					Expression:  "source == 'facebook' AND medium IN ('cpc', 'ppc', 'paid')",
				},
				{
					DisplayName: "LinkedIn Ads",
					Expression:  "source == 'linkedin' AND medium IN ('cpc', 'ppc', 'paid')",
				},
			},
		},
		{
			DisplayName: "Direct",
			Description: "Direct traffic",
			Rules: []ChannelRule{
				{
					DisplayName: "Direct Traffic",
					Expression:  "source == '(direct)' AND medium == '(none)'",
				},
			},
		},
		{
			DisplayName: "Referral",
			Description: "Traffic from referring websites",
			Rules: []ChannelRule{
				{
					DisplayName: "Referral Traffic",
					Expression:  "medium == 'referral'",
				},
			},
		},
		{
			DisplayName: "Email",
			Description: "Traffic from email campaigns",
			Rules: []ChannelRule{
				{
					DisplayName: "Email Campaigns",
					Expression:  "medium == 'email'",
				},
			},
		},
		{
			DisplayName: "Affiliates",
			Description: "Traffic from affiliate programs",
			Rules: []ChannelRule{
				{
					DisplayName: "Affiliate Traffic",
					Expression:  "medium == 'affiliate'",
				},
			},
		},
		{
			DisplayName: "Display",
			Description: "Traffic from display advertising",
			Rules: []ChannelRule{
				{
					DisplayName: "Display Ads",
					Expression:  "medium IN ('display', 'banner', 'cpm')",
				},
			},
		},
	}
}

// parseChannelGroupFilter parses a simple filter expression string into a structured FilterExpression
func parseChannelGroupFilter(expression string) (*analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroupFilterExpression, error) {
	parts := strings.Split(expression, " AND ")
	var expressions []*analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroupFilterExpression

	for _, part := range parts {
		if strings.Contains(part, " IN ") {
			rIn := regexp.MustCompile(`(\w+)\s+IN\s+\(([^)]+)\)`)
			inMatches := rIn.FindStringSubmatch(part)
			if len(inMatches) < 3 {
				return nil, fmt.Errorf("invalid IN expression part: %s", part)
			}
			fieldName := inMatches[1]
			valuesStr := inMatches[2]
			var values []string
			for _, v := range strings.Split(valuesStr, ",") {
				values = append(values, strings.Trim(strings.TrimSpace(v), "'"))
			}
			expressions = append(expressions, &analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroupFilterExpression{
				Filter: &analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroupFilter{
					FieldName: fieldName,
					InListFilter: &analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroupFilterInListFilter{
						Values: values,
					},
				},
			})
		} else if strings.Contains(part, " == ") {
			rEq := regexp.MustCompile(`(\w+)\s*==\s*'([^']*)'`)
			eqMatches := rEq.FindStringSubmatch(part)
			if len(eqMatches) < 3 {
				rEqParen := regexp.MustCompile(`(\w+)\s*==\s*\(([^)]*)\)`)
				eqMatchesParen := rEqParen.FindStringSubmatch(part)
				if len(eqMatchesParen) < 3 {
					return nil, fmt.Errorf("invalid == expression part: %s", part)
				}
				eqMatches = eqMatchesParen
			}

			fieldName := eqMatches[1]
			value := eqMatches[2]
			expressions = append(expressions, &analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroupFilterExpression{
				Filter: &analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroupFilter{
					FieldName: fieldName,
					StringFilter: &analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroupFilterStringFilter{
						MatchType: "EXACT",
						Value:     value,
					},
				},
			})
		} else {
			return nil, fmt.Errorf("unsupported expression part: %s", part)
		}
	}

	if len(expressions) == 0 {
		return nil, fmt.Errorf("no expressions parsed from: %s", expression)
	}

	if len(expressions) == 1 {
		return expressions[0], nil
	}

	return &analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroupFilterExpression{
		AndGroup: &analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroupFilterExpressionList{
			FilterExpressions: expressions,
		},
	}, nil
}

// CreateChannelGroup creates a custom channel group for the property
func (c *Client) CreateChannelGroup(propertyID string, group ChannelGroup) (*analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroup, error) {
	propertyPath := fmt.Sprintf("properties/%s", propertyID)

	var groupingRules []*analyticsadmin.GoogleAnalyticsAdminV1alphaGroupingRule
	for _, rule := range group.Rules {
		expression, err := parseChannelGroupFilter(rule.Expression)
		if err != nil {
			return nil, fmt.Errorf("failed to parse rule '%s': %w", rule.DisplayName, err)
		}
		groupingRules = append(groupingRules, &analyticsadmin.GoogleAnalyticsAdminV1alphaGroupingRule{
			DisplayName: rule.DisplayName,
			Expression:  expression,
		})
	}

	channelGroup := &analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroup{
		DisplayName:  group.DisplayName,
		Description:  group.Description,
		GroupingRule: groupingRules,
	}

	createdGroup, err := c.admin.Properties.ChannelGroups.Create(propertyPath, channelGroup).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to create channel group '%s': %w", group.DisplayName, err)
	}

	return createdGroup, nil
}

// ListChannelGroups lists all channel groups for a property
func (c *Client) ListChannelGroups(propertyID string) ([]*analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroup, error) {
	propertyPath := fmt.Sprintf("properties/%s", propertyID)

	resp, err := c.admin.Properties.ChannelGroups.List(propertyPath).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to list channel groups: %w", err)
	}

	return resp.ChannelGroups, nil
}

// UpdateChannelGroup updates an existing channel group
func (c *Client) UpdateChannelGroup(channelGroupName string, group ChannelGroup) error {
	var groupingRules []*analyticsadmin.GoogleAnalyticsAdminV1alphaGroupingRule
	for _, rule := range group.Rules {
		expression, err := parseChannelGroupFilter(rule.Expression)
		if err != nil {
			return fmt.Errorf("failed to parse rule '%s': %w", rule.DisplayName, err)
		}
		groupingRules = append(groupingRules, &analyticsadmin.GoogleAnalyticsAdminV1alphaGroupingRule{
			DisplayName: rule.DisplayName,
			Expression:  expression,
		})
	}

	channelGroup := &analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroup{
		Name:         channelGroupName,
		DisplayName:  group.DisplayName,
		Description:  group.Description,
		GroupingRule: groupingRules,
	}

	updateMask := "display_name,description,grouping_rule"

	_, err := c.admin.Properties.ChannelGroups.Patch(channelGroupName, channelGroup).
		UpdateMask(updateMask).Do()
	if err != nil {
		return fmt.Errorf("failed to update channel group: %w", err)
	}

	return nil
}

// DeleteChannelGroup deletes a channel group
func (c *Client) DeleteChannelGroup(channelGroupName string) error {
	_, err := c.admin.Properties.ChannelGroups.Delete(channelGroupName).Do()
	if err != nil {
		return fmt.Errorf("failed to delete channel group: %w", err)
	}

	return nil
}

// GetChannelGroup retrieves a specific channel group
func (c *Client) GetChannelGroup(channelGroupName string) (*analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroup, error) {
	group, err := c.admin.Properties.ChannelGroups.Get(channelGroupName).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to get channel group: %w", err)
	}

	return group, nil
}

// SetupDefaultChannelGroups creates all default channel groups for a property
func (c *Client) SetupDefaultChannelGroups(propertyID string) error {
	defaultGroups := DefaultChannelGroups()
	fmt.Printf("Setting up %d default channel groups for property %s...\n", len(defaultGroups), propertyID)

	existingGroups, err := c.ListChannelGroups(propertyID)
	if err != nil {
		return fmt.Errorf("could not list existing channel groups: %w", err)
	}
	existingGroupNames := make(map[string]bool)
	for _, g := range existingGroups {
		existingGroupNames[g.DisplayName] = true
	}

	for _, group := range defaultGroups {
		if _, exists := existingGroupNames[group.DisplayName]; exists {
			fmt.Printf("Channel group '%s' already exists, skipping.\n", group.DisplayName)
			continue
		}
		fmt.Printf("Creating channel group '%s'...\n", group.DisplayName)
		_, err := c.CreateChannelGroup(propertyID, group)
		if err != nil {
			// It's possible the group was created in a previous partial run,
			// or there's another issue.
			fmt.Printf("Warning: Failed to create channel group '%s': %v\n", group.DisplayName, err)
			// We continue to try to create the other groups.
		}
	}
	fmt.Println("Finished setting up default channel groups.")
	return nil
}

// ChannelGroupExists checks if a channel group with the given name exists
func (c *Client) ChannelGroupExists(propertyID, displayName string) (bool, error) {
	groups, err := c.ListChannelGroups(propertyID)
	if err != nil {
		return false, err
	}

	for _, group := range groups {
		if group.DisplayName == displayName {
			return true, nil
		}
	}

	return false, nil
}
