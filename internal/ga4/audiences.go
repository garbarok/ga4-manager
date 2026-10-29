package ga4

import (
	"fmt"
	"strings"

	"github.com/garbarok/ga4-manager/internal/config"
)

// Audiences cannot be created through the GA4 Admin API, so this package does
// not manage them. The two helpers below summarise audience configuration for
// the report/export commands. They currently return empty results until
// YAML-driven audience configuration lands (TODO #16); the elaborate
// doc-generation machinery that previously lived here was removed because it
// only ever operated on an always-empty audience list.

// ListAudiencesByCategory returns audiences grouped by category.
func ListAudiencesByCategory(_ *config.ProjectConfig) map[string][]config.EnhancedAudience {
	// TODO(#16): populate from YAML audience configuration.
	var audiences []config.EnhancedAudience

	categories := make(map[string][]config.EnhancedAudience)
	for _, aud := range audiences {
		categories[aud.Category] = append(categories[aud.Category], aud)
	}

	return categories
}

// GetAudienceSummary returns a human-readable summary of all audiences.
func GetAudienceSummary(_ *config.ProjectConfig) string {
	// TODO(#16): populate from YAML audience configuration.
	var audiences []config.EnhancedAudience

	categories := make(map[string]int)
	for _, aud := range audiences {
		categories[aud.Category]++
	}

	var summary strings.Builder
	fmt.Fprintf(&summary, "Total Audiences: %d\n", len(audiences))
	summary.WriteString("By Category:\n")
	for category, count := range categories {
		fmt.Fprintf(&summary, "  - %s: %d\n", category, count)
	}

	return summary.String()
}
