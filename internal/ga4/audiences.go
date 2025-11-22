package ga4

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/oscargallego/ga4-manager/internal/config"
)

// GenerateAudienceGuide generates detailed documentation for creating audiences manually in GA4 UI
func (c *Client) GenerateAudienceGuide(project config.Project, outputPath string) error {
	// Determine which audience list to use
	var audiences []config.EnhancedAudience
	if project.Name == "SnapCompress" {
		audiences = config.SnapCompressAudiences
	} else {
		audiences = config.PersonalWebsiteAudiences
	}

	// Create output directory if it doesn't exist
	if err := os.MkdirAll(outputPath, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// Generate main documentation file
	mainDocPath := filepath.Join(outputPath, fmt.Sprintf("%s-audiences-guide.md", strings.ToLower(strings.ReplaceAll(project.Name, " ", "-"))))
	if err := c.generateMainDoc(project, audiences, mainDocPath); err != nil {
		return err
	}

	// Generate individual audience files
	audiencesDir := filepath.Join(outputPath, "audiences")
	if err := os.MkdirAll(audiencesDir, 0755); err != nil {
		return fmt.Errorf("failed to create audiences directory: %w", err)
	}

	for _, audience := range audiences {
		audiencePath := filepath.Join(audiencesDir, fmt.Sprintf("%s.md", strings.ToLower(strings.ReplaceAll(audience.Name, " ", "-"))))
		if err := c.generateAudienceDoc(audience, project, audiencePath); err != nil {
			return err
		}
	}

	return nil
}

func (c *Client) generateMainDoc(project config.Project, audiences []config.EnhancedAudience, outputPath string) error {
	var doc strings.Builder

	doc.WriteString(fmt.Sprintf("# Audience Configuration Guide: %s\n\n", project.Name))
	doc.WriteString("**Important Note:** Google Analytics 4 Admin API does not currently support creating audiences programmatically due to the complexity of filter logic. This guide provides step-by-step instructions for manually creating audiences in the GA4 interface.\n\n")
	doc.WriteString("---\n\n")

	doc.WriteString("## Table of Contents\n\n")

	// Group by category
	categories := make(map[string][]config.EnhancedAudience)
	for _, aud := range audiences {
		categories[aud.Category] = append(categories[aud.Category], aud)
	}

	for category := range categories {
		doc.WriteString(fmt.Sprintf("- [%s Audiences](#%s-audiences)\n", category, strings.ToLower(category)))
	}
	doc.WriteString("\n---\n\n")

	doc.WriteString("## Overview\n\n")
	doc.WriteString(fmt.Sprintf("This document provides configuration details for **%d audiences** across **%d categories**:\n\n", len(audiences), len(categories)))
	for category, auds := range categories {
		doc.WriteString(fmt.Sprintf("- **%s**: %d audiences\n", category, len(auds)))
	}
	doc.WriteString("\n")

	doc.WriteString("## Quick Start\n\n")
	doc.WriteString("1. Navigate to **Admin** → **Property** → **Audiences** in GA4\n")
	doc.WriteString("2. Click **New Audience**\n")
	doc.WriteString("3. Choose **Create a custom audience**\n")
	doc.WriteString("4. Follow the configuration details for each audience below\n")
	doc.WriteString("5. Click **Save** when done\n\n")
	doc.WriteString("---\n\n")

	// Generate sections by category
	for category, auds := range categories {
		doc.WriteString(fmt.Sprintf("## %s Audiences\n\n", category))

		for _, aud := range auds {
			doc.WriteString(fmt.Sprintf("### %s\n\n", aud.Name))
			doc.WriteString(fmt.Sprintf("**Description:** %s\n\n", aud.Description))
			doc.WriteString(fmt.Sprintf("**Membership Duration:** %d days\n\n", aud.MembershipDuration))

			if aud.ExclusionDuration > 0 {
				doc.WriteString(fmt.Sprintf("**Exclusion Duration:** %d days\n\n", aud.ExclusionDuration))
			}

			doc.WriteString("**Configuration:**\n\n")
			doc.WriteString(fmt.Sprintf("- See detailed setup: [%s.md](./audiences/%s.md)\n\n",
				strings.ToLower(strings.ReplaceAll(aud.Name, " ", "-")),
				strings.ToLower(strings.ReplaceAll(aud.Name, " ", "-"))))

			doc.WriteString("---\n\n")
		}
	}

	doc.WriteString("## Best Practices\n\n")
	doc.WriteString("1. **Test Audiences:** Create test audiences with shorter membership durations first\n")
	doc.WriteString("2. **Monitor Size:** Check audience size after 24-48 hours to ensure proper configuration\n")
	doc.WriteString("3. **Naming Convention:** Use clear, descriptive names that indicate the audience purpose\n")
	doc.WriteString("4. **Documentation:** Keep track of which audiences are used in which campaigns\n")
	doc.WriteString("5. **Review Regularly:** Audit audiences quarterly to remove unused or outdated segments\n\n")

	doc.WriteString("## Troubleshooting\n\n")
	doc.WriteString("### Audience Size is Zero\n")
	doc.WriteString("- Wait 24-48 hours for GA4 to process audience membership\n")
	doc.WriteString("- Verify events and dimensions are being tracked correctly\n")
	doc.WriteString("- Check filter logic for errors\n\n")

	doc.WriteString("### Audience Too Large\n")
	doc.WriteString("- Add more specific filters to narrow the audience\n")
	doc.WriteString("- Reduce membership duration\n")
	doc.WriteString("- Consider splitting into multiple audiences\n\n")

	doc.WriteString("### Events Not Triggering\n")
	doc.WriteString("- Verify events are set up as conversions in GA4\n")
	doc.WriteString("- Check event parameter values match expected format\n")
	doc.WriteString("- Use GA4 DebugView to test event firing\n\n")

	return os.WriteFile(outputPath, []byte(doc.String()), 0644)
}

func (c *Client) generateAudienceDoc(audience config.EnhancedAudience, project config.Project, outputPath string) error {
	var doc strings.Builder

	doc.WriteString(fmt.Sprintf("# %s\n\n", audience.Name))
	doc.WriteString(fmt.Sprintf("**Project:** %s\n", project.Name))
	doc.WriteString(fmt.Sprintf("**Category:** %s\n", audience.Category))
	doc.WriteString(fmt.Sprintf("**Description:** %s\n\n", audience.Description))

	doc.WriteString("---\n\n")

	doc.WriteString("## Configuration Steps\n\n")
	doc.WriteString("### 1. Basic Settings\n\n")
	doc.WriteString("1. In GA4, navigate to **Admin** → **Audiences**\n")
	doc.WriteString("2. Click **New Audience** → **Create a custom audience**\n")
	doc.WriteString(fmt.Sprintf("3. **Name:** `%s`\n", audience.Name))
	doc.WriteString(fmt.Sprintf("4. **Description:** `%s`\n\n", audience.Description))

	doc.WriteString("### 2. Membership Duration\n\n")
	doc.WriteString(fmt.Sprintf("- Set **Membership duration** to **%d days**\n", audience.MembershipDuration))
	if audience.ExclusionDuration > 0 {
		doc.WriteString(fmt.Sprintf("- Set **Exclusion duration** to **%d days**\n", audience.ExclusionDuration))
	}
	doc.WriteString("\n")

	if len(audience.EventTriggers) > 0 {
		doc.WriteString("### 3. Event Triggers\n\n")
		doc.WriteString("Add the following event conditions:\n\n")

		for i, trigger := range audience.EventTriggers {
			doc.WriteString(fmt.Sprintf("**Trigger %d:**\n", i+1))
			doc.WriteString(fmt.Sprintf("- **Event name:** `%s`\n", trigger.EventName))
			if trigger.MinimumCount > 0 {
				doc.WriteString(fmt.Sprintf("- **Condition:** User has triggered this event at least **%d times** in the last **%d days**\n", trigger.MinimumCount, trigger.WindowDuration))
			}
			doc.WriteString("\n")
		}

		doc.WriteString("**Steps in GA4:**\n")
		doc.WriteString("1. Click **Add condition** → **Add condition to this group**\n")
		doc.WriteString("2. Select **Event name** from dropdown\n")
		doc.WriteString("3. Select **contains** or **matches exactly**\n")
		doc.WriteString("4. Enter the event name\n")
		doc.WriteString("5. Click **Add parameter** to add count/duration conditions\n\n")
	}

	if len(audience.FilterClauses) > 0 {
		doc.WriteString("### 4. Filter Conditions\n\n")

		for i, clause := range audience.FilterClauses {
			doc.WriteString(fmt.Sprintf("**Filter Clause %d** (%s):\n\n", i+1, clause.ClauseType))

			for j, filter := range clause.Filters {
				doc.WriteString(fmt.Sprintf("%d. ", j+1))
				doc.WriteString(c.formatFilterForDoc(filter))
				doc.WriteString("\n")
			}
			doc.WriteString("\n")
		}

		doc.WriteString("**Steps in GA4:**\n")
		doc.WriteString("1. In the audience builder, click **Add condition**\n")
		doc.WriteString("2. For each filter:\n")
		doc.WriteString("   - Select the field name from dropdown\n")
		doc.WriteString("   - Choose the operator (equals, contains, greater than, etc.)\n")
		doc.WriteString("   - Enter the value\n")
		doc.WriteString("3. Use **AND** or **OR** logic as specified above\n\n")
	}

	doc.WriteString("## Example Use Cases\n\n")
	doc.WriteString(c.generateUseCases(audience))
	doc.WriteString("\n")

	doc.WriteString("## Verification\n\n")
	doc.WriteString("After creating the audience:\n\n")
	doc.WriteString("1. Wait 24-48 hours for initial population\n")
	doc.WriteString("2. Check audience size in **Audience** list\n")
	doc.WriteString("3. Create a report to verify audience characteristics\n")
	doc.WriteString("4. Test in a small campaign before full deployment\n\n")

	doc.WriteString("## Related Audiences\n\n")
	doc.WriteString(c.generateRelatedAudiences(audience, project))
	doc.WriteString("\n")

	return os.WriteFile(outputPath, []byte(doc.String()), 0644)
}

func (c *Client) formatFilterForDoc(filter config.AudienceFilter) string {
	valueStr := fmt.Sprintf("%v", filter.Value)

	switch filter.Operator {
	case "EQUALS":
		return fmt.Sprintf("**%s** equals `%s`", filter.FieldName, valueStr)
	case "CONTAINS":
		return fmt.Sprintf("**%s** contains `%s`", filter.FieldName, valueStr)
	case "GREATER_THAN":
		return fmt.Sprintf("**%s** > `%s`", filter.FieldName, valueStr)
	case "LESS_THAN":
		return fmt.Sprintf("**%s** < `%s`", filter.FieldName, valueStr)
	case "IN":
		return fmt.Sprintf("**%s** is one of `%s`", filter.FieldName, valueStr)
	case "NOT_NULL":
		return fmt.Sprintf("**%s** is not empty", filter.FieldName)
	case "LENGTH_GREATER_THAN":
		return fmt.Sprintf("**%s** length > `%s` characters", filter.FieldName, valueStr)
	default:
		return fmt.Sprintf("**%s** %s `%s`", filter.FieldName, filter.Operator, valueStr)
	}
}

func (c *Client) generateUseCases(audience config.EnhancedAudience) string {
	var cases strings.Builder

	switch audience.Category {
	case "SEO":
		cases.WriteString("- **Remarketing:** Target users with similar search intent\n")
		cases.WriteString("- **Content Strategy:** Identify which organic content drives engagement\n")
		cases.WriteString("- **SEO Analysis:** Track organic user behavior and conversion paths\n")
	case "Conversion":
		cases.WriteString("- **Remarketing:** Re-engage users who showed purchase intent\n")
		cases.WriteString("- **A/B Testing:** Test different messaging for converter vs non-converter segments\n")
		cases.WriteString("- **Funnel Optimization:** Identify drop-off points in conversion funnel\n")
	case "Behavioral":
		cases.WriteString("- **User Segmentation:** Understand different user behavior patterns\n")
		cases.WriteString("- **Personalization:** Deliver tailored experiences based on behavior\n")
		cases.WriteString("- **UX Improvements:** Identify pain points and optimization opportunities\n")
	case "Content":
		cases.WriteString("- **Content Marketing:** Identify most engaged content consumers\n")
		cases.WriteString("- **Email Campaigns:** Target users based on content preferences\n")
		cases.WriteString("- **Content Recommendations:** Suggest related content to engaged readers\n")
	default:
		cases.WriteString("- **Campaign Targeting:** Use this audience in marketing campaigns\n")
		cases.WriteString("- **Analytics:** Analyze behavior patterns of this user segment\n")
	}

	return cases.String()
}

func (c *Client) generateRelatedAudiences(audience config.EnhancedAudience, project config.Project) string {
	var related strings.Builder

	related.WriteString(fmt.Sprintf("Other audiences in the **%s** category:\n\n", audience.Category))

	// Get related audiences from same category
	var audiences []config.EnhancedAudience
	if project.Name == "SnapCompress" {
		audiences = config.SnapCompressAudiences
	} else {
		audiences = config.PersonalWebsiteAudiences
	}

	count := 0
	for _, aud := range audiences {
		if aud.Category == audience.Category && aud.Name != audience.Name {
			related.WriteString(fmt.Sprintf("- [%s](./%s.md)\n", aud.Name, strings.ToLower(strings.ReplaceAll(aud.Name, " ", "-"))))
			count++
			if count >= 5 {
				break
			}
		}
	}

	if count == 0 {
		related.WriteString("- No other audiences in this category\n")
	}

	return related.String()
}

// ValidateAudienceDefinition validates an audience configuration
func (c *Client) ValidateAudienceDefinition(audience config.EnhancedAudience) []string {
	var errors []string

	if audience.Name == "" {
		errors = append(errors, "audience name is required")
	}

	if audience.Description == "" {
		errors = append(errors, "audience description is required")
	}

	if audience.MembershipDuration <= 0 || audience.MembershipDuration > 540 {
		errors = append(errors, "membership duration must be between 1 and 540 days")
	}

	if len(audience.EventTriggers) == 0 && len(audience.FilterClauses) == 0 {
		errors = append(errors, "audience must have at least one event trigger or filter clause")
	}

	// Validate event triggers
	for i, trigger := range audience.EventTriggers {
		if trigger.EventName == "" {
			errors = append(errors, fmt.Sprintf("event trigger %d: event name is required", i))
		}
		if trigger.WindowDuration <= 0 {
			errors = append(errors, fmt.Sprintf("event trigger %d: window duration must be positive", i))
		}
	}

	// Validate filter clauses
	for i, clause := range audience.FilterClauses {
		if clause.ClauseType != "AND" && clause.ClauseType != "OR" && clause.ClauseType != "NOT" {
			errors = append(errors, fmt.Sprintf("filter clause %d: clause type must be AND, OR, or NOT", i))
		}
		if len(clause.Filters) == 0 {
			errors = append(errors, fmt.Sprintf("filter clause %d: must have at least one filter", i))
		}
	}

	return errors
}

// ListAudiencesByCategory returns audiences grouped by category
func ListAudiencesByCategory(project config.Project) map[string][]config.EnhancedAudience {
	var audiences []config.EnhancedAudience
	if project.Name == "SnapCompress" {
		audiences = config.SnapCompressAudiences
	} else {
		audiences = config.PersonalWebsiteAudiences
	}

	categories := make(map[string][]config.EnhancedAudience)
	for _, aud := range audiences {
		categories[aud.Category] = append(categories[aud.Category], aud)
	}

	return categories
}

// GetAudienceSummary returns a summary of all audiences
func GetAudienceSummary(project config.Project) string {
	var audiences []config.EnhancedAudience
	if project.Name == "SnapCompress" {
		audiences = config.SnapCompressAudiences
	} else {
		audiences = config.PersonalWebsiteAudiences
	}

	categories := make(map[string]int)
	for _, aud := range audiences {
		categories[aud.Category]++
	}

	var summary strings.Builder
	summary.WriteString(fmt.Sprintf("Total Audiences: %d\n", len(audiences)))
	summary.WriteString("By Category:\n")
	for category, count := range categories {
		summary.WriteString(fmt.Sprintf("  - %s: %d\n", category, count))
	}

	return summary.String()
}
